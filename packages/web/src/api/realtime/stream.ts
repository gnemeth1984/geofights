import { eventsSince, subscribe, type RealtimeEvent } from "./bus";

/**
 * SSE response for one match channel.
 *
 * Wire format per frame:
 *   id: <seq>
 *   event: <player_joined | avatar_position | ...>
 *   data: {"matchId":"...","payload":{...},"message":null,"at":"..."}
 *
 * Clients pass `Last-Event-ID` (or `?afterSeq=`) to replay missed log events.
 * A heartbeat comment is sent every 20s so proxies keep the connection open.
 */
export function matchEventStream(matchId: string, afterSeq: number): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: RealtimeEvent) => {
        const frame =
          `id: ${event.seq}\n` +
          `event: ${event.type}\n` +
          `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(frame));
      };

      controller.enqueue(encoder.encode(`: connected ${matchId}\n\n`));

      // Backlog first so ordering stays monotonic, then live frames.
      const backlog = await eventsSince(matchId, afterSeq);
      for (const event of backlog) send(event);

      unsubscribe = subscribe(matchId, send);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 20_000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
