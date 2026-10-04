import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { distanceM } from "../lib/geo";

/**
 * Server-measured movement speed.
 *
 * The client's own speed reading is trivially faked, so the pickup gate also
 * works out speed from the last two positions the server received for the
 * same player. GPS wanders, so short hops and tiny time gaps are ignored —
 * the point is to catch someone in a car or a spoofed jump across town, not
 * to punish a jittery fix.
 */

/** Below this gap the time base is too short to trust. */
const MIN_GAP_MS = 3_000;
/** Above this gap the previous fix says nothing about current motion. */
const MAX_GAP_MS = 10 * 60_000;
/** Movement smaller than this is treated as GPS noise. */
const NOISE_M = 40;

export async function observeSpeed(playerId: string, lat: number, lng: number): Promise<number | null> {
  const [prev] = await db
    .select({ lat: schema.player.motionLat, lng: schema.player.motionLng, at: schema.player.motionAt })
    .from(schema.player)
    .where(eq(schema.player.id, playerId));

  const now = Date.now();
  let speed: number | null = null;
  if (prev?.lat != null && prev.lng != null && prev.at) {
    const gap = now - prev.at.getTime();
    // Calls in quick succession keep the older fix as the base, so frequent
    // polling can't keep resetting the clock and hide a fast move.
    if (gap < MIN_GAP_MS) return null;
    const moved = distanceM({ lat, lng }, { lat: prev.lat, lng: prev.lng });
    if (gap >= MIN_GAP_MS && gap <= MAX_GAP_MS && moved > NOISE_M) {
      speed = moved / (gap / 1000);
    } else if (gap >= MIN_GAP_MS && gap <= MAX_GAP_MS) {
      speed = 0;
    }
  }

  await db
    .update(schema.player)
    .set({ motionLat: lat, motionLng: lng, motionAt: new Date(now) })
    .where(eq(schema.player.id, playerId));
  return speed;
}

/** Of the client's reading and ours, believe whichever says faster. */
export function worstSpeed(client: number | null | undefined, server: number | null) {
  const values = [client, server].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return values.length ? Math.max(...values) : null;
}
