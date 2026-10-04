import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { base } from "../__core/app";
import { adminProc, playerProc } from "../middleware/auth";
import {
  awaitingParentSuggestions,
  mySuggestions,
  nearbyGrounds,
  parentGroundDecide,
  parentGroundView,
  recentSuggestions,
  suggestGround,
} from "../services/ground-suggest";

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/**
 * Player-suggested fighting grounds. A player puts forward a playground or
 * park OpenStreetMap knows about near them; the server re-reads it, runs the
 * hazard and AI checks, and either puts it live or files it for a person.
 * An under-13's suggestion also waits for their parent to say yes.
 */
/**
 * Anyone with a finished profile can suggest. Under-13s additionally need a
 * parent who has already confirmed the account, because their suggestions go
 * back to that parent for a yes before anything goes live.
 */
function requireCanSuggest(player: { ageBand: string | null; parentConsentAt: Date | null }) {
  if (!player.ageBand) {
    throw new ORPCError("FORBIDDEN", { message: "Finish setting up your account first." });
  }
  if (player.ageBand === "under13" && !player.parentConsentAt) {
    throw new ORPCError("FORBIDDEN", {
      message: "Your parent needs to confirm your account before you can suggest grounds.",
    });
  }
}

export const grounds = {
  /** Playgrounds and parks near the player, and whether each is already a ground. */
  nearby: playerProc.input(z.object({ lat, lng })).handler(async ({ input, context }) => {
    requireCanSuggest(context.player);
    const found = await nearbyGrounds(context.player.id, input.lat, input.lng);
    return { ...found, needsParent: context.player.ageBand === "under13" };
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
      requireCanSuggest(context.player);
      return suggestGround({ player: context.player, ...input });
    }),

  mine: playerProc.handler(({ context }) => mySuggestions(context.player.id)),

  /** Operator audit: every suggestion, its checks, and the zone's state now. */
  audit: adminProc
    .input(z.object({ limit: z.number().int().min(1).max(200).default(60) }).optional())
    .handler(({ input }) => recentSuggestions(input?.limit ?? 60)),

  /** Operator: under-13 suggestions waiting on a parent, with the link to forward. */
  awaitingParent: adminProc.handler(() => awaitingParentSuggestions()),

  /** Public, token is the credential: what the parent is being asked to approve. */
  parentView: base
    .input(z.object({ token: z.string().min(12) }))
    .handler(({ input }) => parentGroundView(input.token)),

  parentDecide: base
    .input(z.object({ token: z.string().min(12), approve: z.boolean() }))
    .handler(({ input }) => parentGroundDecide(input.token, input.approve)),
};
