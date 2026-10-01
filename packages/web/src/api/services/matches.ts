import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids } from "../lib/ids";
import { emit } from "../realtime/bus";
import { finishMatch, matchSnapshot, seedBattleStates } from "../battle/engine";
import { nearestZone } from "./nature";
import { requireBattleGround } from "./safety";
import { requireCanJoin, requireMatchEligible, visibleToViewer } from "./match-gate";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export async function createMatch(input: {
  hostPlayerId: string;
  avatarId: string;
  zoneId?: string;
  maxPlayers?: number;
  lat?: number;
  lng?: number;
}) {
  const maxPlayers = clampPlayers(input.maxPlayers ?? MAX_PLAYERS);
  await assertAvatar(input.avatarId, input.hostPlayerId);
  await requireMatchEligible(input.hostPlayerId);
  // Opening a lobby is a battle action: a training zone refuses it here rather
  // than letting the match exist and fail on the first attack.
  await requireBattleGround({
    playerId: input.hostPlayerId,
    kind: "create_match",
    lat: input.lat,
    lng: input.lng,
  });

  const zoneId = input.zoneId ?? (await resolveZone(input.lat, input.lng));
  const [match] = await db
    .insert(schema.match)
    .values({
      id: ids.match(),
      zoneId,
      hostPlayerId: input.hostPlayerId,
      status: "waiting",
      maxPlayers,
    })
    .returning();

  await addParticipant(match!.id, input.hostPlayerId, input.avatarId);
  return matchSnapshot(match!.id);
}

export async function joinMatch(input: { matchId: string; playerId: string; avatarId: string }) {
  const match = await getMatch(input.matchId);
  if (match.status !== "waiting") {
    throw new ORPCError("BAD_REQUEST", { message: `Match is ${match.status}` });
  }
  await assertAvatar(input.avatarId, input.playerId);

  const participants = await db
    .select()
    .from(schema.matchPlayer)
    .where(and(eq(schema.matchPlayer.matchId, input.matchId), isNull(schema.matchPlayer.leftAt)));
  if (participants.some((p) => p.playerId === input.playerId)) {
    throw new ORPCError("BAD_REQUEST", { message: "Already in this match" });
  }
  if (participants.length >= match.maxPlayers) {
    throw new ORPCError("BAD_REQUEST", { message: "Match is full" });
  }
  // Same age tier as everyone seated, nobody blocked either way.
  await requireCanJoin(input.playerId, input.matchId);

  await addParticipant(input.matchId, input.playerId, input.avatarId);
  return matchSnapshot(input.matchId);
}

export async function leaveMatch(input: { matchId: string; playerId: string }) {
  const match = await getMatch(input.matchId);
  const [participant] = await db
    .select()
    .from(schema.matchPlayer)
    .where(
      and(
        eq(schema.matchPlayer.matchId, input.matchId),
        eq(schema.matchPlayer.playerId, input.playerId),
      ),
    );
  if (!participant) throw new ORPCError("NOT_FOUND", { message: "You are not in this match" });

  await db
    .update(schema.matchPlayer)
    .set({ leftAt: new Date() })
    .where(eq(schema.matchPlayer.id, participant.id));

  if (match.status === "active") {
    // Leaving an active match counts as a knockout, so the engine can settle it.
    await db
      .update(schema.battleState)
      .set({ alive: false, currentHealth: 0, diedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.battleState.matchId, input.matchId),
          eq(schema.battleState.playerId, input.playerId),
        ),
      );
  }

  await emit(input.matchId, "player_left", { playerId: input.playerId }, { actorPlayerId: input.playerId });

  const remaining = await activeParticipants(input.matchId);
  if (match.status === "waiting" && remaining.length === 0) {
    await db
      .update(schema.match)
      .set({ status: "cancelled", endTime: new Date() })
      .where(eq(schema.match.id, input.matchId));
  } else if (match.status === "active" && remaining.length <= 1) {
    await finishMatch({ matchId: input.matchId, reason: "opponent_left" });
  }

  return { left: true, matchId: input.matchId };
}

export async function startMatch(input: { matchId: string; playerId: string }) {
  const match = await getMatch(input.matchId);
  if (match.hostPlayerId !== input.playerId) {
    throw new ORPCError("FORBIDDEN", { message: "Only the host can start the match" });
  }
  if (match.status !== "waiting") {
    throw new ORPCError("BAD_REQUEST", { message: `Match is ${match.status}` });
  }
  const participants = await activeParticipants(input.matchId);
  if (participants.length < MIN_PLAYERS) {
    throw new ORPCError("BAD_REQUEST", { message: `Need at least ${MIN_PLAYERS} players` });
  }

  await seedBattleStates(input.matchId);
  await db
    .update(schema.match)
    .set({ status: "active", startTime: new Date() })
    .where(eq(schema.match.id, input.matchId));

  const snapshot = await matchSnapshot(input.matchId);
  await emit(input.matchId, "match_started", {
    zoneId: match.zoneId,
    players: snapshot.players.map((p) => ({
      playerId: p.playerId,
      avatarId: p.avatarId,
      avatarName: p.avatarName,
      maxHealth: p.maxHealth,
      abilities: p.abilities,
    })),
  });
  return snapshot;
}

export async function finish(input: { matchId: string; playerId: string }) {
  const match = await getMatch(input.matchId);
  const participants = await db
    .select()
    .from(schema.matchPlayer)
    .where(eq(schema.matchPlayer.matchId, input.matchId));
  if (!participants.some((p) => p.playerId === input.playerId)) {
    throw new ORPCError("FORBIDDEN", { message: "Not your match" });
  }
  if (match.status !== "active") throw new ORPCError("BAD_REQUEST", { message: `Match is ${match.status}` });
  return finishMatch({ matchId: input.matchId, reason: "called" });
}

/** How long a match may sit with no progress before the reaper closes it. */
export const STALE_MATCH_MS = 60 * 60_000;

/**
 * Closes matches nobody is playing any more.
 *
 * A client that navigates away mid-fight never calls `finish` or `leave`, so
 * the row stays `active` forever and keeps showing up in the open-match list.
 * Staleness is measured from the last thing that actually happened in the
 * match — its newest battle-state tick, falling back to start/created time —
 * so a genuinely long fight is never cut short.
 */
export async function reapStaleMatches(olderThanMs = STALE_MATCH_MS) {
  const cutoff = Date.now() - olderThanMs;
  const open = await db
    .select({
      id: schema.match.id,
      startTime: schema.match.startTime,
      createdAt: schema.match.createdAt,
      lastTick: sql<number | null>`max(${schema.battleState.updatedAt})`,
    })
    .from(schema.match)
    .leftJoin(schema.battleState, eq(schema.battleState.matchId, schema.match.id))
    .where(inArray(schema.match.status, ["waiting", "active"]))
    .groupBy(schema.match.id);

  const lastActivity = (row: (typeof open)[number]) =>
    Math.max(
      row.startTime?.getTime() ?? 0,
      row.createdAt?.getTime() ?? 0,
      Number(row.lastTick ?? 0),
    );

  const matchIds = open.filter((row) => lastActivity(row) < cutoff).map((row) => row.id);
  if (matchIds.length === 0) return { checked: open.length, reaped: 0, matchIds: [] as string[] };

  const endedAt = new Date();
  const minutes = Math.round(olderThanMs / 60_000);
  await db
    .update(schema.match)
    .set({
      status: "cancelled",
      endTime: endedAt,
      summary: `Abandoned — no activity for over ${minutes} minutes.`,
    })
    .where(inArray(schema.match.id, matchIds));
  await db
    .update(schema.matchPlayer)
    .set({ leftAt: endedAt })
    .where(and(inArray(schema.matchPlayer.matchId, matchIds), isNull(schema.matchPlayer.leftAt)));

  // Anyone still holding the channel open gets the same close event as a real finish.
  for (const matchId of matchIds) {
    try {
      await emit(
        matchId,
        "match_finished",
        { reason: "abandoned", winnerPlayerId: null, rewards: [] },
        { message: `Abandoned — no activity for over ${minutes} minutes.` },
      );
    } catch (error) {
      console.error("[reaper] emit failed", matchId, error);
    }
  }

  return { checked: open.length, reaped: matchIds.length, matchIds };
}

/** Join the nearest open match, or open a new one. */
export async function quickMatch(input: {
  playerId: string;
  avatarId: string;
  lat?: number;
  lng?: number;
}) {
  await requireMatchEligible(input.playerId);
  await requireBattleGround({
    playerId: input.playerId,
    kind: "quick_match",
    lat: input.lat,
    lng: input.lng,
  });
  const zoneId = await resolveZone(input.lat, input.lng);
  const open = await db
    .select({
      match: schema.match,
      // Outer column written fully qualified: Drizzle emits a bare `"id"` on a
      // single-table select, which SQLite resolves to match_player.id — that made the
      // seat count always 0 and let quickMatch join lobbies that were already full.
      count: sql<number>`(select count(*) from match_player mp where mp.match_id = "match"."id" and mp.left_at is null)`,
    })
    .from(schema.match)
    .where(and(eq(schema.match.status, "waiting"), eq(schema.match.zoneId, zoneId)))
    .orderBy(desc(schema.match.createdAt))
    .limit(10);

  const allowed = await visibleToViewer(
    input.playerId,
    open.map((row) => ({ ...row, hostPlayerId: row.match.hostPlayerId })),
  );
  const joinable = allowed.find(
    (row) => Number(row.count) < row.match.maxPlayers && row.match.hostPlayerId !== input.playerId,
  );
  if (joinable) {
    return joinMatch({ matchId: joinable.match.id, playerId: input.playerId, avatarId: input.avatarId });
  }
  return createMatch({ hostPlayerId: input.playerId, avatarId: input.avatarId, zoneId });
}

export async function openMatches(viewerId: string, zoneId?: string) {
  const rows = await db
    .select({
      match: schema.match,
      hostUsername: schema.player.username,
      zoneName: schema.zone.name,
      players: sql<number>`(select count(*) from match_player mp where mp.match_id = ${schema.match.id} and mp.left_at is null)`,
    })
    .from(schema.match)
    .innerJoin(schema.player, eq(schema.player.id, schema.match.hostPlayerId))
    .leftJoin(schema.zone, eq(schema.zone.id, schema.match.zoneId))
    .where(zoneId ? and(eq(schema.match.status, "waiting"), eq(schema.match.zoneId, zoneId)) : eq(schema.match.status, "waiting"))
    .orderBy(desc(schema.match.createdAt))
    .limit(50);
  const listed = rows.map((row) => ({ ...row.match, hostUsername: row.hostUsername, zoneName: row.zoneName, players: Number(row.players) }));
  // Lobbies across the adult/under-18 line, or with a blocked host, are not shown.
  return visibleToViewer(viewerId, listed);
}

export async function myMatches(playerId: string, limit = 20) {
  const rows = await db
    .select({ match: schema.match, participation: schema.matchPlayer })
    .from(schema.matchPlayer)
    .innerJoin(schema.match, eq(schema.match.id, schema.matchPlayer.matchId))
    .where(eq(schema.matchPlayer.playerId, playerId))
    .orderBy(desc(schema.match.createdAt))
    .limit(limit);
  // `leftAt` is part of the answer: the client uses this list to work out which
  // match the player is still standing in after a reload, and a match they
  // walked out of must not pull them back in.
  return rows.map((row) => ({ ...row.match, placement: row.participation.placement, xpEarned: row.participation.xpEarned, currencyEarned: row.participation.currencyEarned, leftAt: row.participation.leftAt }));
}

/* ---------------------------------------------------------------- helpers */

async function addParticipant(matchId: string, playerId: string, avatarId: string) {
  await db.insert(schema.matchPlayer).values({
    id: ids.matchPlayer(),
    matchId,
    playerId,
    avatarId,
  });
  const [avatar] = await db.select().from(schema.avatar).where(eq(schema.avatar.id, avatarId));
  await emit(
    matchId,
    "player_joined",
    { playerId, avatarId, avatarName: avatar?.name, modelId: avatar?.modelId },
    { actorPlayerId: playerId },
  );
}

export async function getMatch(matchId: string) {
  const [match] = await db.select().from(schema.match).where(eq(schema.match.id, matchId));
  if (!match) throw new ORPCError("NOT_FOUND", { message: "Match not found" });
  return match;
}

async function activeParticipants(matchId: string) {
  return db
    .select()
    .from(schema.matchPlayer)
    .where(and(eq(schema.matchPlayer.matchId, matchId), isNull(schema.matchPlayer.leftAt)));
}

async function assertAvatar(avatarId: string, playerId: string) {
  const [avatar] = await db
    .select()
    .from(schema.avatar)
    .where(and(eq(schema.avatar.id, avatarId), eq(schema.avatar.ownerId, playerId)));
  if (!avatar) throw new ORPCError("NOT_FOUND", { message: "Avatar not found" });

  const listed = await db
    .select({ id: schema.marketplaceListing.id })
    .from(schema.marketplaceListing)
    .where(
      and(
        eq(schema.marketplaceListing.itemId, avatarId),
        eq(schema.marketplaceListing.status, "active"),
      ),
    );
  if (listed.length > 0) {
    throw new ORPCError("BAD_REQUEST", { message: "Avatar is listed on the marketplace" });
  }

  const busy = await db
    .select({ id: schema.match.id })
    .from(schema.matchPlayer)
    .innerJoin(schema.match, eq(schema.match.id, schema.matchPlayer.matchId))
    .where(
      and(
        eq(schema.matchPlayer.avatarId, avatarId),
        isNull(schema.matchPlayer.leftAt),
        inArray(schema.match.status, ["waiting", "active"]),
      ),
    );
  if (busy.length > 0) throw new ORPCError("BAD_REQUEST", { message: "Avatar is already in a match" });
  return avatar;
}

async function resolveZone(lat?: number, lng?: number) {
  const zone = await nearestZone(lat, lng);
  return zone.id;
}

function clampPlayers(value: number) {
  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(value)));
}
