/**
 * Launch tracking: first-party, privacy-light attribution for promo links
 * (`?ref=ig` etc.) plus operator progress on the launch kit. Nothing here
 * stores an IP address or anything that identifies a visitor.
 */
import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids } from "../lib/ids";

export const REF_PATTERN = /^[a-z0-9_-]{1,24}$/;
const DAY = 24 * 3600 * 1000;
/** A sign-up only counts for a ref if the account is this fresh. */
const SIGNUP_WINDOW_MS = 2 * DAY;

/** In-memory flood guard so one script can't inflate a channel. */
const recent = new Map<string, number[]>();
const PER_MINUTE = 120;

export async function recordVisit(ref: string, path: string | undefined) {
  const now = Date.now();
  const hits = (recent.get(ref) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= PER_MINUTE) return { ok: false as const };
  hits.push(now);
  recent.set(ref, hits);
  if (recent.size > 200) recent.delete(recent.keys().next().value!);
  await db.insert(schema.launchEvent).values({
    id: ids.launchEvent(),
    kind: "visit",
    ref,
    path: path?.slice(0, 120) ?? null,
  });
  return { ok: true as const };
}

/** Credit a brand-new player to the channel they arrived from. Idempotent. */
export async function recordSignup(player: { id: string; createdAt: Date }, ref: string) {
  if (Date.now() - player.createdAt.getTime() > SIGNUP_WINDOW_MS) return { counted: false };
  const [existing] = await db
    .select({ id: schema.launchEvent.id })
    .from(schema.launchEvent)
    .where(and(eq(schema.launchEvent.kind, "signup"), eq(schema.launchEvent.playerId, player.id)))
    .limit(1);
  if (existing) return { counted: false };
  await db.insert(schema.launchEvent).values({ id: ids.launchEvent(), kind: "signup", ref, playerId: player.id });
  return { counted: true };
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Per-channel visits and sign-ups, plus a 14-day trend of the whole game. */
export async function launchStats() {
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);
  const since7 = new Date(now - 7 * DAY);
  const since14 = new Date(now - 13 * DAY);
  since14.setUTCHours(0, 0, 0, 0);

  const byRef = await db
    .select({
      ref: schema.launchEvent.ref,
      kind: schema.launchEvent.kind,
      total: count(),
      last30: sql<number>`sum(case when ${schema.launchEvent.createdAt} >= ${since30.getTime()} then 1 else 0 end)`,
      last7: sql<number>`sum(case when ${schema.launchEvent.createdAt} >= ${since7.getTime()} then 1 else 0 end)`,
      lastAt: sql<number>`max(${schema.launchEvent.createdAt})`,
    })
    .from(schema.launchEvent)
    .groupBy(schema.launchEvent.ref, schema.launchEvent.kind);

  const channels = new Map<
    string,
    { ref: string; visits: number; visits7: number; visits30: number; signups: number; signups7: number; lastAt: number }
  >();
  for (const r of byRef) {
    const c = channels.get(r.ref) ?? { ref: r.ref, visits: 0, visits7: 0, visits30: 0, signups: 0, signups7: 0, lastAt: 0 };
    if (r.kind === "visit") {
      c.visits = Number(r.total);
      c.visits7 = Number(r.last7 ?? 0);
      c.visits30 = Number(r.last30 ?? 0);
    } else {
      c.signups = Number(r.total);
      c.signups7 = Number(r.last7 ?? 0);
    }
    c.lastAt = Math.max(c.lastAt, Number(r.lastAt ?? 0));
    channels.set(r.ref, c);
  }

  const [events, players, matches] = await Promise.all([
    db
      .select({ kind: schema.launchEvent.kind, at: schema.launchEvent.createdAt })
      .from(schema.launchEvent)
      .where(gte(schema.launchEvent.createdAt, since14)),
    db.select({ at: schema.player.createdAt }).from(schema.player).where(gte(schema.player.createdAt, since14)),
    db.select({ at: schema.match.createdAt }).from(schema.match).where(gte(schema.match.createdAt, since14)),
  ]);

  const days: Array<{ day: string; visits: number; signups: number; newPlayers: number; matches: number }> = [];
  const index = new Map<string, (typeof days)[number]>();
  for (let i = 0; i < 14; i++) {
    const row = { day: dayKey(new Date(since14.getTime() + i * DAY)), visits: 0, signups: 0, newPlayers: 0, matches: 0 };
    days.push(row);
    index.set(row.day, row);
  }
  for (const e of events) {
    const row = index.get(dayKey(e.at));
    if (row) row[e.kind === "visit" ? "visits" : "signups"]++;
  }
  for (const p of players) {
    const row = index.get(dayKey(p.at));
    if (row) row.newPlayers++;
  }
  for (const m of matches) {
    const row = index.get(dayKey(m.at));
    if (row) row.matches++;
  }

  const [totals] = await db.select({ players: count() }).from(schema.player);
  return {
    channels: [...channels.values()].sort((a, b) => b.visits30 - a.visits30 || b.visits - a.visits),
    days,
    totalPlayers: Number(totals?.players ?? 0),
  };
}

export function launchItems() {
  return db.select().from(schema.launchItem);
}

export async function setLaunchItem(input: {
  key: string;
  status: (typeof schema.LAUNCH_ITEM_STATUS)[number];
  postedUrl?: string | null;
  note?: string | null;
}) {
  const now = new Date();
  const values = {
    key: input.key,
    status: input.status,
    postedUrl: input.postedUrl ?? null,
    note: input.note ?? null,
    postedAt: input.status === "posted" ? now : null,
    updatedAt: now,
  };
  const [row] = await db
    .insert(schema.launchItem)
    .values(values)
    .onConflictDoUpdate({
      target: schema.launchItem.key,
      set: {
        status: values.status,
        postedUrl: values.postedUrl,
        note: values.note,
        updatedAt: now,
        // Keep the first "posted" time if it is re-saved.
        postedAt: input.status === "posted" ? sql`coalesce(${schema.launchItem.postedAt}, ${now.getTime()})` : null,
      },
    })
    .returning();
  return row;
}
