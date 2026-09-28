import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids } from "../lib/ids";

/**
 * Realtime event bus for match sync.
 *
 * Transport note: the managed runtime serves the API through Hono's fetch
 * handler, so the wire format here is SSE (`GET /api/realtime/match/:matchId`)
 * rather than a raw WebSocket upgrade. The event names, payloads and ordering
 * are exactly the ones a WS client expects, and every transport concern is
 * confined to this module — dropping in a `ws` adapter later means
 * implementing `publish()` against a socket registry and nothing else.
 *
 * Durable events are appended to `battle_event` with a monotonic `seq` per
 * match, so a client that reconnects replays from `Last-Event-ID` without
 * losing anything. High-frequency `avatar_position` frames are broadcast only
 * (never persisted) to keep writes bounded.
 */

export const REALTIME_EVENTS = [
  "player_joined",
  "player_left",
  "avatar_position",
  "avatar_action",
  /**
   * A blow is on its way. Broadcast the instant the attack is committed and
   * long before it lands, because it is the only thing that makes the
   * defender's read possible: it carries the move, its kind, and the absolute
   * moment the server will resolve it.
   */
  "avatar_windup",
  /** A defender committed a guard. Lets the striker's client show the read. */
  "avatar_guard",
  "avatar_damage",
  "avatar_death",
  "match_started",
  "match_finished",
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENTS)[number];

/**
 * Events broadcast but not written to the battle log.
 *
 * A telegraph and a guard are only meaningful for the few hundred
 * milliseconds they are live — replaying them on reconnect would animate a
 * swing that resolved minutes ago, and persisting them would triple the log
 * for a fight whose history is already told by `avatar_damage`.
 */
const EPHEMERAL: RealtimeEventType[] = ["avatar_position", "avatar_windup", "avatar_guard"];

export interface RealtimeEvent {
  seq: number;
  matchId: string;
  type: RealtimeEventType;
  payload: Record<string, unknown>;
  message?: string | null;
  at: string;
}

type Subscriber = (event: RealtimeEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();
/** Ephemeral frames get negative seq numbers so they never clash with the log. */
let ephemeralSeq = 0;

export function subscribe(matchId: string, fn: Subscriber) {
  const set = subscribers.get(matchId) ?? new Set<Subscriber>();
  set.add(fn);
  subscribers.set(matchId, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) subscribers.delete(matchId);
  };
}

export function subscriberCount(matchId?: string) {
  if (matchId) return subscribers.get(matchId)?.size ?? 0;
  let total = 0;
  for (const set of subscribers.values()) total += set.size;
  return total;
}

function publish(event: RealtimeEvent) {
  const set = subscribers.get(event.matchId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      set.delete(fn);
    }
  }
}

/** Emit an event: persist (unless ephemeral) then fan out to subscribers. */
export async function emit(
  matchId: string,
  type: RealtimeEventType,
  payload: Record<string, unknown> = {},
  opts: { message?: string | null; actorPlayerId?: string | null; targetPlayerId?: string | null } = {},
): Promise<RealtimeEvent> {
  let seq: number;
  if (EPHEMERAL.includes(type)) {
    seq = --ephemeralSeq;
  } else {
    seq = await nextSeq(matchId);
    await db.insert(schema.battleEvent).values({
      id: ids.battleEvent(),
      matchId,
      seq,
      type,
      actorPlayerId: opts.actorPlayerId ?? null,
      targetPlayerId: opts.targetPlayerId ?? null,
      payload: JSON.stringify(payload),
      message: opts.message ?? null,
    });
  }

  const event: RealtimeEvent = {
    seq,
    matchId,
    type,
    payload,
    message: opts.message ?? null,
    at: new Date().toISOString(),
  };
  publish(event);
  return event;
}

async function nextSeq(matchId: string) {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${schema.battleEvent.seq}), 0)` })
    .from(schema.battleEvent)
    .where(eq(schema.battleEvent.matchId, matchId));
  return Number(row?.max ?? 0) + 1;
}

/** Replay persisted events after `afterSeq` — used on reconnect and by polling clients. */
export async function eventsSince(matchId: string, afterSeq = 0): Promise<RealtimeEvent[]> {
  const rows = await db
    .select()
    .from(schema.battleEvent)
    .where(and(eq(schema.battleEvent.matchId, matchId), gt(schema.battleEvent.seq, afterSeq)))
    .orderBy(schema.battleEvent.seq)
    .limit(500);

  return rows.map((row) => ({
    seq: row.seq,
    matchId: row.matchId,
    type: row.type as RealtimeEventType,
    payload: safeParse(row.payload),
    message: row.message,
    at: row.createdAt.toISOString(),
  }));
}

function safeParse(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}
