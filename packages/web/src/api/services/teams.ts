import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids, newShareCode, normaliseShareCode } from "../lib/ids";
import { filterExplanation, filterMessage, filterName } from "../lib/text-filter";
import { isChatPreset, presetText } from "../lib/chat-presets";
import { requireCommunity, requireSameTier, type Player } from "./consent";
import { friendChannel, friendIds } from "./friends";
import { blockedIds, requireNotBlocked } from "./moderation";

/**
 * Teams (clans) and chat. They live together because a team *is* a chat
 * channel — the members list is the permission list.
 *
 * Joining is by 6-character code, handed over the same way an invite code is.
 * A team is stamped with its owner's tier at creation and only ever accepts
 * that tier, so an adult cannot end up in a team of twelve-year-olds even by
 * accident.
 *
 * Chat has two kinds and the difference is the whole point:
 *   - `preset` — a fixed phrase id from `lib/chat-presets.ts`. Everyone with
 *     community access can send these, including under-13s.
 *   - `text`   — free typing. 13+ only, never in the first 24 hours of an
 *     account's life, and always through `filterMessage` first.
 */

export const TEAM_SIZE_LIMIT = 20;
export const CHAT_PAGE = 50;
/** Nothing older than this is served — chat is chatter, not a record. */
export const CHAT_HISTORY_MS = 14 * 24 * 60 * 60 * 1000;
/** Per-player floor between messages, so a channel cannot be flooded. */
export const CHAT_MIN_GAP_MS = 1_500;

/* ------------------------------------------------------------------- teams */

export async function createTeam(player: Player, rawName: string) {
  const access = requireCommunity(player);
  if (!access.host) {
    throw new ORPCError("FORBIDDEN", {
      message: access.newAccount
        ? "New accounts can create a team after their first day."
        : "Teams are created by players aged 16 or over.",
    });
  }
  const name = filterName(rawName, 24);
  if (name.blocked) {
    throw new ORPCError("BAD_REQUEST", { message: filterExplanation(name.reasons) });
  }
  if (await currentTeamId(player.id)) {
    throw new ORPCError("BAD_REQUEST", { message: "Leave your current team first." });
  }

  const [clash] = await db.select({ id: schema.team.id }).from(schema.team).where(eq(schema.team.name, name.text));
  if (clash) throw new ORPCError("BAD_REQUEST", { message: "That team name is taken." });

  const teamId = ids.team();
  await db.insert(schema.team).values({
    id: teamId,
    name: name.text,
    joinCode: await freshJoinCode(),
    ownerId: player.id,
    tier: player.ageTier!,
    memberCount: 1,
  });
  await db.insert(schema.teamMember).values({
    id: ids.teamMember(),
    teamId,
    playerId: player.id,
    role: "owner",
  });
  return myTeam(player);
}

async function freshJoinCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = newShareCode(6);
    const [clash] = await db
      .select({ id: schema.team.id })
      .from(schema.team)
      .where(eq(schema.team.joinCode, code));
    if (!clash) return code;
  }
  throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Could not mint a join code" });
}

export async function currentTeamId(playerId: string) {
  const [row] = await db
    .select({ teamId: schema.teamMember.teamId })
    .from(schema.teamMember)
    .where(eq(schema.teamMember.playerId, playerId));
  return row?.teamId ?? null;
}

export async function joinTeam(player: Player, rawCode: string) {
  requireCommunity(player);
  const code = normaliseShareCode(rawCode);
  if (code.length !== 6) {
    throw new ORPCError("BAD_REQUEST", { message: "A team code is 6 characters." });
  }
  if (await currentTeamId(player.id)) {
    throw new ORPCError("BAD_REQUEST", { message: "Leave your current team first." });
  }
  const [team] = await db
    .select()
    .from(schema.team)
    .where(and(eq(schema.team.joinCode, code), isNull(schema.team.disbandedAt)));
  if (!team) throw new ORPCError("NOT_FOUND", { message: "No team has that code." });
  if (team.tier !== player.ageTier) {
    throw new ORPCError("FORBIDDEN", {
      message: "That team is for a different age group. Adults and under-18s play separately.",
    });
  }
  if (team.memberCount >= TEAM_SIZE_LIMIT) {
    throw new ORPCError("BAD_REQUEST", { message: `A team holds ${TEAM_SIZE_LIMIT} players.` });
  }
  const [owner] = await db.select().from(schema.player).where(eq(schema.player.id, team.ownerId));
  if (owner) await requireNotBlocked(player.id, owner.id);

  await db.insert(schema.teamMember).values({
    id: ids.teamMember(),
    teamId: team.id,
    playerId: player.id,
    role: "member",
  });
  await db
    .update(schema.team)
    .set({ memberCount: sql`${schema.team.memberCount} + 1` })
    .where(eq(schema.team.id, team.id));
  return myTeam(player);
}

export async function leaveTeam(player: Player) {
  const teamId = await currentTeamId(player.id);
  if (!teamId) return { ok: true as const, team: null };
  const [team] = await db.select().from(schema.team).where(eq(schema.team.id, teamId));

  await db
    .delete(schema.teamMember)
    .where(
      and(eq(schema.teamMember.teamId, teamId), eq(schema.teamMember.playerId, player.id)),
    );

  const remaining = await db
    .select({ id: schema.teamMember.id, playerId: schema.teamMember.playerId })
    .from(schema.teamMember)
    .where(eq(schema.teamMember.teamId, teamId))
    .orderBy(asc(schema.teamMember.joinedAt));

  if (remaining.length === 0) {
    await db
      .update(schema.team)
      .set({ memberCount: 0, disbandedAt: new Date() })
      .where(eq(schema.team.id, teamId));
  } else {
    // The oldest remaining member inherits it, so a team never loses its owner.
    const promote = team?.ownerId === player.id ? remaining[0]! : null;
    await db
      .update(schema.team)
      .set({
        memberCount: remaining.length,
        ...(promote ? { ownerId: promote.playerId } : {}),
      })
      .where(eq(schema.team.id, teamId));
    if (promote) {
      await db
        .update(schema.teamMember)
        .set({ role: "owner" })
        .where(eq(schema.teamMember.id, promote.id));
    }
  }
  return { ok: true as const, team: null };
}

export async function myTeam(player: Player) {
  const teamId = await currentTeamId(player.id);
  if (!teamId) return null;
  const [team] = await db.select().from(schema.team).where(eq(schema.team.id, teamId));
  if (!team) return null;

  const memberRows = await db
    .select({
      playerId: schema.teamMember.playerId,
      role: schema.teamMember.role,
      joinedAt: schema.teamMember.joinedAt,
      username: schema.player.username,
      level: schema.player.level,
      wins: schema.player.wins,
      moderationState: schema.player.moderationState,
    })
    .from(schema.teamMember)
    .innerJoin(schema.player, eq(schema.player.id, schema.teamMember.playerId))
    .where(eq(schema.teamMember.teamId, teamId))
    .orderBy(desc(schema.player.wins));

  const blocked = await blockedIds(player.id);
  return {
    id: team.id,
    name: team.name,
    /** Only members see the code — it is how the team grows. */
    joinCode: team.joinCode,
    tier: team.tier,
    isOwner: team.ownerId === player.id,
    memberCount: team.memberCount,
    sizeLimit: TEAM_SIZE_LIMIT,
    members: memberRows
      .filter((m) => m.moderationState === "active" || m.playerId === player.id)
      .map((m) => ({ ...m, blocked: blocked.has(m.playerId) })),
  };
}

/* -------------------------------------------------------------------- chat */

type Channel = { scope: "friend" | "team"; channelId: string };

/** Resolves and authorises a channel. Everything below goes through this. */
async function resolveChannel(player: Player, input: Channel) {
  requireCommunity(player);
  if (input.scope === "team") {
    const teamId = await currentTeamId(player.id);
    if (!teamId || teamId !== input.channelId) {
      throw new ORPCError("FORBIDDEN", { message: "Not your team." });
    }
    return { scope: "team" as const, channelId: teamId, recipients: null };
  }
  const { link, otherId } = await friendChannel(player.id, input.channelId);
  await requireNotBlocked(player.id, otherId);
  const [other] = await db.select().from(schema.player).where(eq(schema.player.id, otherId));
  if (!other) throw new ORPCError("NOT_FOUND", { message: "No such conversation." });
  requireSameTier(player, other);
  if (other.moderationState !== "active") {
    throw new ORPCError("FORBIDDEN", { message: "That player is not available right now." });
  }
  return { scope: "friend" as const, channelId: link.id, recipients: [otherId] };
}

export async function sendChat(
  player: Player,
  input: Channel & ({ kind: "preset"; presetId: string } | { kind: "text"; body: string }),
) {
  const access = requireCommunity(player);
  const channel = await resolveChannel(player, input);

  const [recent] = await db
    .select({ createdAt: schema.chatMessage.createdAt })
    .from(schema.chatMessage)
    .where(eq(schema.chatMessage.authorId, player.id))
    .orderBy(desc(schema.chatMessage.createdAt))
    .limit(1);
  if (recent && Date.now() - recent.createdAt.getTime() < CHAT_MIN_GAP_MS) {
    throw new ORPCError("TOO_MANY_REQUESTS", { message: "Slow down a moment." });
  }

  let body: string;
  let redacted = false;
  if (input.kind === "preset") {
    if (!isChatPreset(input.presetId)) {
      throw new ORPCError("BAD_REQUEST", { message: "Unknown phrase." });
    }
    body = presetText(input.presetId);
  } else {
    if (!access.freeText) {
      throw new ORPCError("FORBIDDEN", {
        message:
          access.ageBand === "under13"
            ? "Under 13, GeoFights chat is the ready-made phrases only."
            : "Typed messages unlock after your first day.",
      });
    }
    const verdict = filterMessage(input.body);
    if (verdict.blocked) {
      throw new ORPCError("BAD_REQUEST", { message: filterExplanation(verdict.reasons) });
    }
    body = verdict.text;
    redacted = verdict.redacted;
  }

  const [row] = await db
    .insert(schema.chatMessage)
    .values({
      id: ids.chatMessage(),
      scope: channel.scope,
      channelId: channel.channelId,
      authorId: player.id,
      kind: input.kind,
      body,
      redacted,
    })
    .returning();

  return { message: { ...row!, username: player.username, mine: true }, redacted };
}

export async function chatHistory(player: Player, input: Channel & { limit?: number }) {
  const channel = await resolveChannel(player, input);
  const since = new Date(Date.now() - CHAT_HISTORY_MS);
  const blocked = await blockedIds(player.id);

  const rows = await db
    .select({
      id: schema.chatMessage.id,
      authorId: schema.chatMessage.authorId,
      kind: schema.chatMessage.kind,
      body: schema.chatMessage.body,
      redacted: schema.chatMessage.redacted,
      createdAt: schema.chatMessage.createdAt,
      username: schema.player.username,
    })
    .from(schema.chatMessage)
    .innerJoin(schema.player, eq(schema.player.id, schema.chatMessage.authorId))
    .where(
      and(
        eq(schema.chatMessage.channelId, channel.channelId),
        isNull(schema.chatMessage.hiddenAt),
        sql`${schema.chatMessage.createdAt} >= ${since.getTime()}`,
      ),
    )
    .orderBy(desc(schema.chatMessage.createdAt))
    .limit(Math.min(input.limit ?? CHAT_PAGE, CHAT_PAGE));

  return rows
    .filter((row) => !blocked.has(row.authorId))
    .reverse()
    .map((row) => ({ ...row, mine: row.authorId === player.id }));
}

/** Friend channels with their last line — the inbox list. */
export async function chatOverview(player: Player) {
  requireCommunity(player);
  const friends = await friendIds(player.id);
  if (friends.size === 0) return [];

  const links = await db
    .select({ id: schema.friendLink.id, a: schema.friendLink.aPlayerId, b: schema.friendLink.bPlayerId })
    .from(schema.friendLink)
    .where(
      and(
        eq(schema.friendLink.status, "accepted"),
        inArray(schema.friendLink.aPlayerId, [player.id, ...friends]),
        inArray(schema.friendLink.bPlayerId, [player.id, ...friends]),
      ),
    );
  const mine = links.filter((l) => l.a === player.id || l.b === player.id);
  if (mine.length === 0) return [];

  const lastRows = await db
    .select({
      channelId: schema.chatMessage.channelId,
      body: schema.chatMessage.body,
      createdAt: schema.chatMessage.createdAt,
    })
    .from(schema.chatMessage)
    .where(
      and(
        inArray(
          schema.chatMessage.channelId,
          mine.map((l) => l.id),
        ),
        isNull(schema.chatMessage.hiddenAt),
      ),
    )
    .orderBy(desc(schema.chatMessage.createdAt))
    .limit(200);

  const latest = new Map<string, { body: string; createdAt: Date }>();
  for (const row of lastRows) {
    if (!latest.has(row.channelId)) latest.set(row.channelId, row);
  }

  const otherIds = mine.map((l) => (l.a === player.id ? l.b : l.a));
  const people = await db
    .select({ id: schema.player.id, username: schema.player.username })
    .from(schema.player)
    .where(inArray(schema.player.id, otherIds));
  const byId = new Map(people.map((p) => [p.id, p.username]));

  return mine
    .map((link) => {
      const otherId = link.a === player.id ? link.b : link.a;
      const last = latest.get(link.id) ?? null;
      return {
        friendLinkId: link.id,
        playerId: otherId,
        username: byId.get(otherId) ?? "player",
        lastBody: last?.body ?? null,
        lastAt: last?.createdAt ?? null,
      };
    })
    .sort((x, y) => (y.lastAt?.getTime() ?? 0) - (x.lastAt?.getTime() ?? 0));
}

/** Housekeeping for the cron: drop chat past the retention window. */
export async function pruneChat() {
  const cutoff = new Date(Date.now() - CHAT_HISTORY_MS);
  await db.delete(schema.chatMessage).where(lt(schema.chatMessage.createdAt, cutoff));
  return { prunedBefore: cutoff.toISOString() };
}
