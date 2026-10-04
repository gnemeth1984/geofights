import { z } from "zod";
import { base } from "../__core/app";
import { LAUNCH_ITEM_STATUS } from "../database/schema";
import { adminProc, playerProc } from "../middleware/auth";
import { launchItems, launchStats, recordSignup, recordVisit, REF_PATTERN, setLaunchItem } from "../services/launch";

const ref = z.string().trim().toLowerCase().regex(REF_PATTERN);

export const launch = {
  /** Public: a browser arrived with `?ref=`. The client sends this once per ref per day. */
  visit: base
    .input(z.object({ ref, path: z.string().max(200).optional() }))
    .handler(({ input }) => recordVisit(input.ref, input.path)),

  /** A freshly created player tells us which ref they arrived with. */
  attribute: playerProc
    .input(z.object({ ref }))
    .handler(({ input, context }) => recordSignup(context.player, input.ref)),

  stats: adminProc.handler(() => launchStats()),

  items: adminProc.handler(() => launchItems()),

  setItem: adminProc
    .input(
      z.object({
        key: z.string().regex(/^[a-z0-9-]{1,48}$/),
        status: z.enum(LAUNCH_ITEM_STATUS),
        postedUrl: z.string().url().max(500).nullish(),
        note: z.string().max(500).nullish(),
      }),
    )
    .handler(({ input }) => setLaunchItem(input)),
};
