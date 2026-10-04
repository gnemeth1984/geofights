import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { adminProc, playerProc } from "../middleware/auth";
import { mySuggestions, nearbyGrounds, recentSuggestions, suggestGround } from "../services/ground-suggest";

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/**
 * Player-suggested fighting grounds. Players 13 and over can put forward a
 * playground or park OpenStreetMap knows about near them; the server re-reads
 * it, runs the hazard and AI checks, and either puts it live or files it for a
 * person. Under-13s can't: a suggestion ties a child's account to a spot near
 * where they are.
 */
function requireOldEnough(ageBand: string | null) {
  if (!ageBand || ageBand === "under13") {
    throw new ORPCError("FORBIDDEN", {
      message: "Suggesting grounds is for players 13 and over. Ask a parent to email us the place instead.",
    });
  }
}

export const grounds = {
  /** Playgrounds and parks near the player, and whether each is already a ground. */
  nearby: playerProc.input(z.object({ lat, lng })).handler(({ input, context }) => {
    requireOldEnough(context.player.ageBand);
    return nearbyGrounds(context.player.id, input.lat, input.lng);
  }),

  suggest: playerProc
    .input(
      z.object({
        osmRef: z.string().regex(/^(node|way|relation)\/\d+$/),
        lat,
        lng,
        note: z.string().max(200).optional(),
      }),
    )
    .handler(({ input, context }) => {
      requireOldEnough(context.player.ageBand);
      return suggestGround({ player: context.player, ...input });
    }),

  mine: playerProc.handler(({ context }) => mySuggestions(context.player.id)),

  /** Operator audit: every suggestion, its checks, and the zone's state now. */
  audit: adminProc
    .input(z.object({ limit: z.number().int().min(1).max(200).default(60) }).optional())
    .handler(({ input }) => recentSuggestions(input?.limit ?? 60)),
};
