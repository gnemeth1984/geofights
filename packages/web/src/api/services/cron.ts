import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids } from "../lib/ids";
import { RARITIES } from "../database/schema";
import { createBoosterDefinition, ensureShopStock } from "./boosters";
import { generateAvatar } from "./avatars";
import { approvedZones, refreshDailySpawns, refreshZones } from "./nature";
import { importFromOsm } from "./safety";
import { leaderboard } from "./players";
import { list as listOnMarket } from "./marketplace";
import { reapStaleMatches } from "./matches";
import { closePastMeetups } from "./meetups";
import { pruneChat } from "./teams";

/**
 * Scheduled jobs.
 *
 * Runable serves the API from a single Bun process, so the scheduler is an
 * in-process ticker (`startScheduler`) that checks the `cron_run` table for
 * the last successful run of each job and fires the ones that are due. That
 * makes it idempotent and restart-safe: a redeploy mid-day does not double-run
 * a daily job, and a process that was down simply runs the job late.
 *
 * Every job is also callable on demand:
 *   - admin panel / RPC: `admin.runJob`
 *   - external scheduler: `POST /api/cron/:job` with `x-cron-secret`
 * so the same logic can be driven by a platform cron later without changes.
 */

export const JOBS = {
  "daily-booster-spawn": {
    intervalMs: 24 * 3_600_000,
    description: "Scatter fresh GPS booster spawns across every active zone.",
    run: runDailyBoosterSpawn,
  },
  "daily-zone-refresh": {
    intervalMs: 24 * 3_600_000,
    description: "Reweight zones by recent activity and retire stale spawns.",
    run: runZoneRefresh,
  },
  "weekly-leaderboard-reset": {
    intervalMs: 7 * 24 * 3_600_000,
    description: "Snapshot the weekly top 25 and start a new competitive week.",
    run: runLeaderboardReset,
  },
  "weekly-safety-scan": {
    intervalMs: 7 * 24 * 3_600_000,
    description: "Re-scan OpenStreetMap around every approved zone for new hazards.",
    run: runSafetyScan,
  },
  "weekly-ai-avatars": {
    intervalMs: 7 * 24 * 3_600_000,
    description: "Generate the weekly AI avatar drop and rotate the booster pool.",
    run: runWeeklyAiAvatars,
  },
  "community-housekeeping": {
    intervalMs: 6 * 3_600_000,
    description: "Prune chat past its retention window and close finished park meet-ups.",
    run: runCommunityHousekeeping,
  },
  "stale-match-reaper": {
    intervalMs: 15 * 60_000,
    description: "Cancel matches abandoned mid-fight so they stop sitting open.",
    run: runStaleMatchReaper,
  },
} satisfies Record<string, JobDef>;

export type JobName = keyof typeof JOBS;

interface JobDef {
  intervalMs: number;
  description: string;
  run: () => Promise<Record<string, unknown>>;
}

export const JOB_NAMES = Object.keys(JOBS) as JobName[];

export function isJobName(value: string): value is JobName {
  return Object.hasOwn(JOBS, value);
}

/* ------------------------------------------------------------------- Runner */

/** Run a job with locking and `cron_run` bookkeeping. */
export async function runJob(job: JobName, trigger: "schedule" | "manual" = "manual") {
  const stale = new Date(Date.now() - 15 * 60_000);
  const [running] = await db
    .select({ id: schema.cronRun.id })
    .from(schema.cronRun)
    .where(
      and(
        eq(schema.cronRun.job, job),
        eq(schema.cronRun.status, "running"),
        gt(schema.cronRun.startedAt, stale),
      ),
    );
  if (running) return { job, skipped: "already running" as const };

  const [run] = await db
    .insert(schema.cronRun)
    .values({ id: ids.cronRun(), job, status: "running", trigger })
    .returning();

  try {
    const detail = await JOBS[job].run();
    await db
      .update(schema.cronRun)
      .set({ status: "ok", finishedAt: new Date(), detail: JSON.stringify(detail) })
      .where(eq(schema.cronRun.id, run!.id));
    return { job, runId: run!.id, status: "ok" as const, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(schema.cronRun)
      .set({ status: "error", finishedAt: new Date(), detail: message })
      .where(eq(schema.cronRun.id, run!.id));
    return { job, runId: run!.id, status: "error" as const, error: message };
  }
}

/** Jobs whose interval has elapsed since their last successful run. */
export async function dueJobs(now = Date.now()) {
  const due: JobName[] = [];
  for (const job of JOB_NAMES) {
    const [last] = await db
      .select({ startedAt: schema.cronRun.startedAt })
      .from(schema.cronRun)
      .where(and(eq(schema.cronRun.job, job), eq(schema.cronRun.status, "ok")))
      .orderBy(desc(schema.cronRun.startedAt))
      .limit(1);
    if (!last || now - last.startedAt.getTime() >= JOBS[job].intervalMs) due.push(job);
  }
  return due;
}

/** Run every due job. Called by the ticker and by `POST /api/cron/tick`. */
export async function runDueJobs(trigger: "schedule" | "manual" = "schedule") {
  const due = await dueJobs();
  const results = [];
  for (const job of due) results.push(await runJob(job, trigger));
  return { ran: results.length, results };
}

let ticker: ReturnType<typeof setInterval> | undefined;

/** Start the in-process scheduler. Safe to call more than once. */
export function startScheduler(intervalMs = 5 * 60_000) {
  if (ticker || process.env.DISABLE_CRON === "1") return { started: false };
  ticker = setInterval(() => {
    void runDueJobs("schedule").catch((error) => console.error("[cron] tick failed", error));
  }, intervalMs);
  // Never hold the process open just for the ticker.
  (ticker as unknown as { unref?: () => void }).unref?.();
  return { started: true, intervalMs };
}

export async function jobStatus() {
  const rows = await db
    .select()
    .from(schema.cronRun)
    .orderBy(desc(schema.cronRun.startedAt))
    .limit(50);
  const due = await dueJobs();
  return {
    jobs: JOB_NAMES.map((job) => {
      const last = rows.find((row) => row.job === job && row.status !== "running");
      return {
        job,
        description: JOBS[job].description,
        intervalMs: JOBS[job].intervalMs,
        due: due.includes(job),
        lastRunAt: last?.startedAt ?? null,
        lastStatus: last?.status ?? null,
        lastDetail: last?.detail ?? null,
      };
    }),
    history: rows.slice(0, 25),
  };
}

/* --------------------------------------------------------------------- Jobs */

async function runDailyBoosterSpawn() {
  const result = await refreshDailySpawns();
  const restocked = await ensureShopStock();
  return { ...result, shopRestocked: restocked.length };
}

async function runZoneRefresh() {
  const result = await refreshZones();
  return { ...result };
}

/**
 * Sweeps up matches whose players walked away. Runs often and cheaply — it
 * only ever touches rows that are still `waiting` or `active`.
 */
async function runStaleMatchReaper() {
  const result = await reapStaleMatches();
  return { ...result };
}

/**
 * Snapshots the week's standings into `leaderboard_entry`, then opens a new
 * week. Lifetime player stats are never wiped — the "reset" is the snapshot
 * boundary, so history stays queryable per week.
 */
/**
 * Keeps the hazard map current: roads get built, fences move. New play-area
 * candidates found on the way land as proposals for review, never live.
 */
async function runSafetyScan() {
  const zones = await approvedZones();
  const scanned: { zoneId: string; hazards: number; proposed: number }[] = [];
  let hazards = 0;
  let proposed = 0;
  // Overpass is a shared public service — a handful of zones per run, spaced.
  for (const zone of zones.slice(0, 10)) {
    try {
      const result = await importFromOsm({
        lat: zone.centerLat,
        lng: zone.centerLng,
        radiusM: Math.min(3_000, zone.radiusM + 500),
      });
      hazards += result.hazards.length;
      proposed += result.proposed.length;
      scanned.push({
        zoneId: zone.id,
        hazards: result.hazards.length,
        proposed: result.proposed.length,
      });
    } catch (error) {
      scanned.push({ zoneId: zone.id, hazards: 0, proposed: 0 });
      console.warn(`[cron] safety scan failed for ${zone.id}:`, error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return { zonesScanned: scanned.length, hazards, proposed, detail: scanned };
}

async function runLeaderboardReset() {
  const weekStart = mondayOf(new Date()).toISOString().slice(0, 10);
  const top = await leaderboard(25);
  let rank = 0;
  for (const row of top) {
    rank++;
    await db
      .insert(schema.leaderboardEntry)
      .values({
        id: ids.leaderboard(),
        weekStart,
        playerId: row.playerId,
        username: row.username,
        rank,
        wins: row.wins,
        xp: row.xp,
      })
      .onConflictDoUpdate({
        target: [schema.leaderboardEntry.weekStart, schema.leaderboardEntry.playerId],
        set: { rank, wins: row.wins, xp: row.xp },
      });
  }
  return { weekStart, entries: rank };
}

/**
 * Weekly content drop: three AI avatars minted to the house account and listed
 * on the marketplace, plus one fresh booster definition per rarity so the shop
 * and nature pools keep changing.
 */
async function runWeeklyAiAvatars() {
  const house = await ensureHousePlayer();
  const listed: { avatarId: string; name: string; price: number }[] = [];

  // Keep the house at three slots: clear last week's unsold stock first.
  await clearHouseStock(house.id);

  const plan: { rarity: (typeof RARITIES)[number]; price: number }[] = [
    { rarity: "rare", price: 900 },
    { rarity: "epic", price: 2_200 },
    { rarity: "legendary", price: 5_000 },
  ];
  for (const entry of plan) {
    const avatar = await generateAvatar({
      ownerId: house.id,
      playerName: "the Foundry",
      theme: "weekly foundry drop",
      rarity: entry.rarity,
    });
    await listOnMarket({
      sellerId: house.id,
      itemType: "avatar",
      itemId: avatar.id,
      price: entry.price,
    });
    listed.push({ avatarId: avatar.id, name: avatar.name, price: entry.price });
  }

  const boosters = [];
  for (const rarity of RARITIES) {
    const definition = await createBoosterDefinition({ rarity, origin: "any" });
    boosters.push({ id: definition.id, name: definition.name, rarity });
  }

  return { avatars: listed, boosters };
}

/* ------------------------------------------------------------------ Helpers */

/** The system seller that weekly AI content is minted to. */
export async function ensureHousePlayer() {
  const [existing] = await db
    .select()
    .from(schema.player)
    .where(eq(schema.player.userId, "system:house"));
  if (existing) return existing;
  const [created] = await db
    .insert(schema.player)
    .values({
      id: ids.player(),
      userId: "system:house",
      username: "TheFoundry",
      // Deliberately not an admin. The house only ever needs to own and list
      // stock, and nothing signs in as it — giving it `admin` would hand every
      // admin procedure to a row the cron creates unattended.
      role: "player",
      currency: 0,
    })
    .returning();
  return created!;
}

async function clearHouseStock(houseId: string) {
  const stale = await db
    .select()
    .from(schema.marketplaceListing)
    .where(
      and(
        eq(schema.marketplaceListing.sellerId, houseId),
        eq(schema.marketplaceListing.status, "active"),
      ),
    );
  for (const listing of stale) {
    await db
      .update(schema.marketplaceListing)
      .set({ status: "cancelled" })
      .where(eq(schema.marketplaceListing.id, listing.id));
    if (listing.itemType === "avatar") {
      await db.delete(schema.avatar).where(eq(schema.avatar.id, listing.itemId));
    }
  }
  // Drop any unlisted leftovers so the house never blocks its own slots.
  const orphans = await db
    .select({ id: schema.avatar.id })
    .from(schema.avatar)
    .where(eq(schema.avatar.ownerId, houseId));
  for (const orphan of orphans) {
    const [active] = await db
      .select({ id: schema.marketplaceListing.id })
      .from(schema.marketplaceListing)
      .where(
        and(
          eq(schema.marketplaceListing.itemId, orphan.id),
          eq(schema.marketplaceListing.status, "active"),
        ),
      );
    if (!active) await db.delete(schema.avatar).where(eq(schema.avatar.id, orphan.id));
  }
}

function mondayOf(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d;
}

/** Weekly snapshots, newest first. */
export async function weeklyLeaderboards(limit = 25) {
  const [latest] = await db
    .select({ weekStart: schema.leaderboardEntry.weekStart })
    .from(schema.leaderboardEntry)
    .orderBy(desc(schema.leaderboardEntry.weekStart))
    .limit(1);
  if (!latest) return { weekStart: null, entries: [] };
  const entries = await db
    .select()
    .from(schema.leaderboardEntry)
    .where(eq(schema.leaderboardEntry.weekStart, latest.weekStart))
    .orderBy(schema.leaderboardEntry.rank)
    .limit(limit);
  return { weekStart: latest.weekStart, entries };
}

/** Rough health counters for the admin dashboard. */
export async function systemStats() {
  const counts = await Promise.all(
    [
      ["players", schema.player],
      ["avatars", schema.avatar],
      ["boosterDefinitions", schema.booster],
      ["boosterInstances", schema.boosterInstance],
      ["zones", schema.zone],
      ["matches", schema.match],
      ["listings", schema.marketplaceListing],
      ["transactions", schema.transaction],
    ].map(async ([key, table]) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        // biome-ignore lint/suspicious/noExplicitAny: heterogeneous table list
        .from(table as any);
      return [key as string, Number(row?.count ?? 0)] as const;
    }),
  );

  const [liveSpawns] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.spawnPoint)
    .where(
      and(isNull(schema.spawnPoint.collectedByPlayerId), gt(schema.spawnPoint.expiresAt, new Date())),
    );
  const [activeMatches] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.match)
    .where(eq(schema.match.status, "active"));

  return {
    ...Object.fromEntries(counts),
    liveSpawns: Number(liveSpawns?.count ?? 0),
    activeMatches: Number(activeMatches?.count ?? 0),
  };
}

/* --------------------------------------------------------- Community chores */

async function runCommunityHousekeeping() {
  const chat = await pruneChat();
  const meetups = await closePastMeetups();
  return { ...chat, ...meetups };
}
