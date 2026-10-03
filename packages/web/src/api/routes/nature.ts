import { z } from "zod";
import { base } from "../__core/app";
import { playerProc } from "../middleware/auth";
import {
  DEFAULT_SEARCH_RADIUS_M,
  collectSpawn,
  getZone,
  listZones,
  nearbySpawns,
  nearestZone,
} from "../services/nature";
import {
  PERSONAL_DROPS_PER_DAY,
  PERSONAL_DROP_COOLDOWN_MS,
  PERSONAL_DROP_RANGE_M,
  dropAllowance,
} from "../services/drops";

/**
 * Nature Exploration (GPS). Clients poll `nearby` with the device position and
 * get back the spawn points around them, each with a live distance and an
 * `inRange` flag. `collect` re-validates the position server-side, so a client
 * that lies about where it is gets rejected.
 */
export const nature = {
  zones: base.handler(() => listZones()),

  zone: base
    .input(z.object({ zoneId: z.string() }))
    .handler(({ input }) => getZone(input.zoneId)),

  /** The zone a coordinate belongs to — matchmaking uses the same resolution. */
  nearestZone: base
    .input(z.object({ lat: z.number().optional(), lng: z.number().optional() }).optional())
    .handler(({ input }) => nearestZone(input?.lat, input?.lng)),

  nearby: playerProc
    .input(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusM: z.number().int().min(50).max(20_000).default(DEFAULT_SEARCH_RADIUS_M),
      }),
    )
    .handler(({ input, context }) =>
      nearbySpawns({
        lat: input.lat,
        lng: input.lng,
        radiusM: input.radiusM,
        playerId: context.player.id,
      }),
    ),

  /** Free personal drops: how many are left today and when the next one can land. */
  drops: playerProc.handler(async ({ context }) => ({
    perDay: PERSONAL_DROPS_PER_DAY,
    cooldownMs: PERSONAL_DROP_COOLDOWN_MS,
    /** How close to a reviewed park's edge a player must be for one to land. */
    rangeM: PERSONAL_DROP_RANGE_M,
    ...(await dropAllowance(context.player.id)),
  })),

  /** Pick up a booster. Requires physical proximity to the spawn point. */
  collect: playerProc
    .input(
      z.object({
        spawnPointId: z.string(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      }),
    )
    .handler(({ input, context }) =>
      collectSpawn({
        spawnPointId: input.spawnPointId,
        playerId: context.player.id,
        lat: input.lat,
        lng: input.lng,
      }),
    ),
};
