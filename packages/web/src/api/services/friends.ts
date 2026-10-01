import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids, normaliseShareCode } from "../lib/ids";
import { NEW_ACCOUNT_INVITE_LIMIT, ensureInviteCode, requireCommunity, requireSameTier } from "./consent";
import { blockedIds, requireNotBlocked } from "./moderation";

/**
 * Friends, and the only way to get one.
 *
 * There is no player search in this API. No directory, no suggestions, no
 * "people near you". A friendship starts when one player types the other's
 * 8-character invite code — read off a screen or scanned as a QR, which in
 * practice means the two of them are standing next to each other. That single
 * decision removes the entire class of harm where an adult goes looking for
 * children by name.
 *
 * Redeeming a code raises a request; the owner of the code still has to accept
 * it. So a code that leaks does not create a connection on its own.
 */

export type Player = typeof schema.player.$inferSelect;

/** Sorted pair, so `(a,b)` and `(b,a)` can never both exist. */
function pair(x: string, y: string) {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

export async function myInvite(player: Player) {
  const code = await ensureInviteCode(player);
  return {
    code,
    /** The QR the other player scans. Relative — the client makes it absolute. */
    link: `/add-friend?code=${code}`,
  };
}

export async function redeemInviteCode(player: Player, rawCode: string) {
  const access = requireCommunity(player);
  const code = normaliseShareCode(rawCode);
  if (code.length !== 8) {
    throw new ORPCError("BAD_REQUEST", { message: "An invite code is 8 characters." });
  }
  if (code === player.inviteCode) {
    throw new ORPCError("BAD_REQUEST", { message: "That is your own code." });
  }

  if (access.inviteLimit !== null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ value: sql<number>`count(*)` })
      .from(schema.friendLink)
      .where(
        and(eq(schema.friendLink.requestedBy, player.id), gte(schema.friendLink.createdAt, since)),
      );
    if (Number(row?.value ?? 0) >= NEW_ACCOUNT_INVITE_LIMIT) {
      throw new ORPCError("FORBIDDEN", {
        message: `New accounts can send ${NEW_ACCOUNT_INVITE_LIMIT} friend requests in the first day.`,
      });
    }
  }

  const [target] = await db
    .select()
    .from(schema.player)
    .where(eq(schema.player.inviteCode, code));
  if (!target) throw new ORPCError("NOT_FOUND", { message: "No player has that code." });

  requireCommunity(target);
  requireSameTier(player, target);
  await requireNotBlocked(player.id, target.id);

  const { a, b } = pair(player.id, target.id);
  const [existing] = await db
    .select()
    .from(schema.friendLink)
    .where(and(eq(schema.friendLink.aPlayerId, a), eq(schema.friendLink.bPlayerId, b)));

  if (existing?.status === "accepted") {
    return { status: "accepted" as const, username: target.username, friendLinkId: existing.id };
  }
  if (existing?.status === "pending") {
    // The other side already asked: redeeming their code accepts it.
    if (existing.requestedBy === target.id) {
      await db
        .update(schema.friendLink)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(eq(schema.friendLink.id, existing.id));
      return { status: "accepted" as const, username: target.username, friendLinkId: existing.id };
    }
    return { status: "pending" as const, username: target.username, friendLinkId: existing.id };
  }

  const id = existing?.id ?? ids.friendLink();
  if (existing) {
    await db
      .update(schema.friendLink)
      .set({ status: "pending", requestedBy: player.id, createdAt: new Date(), respondedAt: null })
      .where(eq(schema.friendLink.id, existing.id));
  } else {
    await db.insert(schema.friendLink).values({
      id,
      aPlayerId: a,
      bPlayerId: b,
      requestedBy: player.id,
      status: "pending",
    });
  }
  return { status: "pending" as const, username: target.username, friendLinkId: id };
}

export async function respondToRequest(player: Player, friendLinkId: string, accept: boolean) {
  const [link] = await db
    .select()
    .from(schema.friendLink)
    .where(eq(schema.friendLink.id, friendLinkId));
  if (!link) throw new ORPCError("NOT_FOUND", { message: "Request not found" });
  if (link.aPlayerId !== player.id && link.bPlayerId !== player.id) {
    throw new ORPCError("FORBIDDEN", { message: "Not your request." });
  }
  if (link.requestedBy === player.id) {
    throw new ORPCError("BAD_REQUEST", { message: "That is your own request." });
  }
  if (link.status !== "pending") {
    throw new ORPCError("BAD_REQUEST", { message: "That request is already answered." });
  }
  await db
    .update(schema.friendLink)
    .set({ status: accept ? "accepted" : "declined", respondedAt: new Date() })
    .where(eq(schema.friendLink.id, link.id));
  return { ok: true as const, status: accept ? ("accepted" as const) : ("declined" as const) };
}

export async function removeFriend(player: Player, friendId: string) {
  const { a, b } = pair(player.id, friendId);
  await db
    .delete(schema.friendLink)
    .where(and(eq(schema.friendLink.aPlayerId, a), eq(schema.friendLink.bPlayerId, b)));
  return { ok: true as const };
}

/**
 * Friends and pending requests in one read. Blocked players and accounts that
 * are currently hidden drop out of the list rather than showing greyed — the
 * player does not need to be told an account is under review.
 */
export async function friendList(player: Player) {
  const rows = await db
    .select()
    .from(schema.friendLink)
    .where(
      and(
        or(eq(schema.friendLink.aPlayerId, player.id), eq(schema.friendLink.bPlayerId, player.id)),
        inArray(schema.friendLink.status, ["pending", "accepted"]),
      ),
    )
    .orderBy(desc(schema.friendLink.createdAt));

  const otherIds = rows.map((row) => (row.aPlayerId === player.id ? row.bPlayerId : row.aPlayerId));
  const [people, blocked] = await Promise.all([
    otherIds.length
      ? db
          .select({
            id: schema.player.id,
            username: schema.player.username,
            level: schema.player.level,
            wins: schema.player.wins,
            ageTier: schema.player.ageTier,
            moderationState: schema.player.moderationState,
            lastSeenAt: schema.player.lastSeenAt,
          })
          .from(schema.player)
          .where(inArray(schema.player.id, otherIds))
      : Promise.resolve([]),
    blockedIds(player.id),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));

  const friends: Array<{
    friendLinkId: string;
    playerId: string;
    username: string;
    level: number;
    wins: number;
    lastSeenAt: Date | null;
  }> = [];
  const incoming: Array<{ friendLinkId: string; playerId: string; username: string }> = [];
  const outgoing: Array<{ friendLinkId: string; playerId: string; username: string }> = [];

  for (const row of rows) {
    const otherId = row.aPlayerId === player.id ? row.bPlayerId : row.aPlayerId;
    const other = byId.get(otherId);
    if (!other || blocked.has(otherId) || other.moderationState !== "active") continue;
    if (other.ageTier !== player.ageTier) continue;

    if (row.status === "accepted") {
      friends.push({
        friendLinkId: row.id,
        playerId: other.id,
        username: other.username,
        level: other.level,
        wins: other.wins,
        lastSeenAt: other.lastSeenAt,
      });
    } else if (row.requestedBy === player.id) {
      outgoing.push({ friendLinkId: row.id, playerId: other.id, username: other.username });
    } else {
      incoming.push({ friendLinkId: row.id, playerId: other.id, username: other.username });
    }
  }
  return { friends, incoming, outgoing };
}

/** Accepted friend ids — the allow-list every chat write checks against. */
export async function friendIds(playerId: string) {
  const rows = await db
    .select({ a: schema.friendLink.aPlayerId, b: schema.friendLink.bPlayerId })
    .from(schema.friendLink)
    .where(
      and(
        or(eq(schema.friendLink.aPlayerId, playerId), eq(schema.friendLink.bPlayerId, playerId)),
        eq(schema.friendLink.status, "accepted"),
      ),
    );
  return new Set(rows.map((row) => (row.a === playerId ? row.b : row.a)));
}

/** The friend channel two players share, if they are actually friends. */
export async function friendChannel(playerId: string, friendLinkId: string) {
  const [link] = await db
    .select()
    .from(schema.friendLink)
    .where(eq(schema.friendLink.id, friendLinkId));
  if (!link || link.status !== "accepted") {
    throw new ORPCError("NOT_FOUND", { message: "No such conversation." });
  }
  if (link.aPlayerId !== playerId && link.bPlayerId !== playerId) {
    throw new ORPCError("FORBIDDEN", { message: "Not your conversation." });
  }
  return { link, otherId: link.aPlayerId === playerId ? link.bPlayerId : link.aPlayerId };
}
