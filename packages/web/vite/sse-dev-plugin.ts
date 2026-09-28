import type { Plugin, ViteDevServer } from "vite";

/**
 * Streaming dev handler for the realtime match channel.
 *
 * The template's `hono-dev-plugin` answers every `/api` request by collecting
 * the whole response with `arrayBuffer()` before writing it. That is correct
 * for JSON and fatal for Server-Sent Events: the match channel
 * (`GET /api/realtime/match/:matchId`) is an open-ended stream, so awaiting it
 * never returns, the request hangs, and the client sits in "connecting"
 * forever without ever seeing an error it could fall back from.
 *
 * This plugin claims only the SSE paths and pipes the body straight to the
 * socket. It is registered *before* the template plugin in `vite.config.ts`, so
 * it wins the route; everything else falls through untouched and the
 * template-managed file stays exactly as shipped.
 *
 * Production does not need any of this — there the Bun server returns the
 * `Response` to the runtime, which streams it natively.
 */

const STREAM_PREFIXES = ["/api/realtime/"];

export default function sseDevPlugin(): Plugin {
  return {
    name: "sse-dev-stream",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!STREAM_PREFIXES.some((prefix) => url.startsWith(prefix))) return next();

        try {
          const app = await loadApp(server);
          const response = await app.fetch(toWebRequest(req));

          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => {
            if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
          });
          const setCookies = response.headers.getSetCookie?.();
          if (setCookies?.length) res.setHeader("set-cookie", setCookies);
          // Nothing between here and the browser may hold bytes back: an event
          // that arrives late is a robot that moves late.
          res.setHeader("cache-control", "no-cache, no-transform");
          res.setHeader("x-accel-buffering", "no");
          res.flushHeaders?.();

          if (!response.body) {
            res.end();
            return;
          }

          const reader = response.body.getReader();
          let done = false;
          res.on("close", () => {
            done = true;
            void reader.cancel().catch(() => {});
          });

          while (!done) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (done) break;
            res.write(Buffer.from(chunk.value));
          }
          if (!done) res.end();
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          console.error("[sse-dev]", err);
          if (!res.headersSent) res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}

async function loadApp(server: ViteDevServer) {
  const mod = await server.ssrLoadModule("/src/api/index.ts");
  return mod.default as { fetch: (request: Request) => Promise<Response> };
}

function toWebRequest(req: import("http").IncomingMessage): Request {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val) headers.set(key, Array.isArray(val) ? val.join(", ") : val);
  }
  // SSE is always GET, so there is no body to forward.
  return new Request(url, { method: req.method, headers });
}
