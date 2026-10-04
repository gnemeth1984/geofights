import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { type Rarity } from "../database/schema";
import { generateSpawnDescription } from "../ai/content";
import { ids } from "../lib/ids";
import { boundingBox, distanceM, randomPointInRadius } from "../lib/geo";
import { randomInt, rollRarity } from "../lib/rng";
import { BOOSTER_XP_REWARD, awardBoosterXp, mintBoosterInstance, pickBoosterDefinition } from "./boosters";
import { logTransaction, touchLocation } from "./players";
import { requireSafe, unsafeError } from "./safety";
import { maybeDropForPlayer } from "./drops";

/**
 * Nature Exploration — GPS-anchored booster spawns.
 *
 * Zones are curated circles on the map. A daily cron scatters spawn points
 * inside every active zone (weighted by `spawnWeight`); a player can only
 * collect one while physically inside `collectRadiusM` of it. Uncollected
 * points expire when the next refresh runs.
 */

/** Spawn points generated per unit of zone `spawnWeight` on each refresh. */
export const SPAWNS_PER_WEIGHT = 6;
/** How long a daily spawn stays collectable. */
export const SPAWN_TTL_HOURS = 26;
/** Default search radius when a client asks "what's near me". */
export const DEFAULT_SEARCH_RADIUS_M = 1_500;

/** Seed zone used when no zone exists yet and a match needs one. */
const FALLBACK_ZONE = {
  name: "Null Commons",
  description: "The default staging ground — a flat, open arena for early matches.",
  centerLat: 0,
  centerLng: 0,
  radiusM: 600,
  spawnWeight: 1,
  terrain: "open plain",
};

/* -------------------------------------------------------------------- Zones */

export async function listZones(opts: { includeInactive?: boolean; includeUnapproved?: boolean } = {}) {
  const rows = await db
    .select({
      zone: schema.zone,
      // NOTE: the outer column is written fully qualified on purpose. Drizzle emits a
      // bare `"id"` for a single-table select, which SQLite would then resolve against
      // the subquery's own table (spawn_point.id) instead of zone.id.
      liveSpawns: sql<number>`(
        select count(*) from spawn_point sp
        where sp.zone_id = "zone"."id"
          and sp.collected_by_player_id is null
          and sp.expires_at > ${Date.now()}
      )`,
    })
    .from(schema.zone)
    .where(
      and(
        opts.includeInactive ? undefined : eq(schema.zone.isActive, true),
        // Players only ever see ground a human operator has signed off on.
        opts.includeUnapproved ? undefined : eq(schema.zone.review, "approved"),
      ),
    )
    .orderBy(desc(schema.zone.spawnWeight), asc(schema.zone.name));
  return rows.map((row) => ({ ...row.zone, liveSpawns: Number(row.liveSpawns) }));
}

export async function getZone(zoneId: string) {
  const [row] = await db.select().from(schema.zone).where(eq(schema.zone.id, zoneId));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Zone not found" });
  return row;
}

export async function createZone(input: {
  name: string;
  description?: string;
  centerLat: number;
  centerLng: number;
  radiusM?: number;
  spawnWeight?: number;
  terrain?: string;
  /** Set when the zone was picked from an OpenStreetMap feature. */
  osmRef?: string;
}) {
  const [row] = await db
    .insert(schema.zone)
    .values({
      id: ids.zone(),
      name: input.name,
      description: input.description ?? null,
      centerLat: input.centerLat,
      centerLng: input.centerLng,
      radiusM: input.radiusM ?? 500,
      spawnWeight: input.spawnWeight ?? 1,
      terrain: input.terrain ?? null,
      ...(input.osmRef ? { osmRef: input.osmRef, source: "osm" as const } : {}),
    })
    .returning();
  return row!;
}

export async function updateZone(input: {
  zoneId: string;
  name?: string;
  description?: string;
  radiusM?: number;
  spawnWeight?: number;
  terrain?: string;
  isActive?: boolean;
}) {
  const { zoneId, ...patch } = input;
  await getZone(zoneId);
  const [row] = await db
    .update(schema.zone)
    .set(patch)
    .where(eq(schema.zone.id, zoneId))
    .returning();
  return row!;
}

export async function deleteZone(zoneId: string) {
  await getZone(zoneId);
  await db.delete(schema.spawnPoint).where(eq(schema.spawnPoint.zoneId, zoneId));
  await db.delete(schema.zone).where(eq(schema.zone.id, zoneId));
  return { deleted: zoneId };
}

/**
 * Closest active zone to a coordinate, falling back to the highest-weighted
 * zone, and finally seeding the default zone so matchmaking always resolves.
 */
export async function nearestZone(lat?: number, lng?: number) {
  const zones = await approvedZones();
  if (zones.length === 0) return createZone(FALLBACK_ZONE);
  if (lat === undefined || lng === undefined) {
    return [...zones].sort((a, b) => b.spawnWeight - a.spawnWeight)[0]!;
  }
  return [...zones].sort(
    (a, b) =>
      distanceM({ lat, lng }, { lat: a.centerLat, lng: a.centerLng }) -
      distanceM({ lat, lng }, { lat: b.centerLat, lng: b.centerLng }),
  )[0]!;
}

/** Zones that are live and approved — the only ground play may happen on. */
export async function approvedZones() {
  return db
    .select()
    .from(schema.zone)
    .where(and(eq(schema.zone.isActive, true), eq(schema.zone.review, "approved")));
}

/* -------------------------------------------------------------- Spawn points */

/** Uncollected, unexpired spawns near a coordinate, with distance + reachability. */
export async function nearbySpawns(input: {
  lat: number;
  lng: number;
  radiusM?: number;
  playerId?: string;
}) {
  const radius = input.radiusM ?? DEFAULT_SEARCH_RADIUS_M;
  const box = boundingBox({ lat: input.lat, lng: input.lng }, radius);
  // Near a park with drops left today? Put one down before reading the map.
  if (input.playerId) await maybeDropForPlayer(input.playerId, input.lat, input.lng);

  const rows = await db
    .select({
      spawn: schema.spawnPoint,
      booster: schema.booster,
      zoneName: schema.zone.name,
    })
    .from(schema.spawnPoint)
    .innerJoin(schema.booster, eq(schema.booster.id, schema.spawnPoint.boosterId))
    .leftJoin(schema.zone, eq(schema.zone.id, schema.spawnPoint.zoneId))
    .where(
      and(
        isNull(schema.spawnPoint.collectedByPlayerId),
        gt(schema.spawnPoint.expiresAt, new Date()),
        // Personal drops are invisible to everyone but the player they were dropped for.
        input.playerId
          ? or(
              isNull(schema.spawnPoint.reservedForPlayerId),
              eq(schema.spawnPoint.reservedForPlayerId, input.playerId),
            )
          : isNull(schema.spawnPoint.reservedForPlayerId),
        sql`${schema.spawnPoint.lat} between ${box.minLat} and ${box.maxLat}`,
        sql`${schema.spawnPoint.lng} between ${box.minLng} and ${box.maxLng}`,
      ),
    )
    .limit(300);

  if (input.playerId) await touchLocation(input.playerId, input.lat, input.lng);

  return rows
    .map((row) => {
      const distance = Math.round(
        distanceM({ lat: input.lat, lng: input.lng }, { lat: row.spawn.lat, lng: row.spawn.lng }),
      );
      return {
        id: row.spawn.id,
        zoneId: row.spawn.zoneId,
        zoneName: row.zoneName,
        lat: row.spawn.lat,
        lng: row.spawn.lng,
        rarity: row.spawn.rarity,
        description: row.spawn.description,
        collectRadiusM: row.spawn.collectRadiusM,
        expiresAt: row.spawn.expiresAt,
        personal: row.spawn.reservedForPlayerId != null,
        distanceM: distance,
        inRange: distance <= row.spawn.collectRadiusM,
        booster: {
          id: row.booster.id,
          name: row.booster.name,
          rarity: row.booster.rarity,
          tier: row.booster.tier,
          description: row.booster.description,
          statModifiers: JSON.parse(row.booster.statModifiers) as Record<string, number>,
          unlocksAbility: row.booster.unlocksAbility,
        },
      };
    })
    .filter((row) => row.distanceM <= radius)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/**
 * Collect a spawn. Server-authoritative: the reported position must be within
 * the spawn's `collectRadiusM`, and each point can only ever be taken once.
 */
export async function collectSpawn(input: {
  spawnPointId: string;
  playerId: string;
  lat: number;
  lng: number;
}) {
  const [row] = await db
    .select({ spawn: schema.spawnPoint, booster: schema.booster })
    .from(schema.spawnPoint)
    .innerJoin(schema.booster, eq(schema.booster.id, schema.spawnPoint.boosterId))
    .where(eq(schema.spawnPoint.id, input.spawnPointId));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Spawn point not found" });
  if (row.spawn.reservedForPlayerId && row.spawn.reservedForPlayerId !== input.playerId) {
    throw new ORPCError("NOT_FOUND", { message: "Spawn point not found" });
  }
  if (row.spawn.collectedByPlayerId) {
    throw new ORPCError("BAD_REQUEST", { message: "Already collected" });
  }
  if (row.spawn.expiresAt.getTime() < Date.now()) {
    throw new ORPCError("BAD_REQUEST", { message: "This spawn has faded away" });
  }

  const distance = Math.round(
    distanceM({ lat: input.lat, lng: input.lng }, { lat: row.spawn.lat, lng: row.spawn.lng }),
  );
  if (distance > row.spawn.collectRadiusM) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Too far away — ${distance}m out, get within ${row.spawn.collectRadiusM}m`,
    });
  }

  // A pickup is the one action that asks a child to walk somewhere, so the
  // safety layer decides whether that somewhere is allowed.
  const safety = await requireSafe({
    playerId: input.playerId,
    kind: "collect",
    lat: input.lat,
    lng: input.lng,
    need: "pickup",
  });
  if (!safety.canPickup) throw unsafeError(safety);

  // Conditional update doubles as the claim lock against concurrent pickups.
  const claimed = await db
    .update(schema.spawnPoint)
    .set({ collectedByPlayerId: input.playerId, collectedAt: new Date() })
    .where(
      and(
        eq(schema.spawnPoint.id, input.spawnPointId),
        isNull(schema.spawnPoint.collectedByPlayerId),
      ),
    )
    .returning();
  if (claimed.length === 0) {
    throw new ORPCError("BAD_REQUEST", { message: "Someone else got there first" });
  }

  const instance = await mintBoosterInstance({
    boosterId: row.booster.id,
    ownerId: input.playerId,
    acquiredVia: "nature",
  });
  await logTransaction({
    type: "nature_pickup",
    toPlayerId: input.playerId,
    note: `Found ${row.booster.name} in the wild`,
  });
  await touchLocation(input.playerId, input.lat, input.lng);
  // Exploration levels the equipped loadout, slower than battling does.
  const boosterProgress = await awardBoosterXp({
    ownerId: input.playerId,
    amount: BOOSTER_XP_REWARD.exploration,
  });

  return {
    collected: true,
    distanceM: distance,
    instance,
    boosterProgress,
    booster: {
      ...row.booster,
      statModifiers: JSON.parse(row.booster.statModifiers) as Record<string, number>,
    },
  };
}

/** Create one spawn point inside a zone. Used by the cron and by admins. */
export async function spawnInZone(
  zone: typeof schema.zone.$inferSelect,
  opts: {
    rarity?: Rarity;
    ttlHours?: number;
    /** Where to put it. Defaults to anywhere inside the zone. */
    point?: { lat: number; lng: number };
    /** Makes it a personal drop only this player can see or collect. */
    reservedForPlayerId?: string;
    /** Skip the model call — used on the request path, where latency matters. */
    description?: string;
  } = {},
) {
  const rarity = opts.rarity ?? rollRarity();
  const definition = await pickBoosterDefinition(rarity, "nature");
  const point =
    opts.point ?? randomPointInRadius({ lat: zone.centerLat, lng: zone.centerLng }, zone.radiusM);
  const description =
    opts.description ??
    (await generateSpawnDescription({
      boosterName: definition.name,
      rarity,
      zoneName: zone.name,
      terrain: zone.terrain,
    }));

  const [row] = await db
    .insert(schema.spawnPoint)
    .values({
      id: ids.spawnPoint(),
      zoneId: zone.id,
      boosterId: definition.id,
      lat: point.lat,
      lng: point.lng,
      rarity,
      description,
      // Rarer finds demand tighter positioning.
      collectRadiusM: rarity === "legendary" || rarity === "epic" ? 15 : randomInt(20, 30),
      reservedForPlayerId: opts.reservedForPlayerId ?? null,
      expiresAt: new Date(Date.now() + (opts.ttlHours ?? SPAWN_TTL_HOURS) * 3_600_000),
    })
    .returning();
  return { spawn: row!, booster: definition };
}

/**
 * Daily refresh: drop expired/collected points, then scatter a fresh batch
 * across every active zone. Invoked by the `daily-spawn` cron job.
 */
export async function refreshDailySpawns(opts: { perWeight?: number } = {}) {
  const perWeight = opts.perWeight ?? SPAWNS_PER_WEIGHT;
  const purged = await db
    .delete(schema.spawnPoint)
    .where(lte(schema.spawnPoint.expiresAt, new Date()))
    .returning({ id: schema.spawnPoint.id });

  const zones = await approvedZones();
  if (zones.length === 0) {
    const seeded = await createZone(FALLBACK_ZONE);
    zones.push(seeded);
  }

  let created = 0;
  const perZone: { zoneId: string; zoneName: string; spawned: number }[] = [];
  for (const zone of zones) {
    const count = Math.max(1, Math.round(perWeight * zone.spawnWeight));
    for (let i = 0; i < count; i++) {
      await spawnInZone(zone);
      created++;
    }
    perZone.push({ zoneId: zone.id, zoneName: zone.name, spawned: count });
  }

  return { purged: purged.length, created, zones: perZone };
}

/**
 * Weekly zone rotation: reweights zones so the map keeps moving, and retires
 * zones that nobody has collected from. Invoked by the `zone-refresh` cron.
 */
export async function refreshZones() {
  const zones = await db.select().from(schema.zone);
  const touched: { zoneId: string; spawnWeight: number }[] = [];
  for (const zone of zones) {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.spawnPoint)
      .where(
        and(
          eq(schema.spawnPoint.zoneId, zone.id),
          sql`${schema.spawnPoint.collectedByPlayerId} is not null`,
        ),
      );
    const collected = Number(row?.count ?? 0);
    // Busy zones get denser, dead ones thin out but stay on the map.
    const spawnWeight = Math.min(6, Math.max(1, collected === 0 ? 1 : Math.ceil(collected / 4)));
    if (spawnWeight !== zone.spawnWeight) {
      await db.update(schema.zone).set({ spawnWeight }).where(eq(schema.zone.id, zone.id));
      touched.push({ zoneId: zone.id, spawnWeight });
    }
  }
  return { zones: zones.length, reweighted: touched };
}

/** A player's pickup history. */
export async function collectionLog(playerId: string, limit = 50) {
  const rows = await db
    .select({ spawn: schema.spawnPoint, booster: schema.booster, zoneName: schema.zone.name })
    .from(schema.spawnPoint)
    .innerJoin(schema.booster, eq(schema.booster.id, schema.spawnPoint.boosterId))
    .leftJoin(schema.zone, eq(schema.zone.id, schema.spawnPoint.zoneId))
    .where(eq(schema.spawnPoint.collectedByPlayerId, playerId))
    .orderBy(desc(schema.spawnPoint.collectedAt))
    .limit(limit);
  return rows.map((row) => ({
    spawnPointId: row.spawn.id,
    collectedAt: row.spawn.collectedAt,
    zoneName: row.zoneName,
    rarity: row.spawn.rarity,
    boosterName: row.booster.name,
  }));
}
