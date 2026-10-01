import type { RouterClient } from "@orpc/server";
import { createApp } from "./__core/app";
import { auth } from "./auth";
import { requireMatchMember } from "./battle/engine";
import { playerFromHeaders } from "./middleware/auth";
import { matchEventStream } from "./realtime/stream";
import { admin } from "./routes/admin";
import { avatars } from "./routes/avatars";
import { battle } from "./routes/battle";
import { boosters } from "./routes/boosters";
import { community } from "./routes/community";
import { marketplace } from "./routes/marketplace";
import { matches } from "./routes/matches";
import { moderation } from "./routes/moderation";
import { nature } from "./routes/nature";
import { ping } from "./routes/ping";
import { players } from "./routes/players";
import { safety } from "./routes/safety";
import { runDueJobs, runJob, startScheduler } from "./services/cron";

// API features are oRPC procedures, one file per feature in ./routes/,
// composed into this router — typed end-to-end via the clients
// (web: src/web/lib/api.ts, mobile: lib/api.ts).
// Keep each routes/ file under 500 lines (`bun run lint` enforces this);
// split into more feature files as they grow.
// Patterns and examples: skills/app/references/api.md
export const router = {
  ping,
  players,
  avatars,
  boosters,
  nature,
  safety,
  marketplace,
  matches,
  battle,
  community,
  moderation,
  admin,
};

export type AppRouter = typeof router;
/** Typed client for the router — used by the web and mobile api clients. */
export type AppRouterClient = RouterClient<AppRouter>;

const app = createApp(router);

// --- Plain HTTP endpoints -------------------------------------------------

/** Better Auth: email + password sign-up/sign-in, sessions, bearer + Expo. */
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

/**
 * Real-time match channel (SSE). Same event names and payloads a WebSocket
 * transport would carry — see realtime/bus.ts. Clients replay with
 * `Last-Event-ID` or `?afterSeq=`.
 */
app.get("/api/realtime/match/:matchId", async (c) => {
  // Positions travel on this channel: lobby members (and admins) only.
  const player = await playerFromHeaders(c.req.raw.headers);
  if (!player) return c.json({ error: "unauthorized" }, 401);
  try {
    await requireMatchMember(c.req.param("matchId"), player);
  } catch {
    return c.json({ error: "not found" }, 404);
  }
  const header = c.req.header("Last-Event-ID");
  const query = c.req.query("afterSeq");
  const afterSeq = Number(header ?? query ?? 0);
  return matchEventStream(
    c.req.param("matchId"),
    Number.isFinite(afterSeq) ? afterSeq : 0,
  );
});

/**
 * Manual cron trigger for an external scheduler or an operator.
 * Requires `x-cron-secret` to match CRON_SECRET when that env var is set.
 */
app.post("/api/cron/:job?", async (c) => {
  const secret = process.env.CRON_SECRET;
  if (secret && c.req.header("x-cron-secret") !== secret) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const job = c.req.param("job");
  if (!job || job === "due") {
    return c.json({ runs: await runDueJobs("manual") });
  }
  // biome-ignore lint/suspicious/noExplicitAny: validated inside runJob
  return c.json(await runJob(job as any, "manual"));
});

// Daily/weekly game jobs. The Bun server is long-lived, so the scheduler runs
// in-process; set DISABLE_CRON=1 to drive it from /api/cron instead.
startScheduler();

export default app;
