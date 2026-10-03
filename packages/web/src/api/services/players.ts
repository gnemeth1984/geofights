import { and, desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids } from "../lib/ids";

export const STARTING_CURRENCY = 500;
export const MAX_AVATARS_PER_PLAYER = 3;
/** XP needed to reach level n is LEVEL_STEP * n^1.5 (rounded). */
const LEVEL_STEP = 120;

export function xpForLevel(level: number) {
  if (level <= 1) return 0;
  return Math.round(LEVEL_STEP * (level - 1) ** 1.5);
}

export function levelForXp(xp: number) {
  let level = 1;
  while (xp >= xpForLevel(level + 1) && level < 100) level++;
  return level;
}

export function progression(xp: number) {
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  return {
    level,
    xp,
    xpIntoLevel: xp - floor,
    xpForNextLevel: ceiling - floor,
    progress: ceiling === floor ? 1 : (xp - floor) / (ceiling - floor),
  };
}

type AuthUser = { id: string; name?: string | null; email: string };

/** Idempotently create the game profile for an auth user. */
export async function ensurePlayer(user: AuthUser) {
  const [existing] = await db
    .select()
    .from(schema.player)
    .where(eq(schema.player.userId, user.id));
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);
  if (existing) {
    // ADMIN_EMAILS also promotes accounts that existed before they were listed,
    // so "add the email and sign in again" actually works. It never demotes.
    if (existing.role !== "admin" && adminEmails.includes(user.email.toLowerCase())) {
      const [promoted] = await db
        .update(schema.player)
        .set({ role: "admin" })
        .where(eq(schema.player.id, existing.id))
        .returning();
      return promoted ?? existing;
    }
    return existing;
  }
  const isFirstPlayer = (await countPlayers()) === 0;

  const [created] = await db
    .insert(schema.player)
    .values({
      id: ids.player(),
      userId: user.id,
      username: await uniqueUsername(user.name || user.email.split("@")[0] || "player"),
      role: isFirstPlayer || adminEmails.includes(user.email.toLowerCase()) ? "admin" : "player",
      currency: STARTING_CURRENCY,
      lastSeenAt: new Date(),
    })
    .returning();

  // Two starter boosters so a new player has something to equip before their
  // first match. Imported lazily because boosters.ts imports this module.
  try {
    const { grantStarterKit } = await import("./boosters");
    await grantStarterKit(created!.id);
  } catch {
    // Never block sign-in on the starter kit — the shop covers it.
  }
  return created!;
}

export async function countPlayers() {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(schema.player);
  return Number(row?.count ?? 0);
}

export async function uniqueUsername(base: string) {
  const clean = base.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16) || "player";
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = attempt === 0 ? clean : `${clean}${Math.floor(Math.random() * 10_000)}`;
    const [taken] = await db
      .select({ id: schema.player.id })
      .from(schema.player)
      .where(eq(schema.player.username, candidate));
    if (!taken) return candidate;
  }
  return `${clean}${Date.now().toString(36)}`;
}

export async function getPlayer(playerId: string) {
  const [row] = await db.select().from(schema.player).where(eq(schema.player.id, playerId));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Player not found" });
  return row;
}

/** Move currency, refusing to go negative. Returns the updated player. */
export async function adjustCurrency(playerId: string, delta: number) {
  const current = await getPlayer(playerId);
  const next = current.currency + delta;
  if (next < 0) throw new ORPCError("BAD_REQUEST", { message: "Not enough currency" });
  const [updated] = await db
    .update(schema.player)
    .set({ currency: next, updatedAt: new Date() })
    .where(eq(schema.player.id, playerId))
    .returning();
  return updated!;
}

export async function grantXp(playerId: string, xp: number) {
  const current = await getPlayer(playerId);
  const nextXp = Math.max(0, current.xp + xp);
  const nextLevel = levelForXp(nextXp);
  const [updated] = await db
    .update(schema.player)
    .set({ xp: nextXp, level: nextLevel, updatedAt: new Date() })
    .where(eq(schema.player.id, playerId))
    .returning();
  return { player: updated!, leveledUp: nextLevel > current.level, levels: nextLevel - current.level };
}

export async function recordResult(playerId: string, won: boolean) {
  await db
    .update(schema.player)
    .set({
      wins: won ? sql`${schema.player.wins} + 1` : schema.player.wins,
      losses: won ? schema.player.losses : sql`${schema.player.losses} + 1`,
      matchesPlayed: sql`${schema.player.matchesPlayed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.player.id, playerId));
}

export async function touchLocation(playerId: string, lat?: number, lng?: number) {
  await db
    .update(schema.player)
    .set({ lastLat: lat, lastLng: lng, lastSeenAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.player.id, playerId));
}

export async function leaderboard(limit = 25) {
  return db
    .select({
      playerId: schema.player.id,
      username: schema.player.username,
      level: schema.player.level,
      xp: schema.player.xp,
      wins: schema.player.wins,
      losses: schema.player.losses,
    })
    .from(schema.player)
    .orderBy(desc(schema.player.wins), desc(schema.player.xp))
    .limit(limit);
}

export async function ledger(playerId: string, limit = 50) {
  return db
    .select()
    .from(schema.transaction)
    .where(
      and(
        sql`(${schema.transaction.fromPlayerId} = ${playerId} OR ${schema.transaction.toPlayerId} = ${playerId})`,
      ),
    )
    .orderBy(desc(schema.transaction.createdAt))
    .limit(limit);
}

export async function logTransaction(values: {
  type: (typeof schema.transaction.$inferInsert)["type"];
  amount?: number;
  fee?: number;
  netAmount?: number;
  fromPlayerId?: string | null;
  toPlayerId?: string | null;
  listingId?: string | null;
  note?: string;
}) {
  const [row] = await db
    .insert(schema.transaction)
    .values({ id: ids.transaction(), ...values })
    .returning();
  return row!;
}
