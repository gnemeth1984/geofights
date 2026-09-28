import { z } from "zod";
import { adminProc, playerProc } from "../middleware/auth";
import {
  MAX_PLAY_SPEED_MPS,
  VEHICLE_SPEED_MPS,
  assess,
  createHazard,
  deleteHazard,
  hazardsNear,
  importFromOsm,
  listHazards,
  logSafety,
  pendingZones,
  recentSafetyEvents,
  reviewZone,
} from "../services/safety";
import { DANGER_KINDS, ZONE_REVIEW } from "../database/schema";
import { MOVE_SETTLE_MS, WALK_SPEED_MPS } from "../battle/engine";

/**
 * Safety layer. The client calls `check` every few seconds with its GPS fix
 * and renders whatever comes back — it does not decide anything itself. The
 * same `assess()` the pickup and combat gates use answers here, so the overlay
 * can never disagree with what the server will allow.
 *
 * The operator half (OSM import, zone review, hazard editing) is admin-only:
 * zones proposed by the importer stay dark until a human approves them.
 */
export const safety = {
  /** Thresholds the client needs to render its own warnings between polls. */
  config: playerProc.handler(() => ({
    maxPlaySpeedMps: MAX_PLAY_SPEED_MPS,
    vehicleSpeedMps: VEHICLE_SPEED_MPS,
    walkSpeedMps: WALK_SPEED_MPS,
    moveSettleMs: MOVE_SETTLE_MS,
    hazardKinds: DANGER_KINDS,
    rules: [
      "Battles are stationary — walking pauses your own combat.",
      "Explore and collect on foot inside an approved play area.",
      "A road, railway or water edge overrides any play area it crosses.",
    ],
  })),

  /** The overlay verdict for a position. Logged so blocks leave a trail. */
  check: playerProc
    .input(
      z.object({
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        speedMps: z.number().min(0).max(200).optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const result = await assess(input);
      if (result.verdict !== "ok") {
        await logSafety({
          playerId: context.player.id,
          kind: "check",
          verdict: result.verdict,
          lat: input.lat,
          lng: input.lng,
          speedMps: input.speedMps,
          detail: result.headline,
        });
      }
      return result;
    }),

  /** Hazards to draw on the map around the player. */
  hazards: playerProc
    .input(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusM: z.number().int().min(50).max(2_000).default(500),
      }),
    )
    .handler(({ input }) => hazardsNear(input.lat, input.lng, input.radiusM)),

  /* ------------------------------------------------------------- operator */

  /** Scan OpenStreetMap: play areas arrive as proposals, hazards go live. */
  importOsm: adminProc
    .input(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusM: z.number().int().min(200).max(10_000).default(1_500),
        limit: z.number().int().min(1).max(200).default(40),
      }),
    )
    .handler(({ input }) => importFromOsm(input)),

  /** Zones waiting on a human decision. */
  pending: adminProc.handler(() => pendingZones()),

  /** Approve or reject a proposed play area. Nothing is playable until this. */
  review: adminProc
    .input(
      z.object({
        zoneId: z.string(),
        review: z.enum(ZONE_REVIEW),
        note: z.string().max(500).optional(),
      }),
    )
    .handler(({ input }) => reviewZone(input)),

  hazardList: adminProc.handler(() => listHazards()),

  hazardCreate: adminProc
    .input(
      z.object({
        name: z.string().min(1).max(120),
        kind: z.enum(DANGER_KINDS),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusM: z.number().int().min(5).max(2_000).default(20),
      }),
    )
    .handler(({ input }) => createHazard(input)),

  hazardDelete: adminProc
    .input(z.object({ hazardId: z.string() }))
    .handler(({ input }) => deleteHazard(input.hazardId)),

  /** Audit trail: who was stopped, where, and why. */
  events: adminProc
    .input(z.object({ limit: z.number().int().min(1).max(200).default(60) }).optional())
    .handler(({ input }) => recentSafetyEvents(input?.limit ?? 60)),
};
