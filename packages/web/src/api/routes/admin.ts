import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { adminProc } from "../middleware/auth";
import { db } from "../database";
import * as schema from "../database/schema";
import { RARITIES } from "../database/schema";
import { JOB_NAMES, jobStatus, runJob, systemStats } from "../services/cron";
import { createBoosterDefinition } from "../services/boosters";
import { generateAvatar } from "../services/avatars";
import {
  createZone,
  deleteZone,
  refreshDailySpawns,
  spawnInZone,
  updateZone,
  listZones,
  getZone,
} from "../services/nature";
import { adjustCurrency, getPlayer, logTransaction } from "../services/players";
import { aiConfigured } from "../ai/gateway";
import { subscriberCount } from "../realtime/bus";

/**
 * Admin surface, powering the panel at `/admin`. Every procedure requires a
 * player whose `role` is `admin` — the first account created on a fresh
 * install is promoted automatically, and `ADMIN_EMAILS` can allowlist more.
 */
export const admin = {
  overview: adminProc.handler(async () => ({
    stats: await systemStats(),
    cron: await jobStatus(),
    aiConfigured,
    liveSubscribers: subscriberCount(),
  })),

  /* ------------------------------------------------------------- players */

  players: adminProc
    .input(
      z.object({
        search: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }).optional(),
    )
    .handler(({ input }) =>
      db
        .select()
        .from(schema.player)
        .where(
          input?.search
            ? sql`lower(${schema.player.username}) like ${`%${input.search.toLowerCase()}%`}`
            : undefined,
        )
        .orderBy(desc(schema.player.createdAt))
        .limit(input?.limit ?? 50),
    ),

  setRole: adminProc
    .input(z.object({ playerId: z.string(), role: z.enum(["player", "admin"]) }))
    .handler(async ({ input }) => {
      await getPlayer(input.playerId);
      const [updated] = await db
        .update(schema.player)
        .set({ role: input.role, updatedAt: new Date() })
        .where(eq(schema.player.id, input.playerId))
        .returning();
      return updated!;
    }),

  grantCurrency: adminProc
    .input(
      z.object({
        playerId: z.string(),
        amount: z.number().int().min(-1_000_000).max(1_000_000),
        note: z.string().max(140).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const player = await adjustCurrency(input.playerId, input.amount);
      await logTransaction({
        type: "admin_grant",
        toPlayerId: input.playerId,
        fromPlayerId: context.player.id,
        amount: Math.abs(input.amount),
        netAmount: input.amount,
        note: input.note ?? "Admin adjustment",
      });
      return player;
    }),

  /* ------------------------------------------------------------- content */

  /** Force-generate a booster definition at a chosen rarity. */
  generateBooster: adminProc
    .input(
      z.object({
        rarity: z.enum(RARITIES).optional(),
        origin: z.enum(["shop", "nature", "battle", "any"]).default("any"),
        tier: z.number().int().min(1).max(5).default(1),
      }).optional(),
    )
    .handler(({ input }) =>
      createBoosterDefinition({
        rarity: input?.rarity,
        origin: input?.origin ?? "any",
        tier: input?.tier ?? 1,
      }),
    ),

  /** Mint an avatar into a player's roster (respects their 3-slot cap). */
  generateAvatar: adminProc
    .input(
      z.object({
        playerId: z.string(),
        rarity: z.enum(RARITIES).optional(),
        theme: z.string().max(120).optional(),
      }),
    )
    .handler(async ({ input }) => {
      const player = await getPlayer(input.playerId);
      return generateAvatar({
        ownerId: player.id,
        playerName: player.username,
        rarity: input.rarity,
        theme: input.theme,
      });
    }),

  boosterDefinitions: adminProc
    .input(z.object({ limit: z.number().int().min(1).max(200).default(60) }).optional())
    .handler(async ({ input }) => {
      const rows = await db
        .select({
          booster: schema.booster,
          // Outer column written fully qualified: Drizzle emits a bare `"id"` on a
          // single-table select, which SQLite resolves to booster_instance.id.
          owned: sql<number>`(select count(*) from booster_instance bi where bi.booster_id = "booster"."id")`,
        })
        .from(schema.booster)
        .orderBy(desc(schema.booster.createdAt))
        .limit(input?.limit ?? 60);
      return rows.map((row) => ({
        ...row.booster,
        statModifiers: JSON.parse(row.booster.statModifiers) as Record<string, number>,
        owned: Number(row.owned),
      }));
    }),

  /* --------------------------------------------------------------- zones */

  zones: adminProc.handler(() => listZones({ includeInactive: true, includeUnapproved: true })),

  createZone: adminProc
    .input(
      z.object({
        name: z.string().min(2).max(60),
        description: z.string().max(240).optional(),
        centerLat: z.number().min(-90).max(90),
        centerLng: z.number().min(-180).max(180),
        radiusM: z.number().int().min(50).max(20_000).default(500),
        spawnWeight: z.number().int().min(1).max(10).default(1),
        terrain: z.string().max(60).optional(),
      }),
    )
    .handler(({ input }) => createZone(input)),

  updateZone: adminProc
    .input(
      z.object({
        zoneId: z.string(),
        name: z.string().min(2).max(60).optional(),
        description: z.string().max(240).optional(),
        radiusM: z.number().int().min(50).max(20_000).optional(),
        spawnWeight: z.number().int().min(1).max(10).optional(),
        terrain: z.string().max(60).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .handler(({ input }) => updateZone(input)),

  deleteZone: adminProc
    .input(z.object({ zoneId: z.string() }))
    .handler(({ input }) => deleteZone(input.zoneId)),

  /** Drop a single spawn into a zone, for testing pickup on a real device. */
  spawnBooster: adminProc
    .input(
      z.object({
        zoneId: z.string(),
        rarity: z.enum(RARITIES).optional(),
        ttlHours: z.number().int().min(1).max(168).default(26),
      }),
    )
    .handler(async ({ input }) => {
      const zone = await getZone(input.zoneId);
      return spawnInZone(zone, { rarity: input.rarity, ttlHours: input.ttlHours });
    }),

  refreshSpawns: adminProc
    .input(z.object({ perWeight: z.number().int().min(1).max(30).optional() }).optional())
    .handler(({ input }) => refreshDailySpawns({ perWeight: input?.perWeight })),

  /* ------------------------------------------------------------- matches */

  matches: adminProc
    .input(
      z.object({
        status: z.enum(["waiting", "active", "finished", "cancelled"]).optional(),
        limit: z.number().int().min(1).max(100).default(40),
      }).optional(),
    )
    .handler(async ({ input }) => {
      const rows = await db
        .select({
          match: schema.match,
          hostUsername: schema.player.username,
          players: sql<number>`(select count(*) from match_player mp where mp.match_id = ${schema.match.id})`,
        })
        .from(schema.match)
        .leftJoin(schema.player, eq(schema.player.id, schema.match.hostPlayerId))
        .where(input?.status ? eq(schema.match.status, input.status) : undefined)
        .orderBy(desc(schema.match.createdAt))
        .limit(input?.limit ?? 40);
      return rows.map((row) => ({
        ...row.match,
        hostUsername: row.hostUsername,
        players: Number(row.players),
        subscribers: subscriberCount(row.match.id),
      }));
    }),

  /** Force-close a stuck lobby or match without paying rewards. */
  cancelMatch: adminProc
    .input(z.object({ matchId: z.string() }))
    .handler(async ({ input }) => {
      const [match] = await db
        .select()
        .from(schema.match)
        .where(eq(schema.match.id, input.matchId));
      if (!match) throw new ORPCError("NOT_FOUND", { message: "Match not found" });
      const [updated] = await db
        .update(schema.match)
        .set({ status: "cancelled", endTime: new Date() })
        .where(eq(schema.match.id, input.matchId))
        .returning();
      return updated!;
    }),

  battleLog: adminProc
    .input(z.object({ matchId: z.string(), limit: z.number().int().min(1).max(500).default(200) }))
    .handler(({ input }) =>
      db
        .select()
        .from(schema.battleEvent)
        .where(eq(schema.battleEvent.matchId, input.matchId))
        .orderBy(schema.battleEvent.seq)
        .limit(input.limit),
    ),

  /* --------------------------------------------------------- marketplace */

  listings: adminProc
    .input(
      z.object({
        status: z.enum(["active", "sold", "cancelled"]).optional(),
        limit: z.number().int().min(1).max(200).default(60),
      }).optional(),
    )
    .handler(() =>
      db
        .select()
        .from(schema.marketplaceListing)
        .orderBy(desc(schema.marketplaceListing.createdAt))
        .limit(60),
    ),

  /** Pull a listing off the market without paying anyone. */
  takedownListing: adminProc
    .input(z.object({ listingId: z.string() }))
    .handler(async ({ input }) => {
      const [listing] = await db
        .select()
        .from(schema.marketplaceListing)
        .where(eq(schema.marketplaceListing.id, input.listingId));
      if (!listing) throw new ORPCError("NOT_FOUND", { message: "Listing not found" });
      const [updated] = await db
        .update(schema.marketplaceListing)
        .set({ status: "cancelled" })
        .where(eq(schema.marketplaceListing.id, input.listingId))
        .returning();
      await db
        .update(schema.boosterInstance)
        .set({ listedListingId: null })
        .where(eq(schema.boosterInstance.listedListingId, input.listingId));
      await db
        .update(schema.item)
        .set({ listedListingId: null })
        .where(eq(schema.item.listedListingId, input.listingId));
      return updated!;
    }),

  economy: adminProc.handler(async () => {
    const [currency] = await db
      .select({
        total: sql<number>`coalesce(sum(${schema.player.currency}), 0)`,
        players: sql<number>`count(*)`,
      })
      .from(schema.player);
    const [fees] = await db
      .select({ total: sql<number>`coalesce(sum(${schema.transaction.fee}), 0)` })
      .from(schema.transaction)
      .where(eq(schema.transaction.type, "market_sale"));
    const [sales] = await db
      .select({
        count: sql<number>`count(*)`,
        volume: sql<number>`coalesce(sum(${schema.marketplaceListing.price}), 0)`,
      })
      .from(schema.marketplaceListing)
      .where(eq(schema.marketplaceListing.status, "sold"));
    const recent = await db
      .select()
      .from(schema.transaction)
      .orderBy(desc(schema.transaction.createdAt))
      .limit(25);
    return {
      currencyInCirculation: Number(currency?.total ?? 0),
      players: Number(currency?.players ?? 0),
      feesCollected: Number(fees?.total ?? 0),
      sales: Number(sales?.count ?? 0),
      salesVolume: Number(sales?.volume ?? 0),
      recentTransactions: recent,
    };
  }),

  /* ----------------------------------------------------------------- cron */

  jobs: adminProc.handler(() => jobStatus()),

  runJob: adminProc
    .input(z.object({ job: z.enum(JOB_NAMES as [string, ...string[]]) }))
    .handler(({ input }) => runJob(input.job as (typeof JOB_NAMES)[number], "manual")),

  cronHistory: adminProc
    .input(z.object({ job: z.string().optional(), limit: z.number().int().min(1).max(100).default(40) }).optional())
    .handler(({ input }) =>
      db
        .select()
        .from(schema.cronRun)
        .where(input?.job ? eq(schema.cronRun.job, input.job) : undefined)
        .orderBy(desc(schema.cronRun.startedAt))
        .limit(input?.limit ?? 40),
    ),

  /** Weekly leaderboard snapshots, newest week first. */
  leaderboardSnapshots: adminProc
    .input(z.object({ weekStart: z.string().optional() }).optional())
    .handler(({ input }) =>
      db
        .select()
        .from(schema.leaderboardEntry)
        .where(
          input?.weekStart
            ? and(eq(schema.leaderboardEntry.weekStart, input.weekStart))
            : undefined,
        )
        .orderBy(desc(schema.leaderboardEntry.weekStart), schema.leaderboardEntry.rank)
        .limit(200),
    ),
};
