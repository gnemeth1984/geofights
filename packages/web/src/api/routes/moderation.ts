import { z } from "zod";
import { adminProc, playerProc } from "../middleware/auth";
import { REPORT_REASONS, REPORT_STATUSES } from "../database/schema";
import {
  blockList,
  blockPlayer,
  hideMessage,
  moderationHistory,
  moderationStats,
  reportPlayer,
  reportQueue,
  resolveReport,
  setModerationState,
  unblockPlayer,
} from "../services/moderation";

/**
 * Report, block, and the moderation queue behind them.
 *
 * The player-facing half is deliberately trivial to reach: any player, from
 * anywhere in the app, can report or block any other player in two taps, with
 * no explanation required. A safety control that needs a form filled in is a
 * safety control that does not get used by a ten-year-old.
 *
 * The admin half is the other side of the automatic hide: three distinct
 * reporters in seven days takes an account out of circulation immediately, and
 * these procedures are how a human confirms, reverses, or escalates that.
 * Every decision is written to `moderationAction` with the admin's id.
 */

export const moderation = {
  /** Two taps, no free-text required. `note` is optional detail. */
  report: playerProc
    .input(
      z.object({
        subjectId: z.string(),
        reason: z.enum(REPORT_REASONS),
        context: z.enum(["chat", "match", "profile", "team", "meetup"]).optional(),
        refId: z.string().optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .handler(({ input, context }) =>
      reportPlayer({ reporterId: context.player.id, ...input }),
    ),

  block: playerProc
    .input(z.object({ playerId: z.string() }))
    .handler(({ input, context }) => blockPlayer(context.player.id, input.playerId)),

  unblock: playerProc
    .input(z.object({ playerId: z.string() }))
    .handler(({ input, context }) => unblockPlayer(context.player.id, input.playerId)),

  blocks: playerProc.handler(({ context }) => blockList(context.player.id)),

  /* ------------------------------------------------------------ admin side */

  queue: adminProc
    .input(
      z
        .object({
          status: z.enum(REPORT_STATUSES).default("open"),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .optional(),
    )
    .handler(({ input }) => reportQueue(input?.status ?? "open", input?.limit ?? 100)),

  stats: adminProc.handler(() => moderationStats()),

  history: adminProc
    .input(z.object({ playerId: z.string() }))
    .handler(({ input }) => moderationHistory(input.playerId)),

  /** Dismiss the report, or hide / suspend / clear the account it is about. */
  resolve: adminProc
    .input(
      z.object({
        reportId: z.string(),
        decision: z.enum(["dismiss", "hide", "suspend", "clear"]),
        note: z.string().max(500).optional(),
      }),
    )
    .handler(({ input, context }) =>
      resolveReport({ ...input, actorId: context.player.id }),
    ),

  /** Direct state change, for a case that arrived outside the queue. */
  setState: adminProc
    .input(
      z.object({
        playerId: z.string(),
        state: z.enum(["active", "hidden", "suspended"]),
        note: z.string().max(500).optional(),
      }),
    )
    .handler(({ input, context }) =>
      setModerationState({
        subjectId: input.playerId,
        state: input.state,
        actorId: context.player.id,
        action: input.state === "active" ? "unhide" : input.state === "hidden" ? "hide" : "suspend",
        note: input.note,
      }),
    ),

  hideMessage: adminProc
    .input(z.object({ messageId: z.string() }))
    .handler(async ({ input, context }) => {
      await hideMessage(input.messageId, context.player.id);
      return { ok: true as const };
    }),
};
