import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { distanceM, randomPointInRadius } from "../lib/geo";
import { approvedZones, spawnInZone } from "./nature";
import { hazardsNear } from "./safety";

/**
 * Personal drops — free boosters for showing up at a park.
 *
 * When a player opens the map near an approved park, pitch or playground, a
 * booster is dropped inside it just for them: nobody else can see it or race
 * them to it, and they still have to walk there to pick it up. A few a day,
 * with a gap between them, so it rewards getting out rather than refreshing.
 *
 * Only approved zones qualify. Zones arrive from OpenStreetMap as proposals and
 * a human signs them off before anyone is sent to them — that gate is the
 * child-safety layer and personal drops do not get to route around it.
 */

export const PERSONAL_DROPS_PER_DAY = 3;
export const PERSONAL_DROP_COOLDOWN_MS = 2 * 3_600_000;
/** How far from a zone's edge a player can be and still get a drop there. */
export const PERSONAL_DROP_RANGE_M = 1_500;
/** Personal drops last until the next day, like the shared scatter. */
const PERSONAL_DROP_TTL_HOURS = 26;
/** Keep drops this far clear of any hazard — the pickup check would refuse them anyway. */
const HAZARD_CLEARANCE_M = 40;

/**
 * The map is polled every few seconds; the drop check does not need to be. One
 * look per player per minute, per server process, keeps it to a couple of
 * cheap queries at most. It is a throttle, not the rule — the rule is the DB.
 */
const nextCheckAt = new Map<string, number>();
const CHECK_EVERY_MS = 60_000;
const inFlight = new Set<string>();

export type DropAllowance = {
  usedToday: number;
  remainingToday: number;
  nextDropAt: Date | null;
};

export async function dropAllowance(playerId: string): Promise<DropAllowance> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const recent = await db
    .select({ createdAt: schema.spawnPoint.createdAt })
    .from(schema.spawnPoint)
    .where(
      and(eq(schema.spawnPoint.reservedForPlayerId, playerId), gt(schema.spawnPoint.createdAt, since)),
    )
    .orderBy(desc(schema.spawnPoint.createdAt));
  const usedToday = recent.length;
  const remainingToday = Math.max(0, PERSONAL_DROPS_PER_DAY - usedToday);
  const last = recent[0]?.createdAt?.getTime() ?? 0;
  const cooldownEnds = last + PERSONAL_DROP_COOLDOWN_MS;
  // When the daily cap is what blocks, the next slot opens when the oldest one ages out.
  const capEnds =
    remainingToday === 0 ? (recent[recent.length - 1]?.createdAt?.getTime() ?? 0) + 24 * 3_600_000 : 0;
  const next = Math.max(cooldownEnds, capEnds);
  return { usedToday, remainingToday, nextDropAt: next > Date.now() ? new Date(next) : null };
}

/** Pick a spot in the zone that is clear of hazards. Null when none can be found. */
async function clearSpotIn(zone: typeof schema.zone.$inferSelect) {
  for (let attempt = 0; attempt < 6; attempt++) {
    // Stay off the boundary: an inscribed radius can still brush a fence line.
    const point = randomPointInRadius({ lat: zone.centerLat, lng: zone.centerLng }, zone.radiusM * 0.75);
    // The safety layer's own scan radius: a big hazard (a lake, a private site)
    // can cover this point from a centre well past the clearance distance.
    const hazards = await hazardsNear(point.lat, point.lng);
    if (!hazards.some((h) => h.distanceM <= h.radiusM + HAZARD_CLEARANCE_M)) return point;
  }
  return null;
}

/**
 * Drop a booster for this player if they are near an approved zone and have
 * allowance left. Returns the drop, or null. Never throws — a failed drop must
 * not break the map read it piggybacks on.
 */
export async function maybeDropForPlayer(playerId: string, lat: number, lng: number) {
  const now = Date.now();
  if ((nextCheckAt.get(playerId) ?? 0) > now || inFlight.has(playerId)) return null;
  nextCheckAt.set(playerId, now + CHECK_EVERY_MS);
  inFlight.add(playerId);
  try {
    const allowance = await dropAllowance(playerId);
    if (allowance.remainingToday === 0 || allowance.nextDropAt) return null;

    const zones = await approvedZones();
    const nearest = zones
      .map((zone) => ({
        zone,
        // Distance to the zone's edge, not its centre: a big park counts from its gate.
        edgeM: Math.max(0, distanceM({ lat, lng }, { lat: zone.centerLat, lng: zone.centerLng }) - zone.radiusM),
      }))
      .filter((entry) => entry.edgeM <= PERSONAL_DROP_RANGE_M)
      .sort((a, b) => a.edgeM - b.edgeM)[0];
    if (!nearest) return null;

    const point = await clearSpotIn(nearest.zone);
    if (!point) return null;

    const { spawn, booster } = await spawnInZone(nearest.zone, {
      point,
      reservedForPlayerId: playerId,
      ttlHours: PERSONAL_DROP_TTL_HOURS,
      description: `Dropped for you in ${nearest.zone.name}. Nobody else can see this one.`,
    });
    return { spawn, booster, zoneName: nearest.zone.name };
  } catch (error) {
    console.warn(`[drops] personal drop failed for ${playerId}:`, error);
    return null;
  } finally {
    inFlight.delete(playerId);
  }
}
