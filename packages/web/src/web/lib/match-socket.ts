/**
 * Match socket.
 *
 * The client talks to one object with `connect` / `close` / `on(event)` /
 * `status` — the shape a WebSocket client has. Underneath it is the backend's
 * SSE channel (`GET /api/realtime/match/:matchId`), because the managed runtime
 * serves the API through a fetch handler and has no socket upgrade. The event
 * names, payloads and ordering are identical either way (see
 * `src/api/realtime/bus.ts`), so the rest of the client never learns which
 * transport it got — swapping in a real `WebSocket` here is a one-file change
 * and nothing above this line moves.
 *
 * Writes always go over REST/oRPC (`battle.updatePosition`, `battle.attack`,
 * …): the channel is read-only, which is what keeps the server authoritative.
 *
 * Reliability, in order of preference:
 *   1. SSE with `Last-Event-ID` replay — the browser reconnects and the server
 *      re-sends the durable log from the last seq seen.
 *   2. If SSE cannot open at all (corporate proxy, buffering middlebox), fall
 *      back to polling `battle.events` with the same `afterSeq` cursor.
 */

import { client } from "@/lib/api";

export const MATCH_EVENTS = [
  "player_joined",
  "player_left",
  "avatar_position",
  "avatar_action",
  /**
   * A blow on its way, and a guard going up to meet it.
   *
   * Both are ephemeral: the server broadcasts them without writing them to
   * the battle log, so they carry a *negative* seq and never move the replay
   * cursor. They are listed here because SSE is subscribed per event name —
   * a type missing from this list is a frame the browser never hands over.
   */
  "avatar_windup",
  "avatar_guard",
  "avatar_damage",
  "avatar_death",
  "match_started",
  "match_finished",
] as const;

export type MatchEventType = (typeof MATCH_EVENTS)[number];

export type MatchEvent = {
  seq: number;
  matchId: string;
  type: MatchEventType;
  payload: Record<string, unknown>;
  message?: string | null;
  at: string;
};

export type SocketStatus = "idle" | "connecting" | "live" | "polling" | "closed";

export type MatchSocketHandlers = {
  onEvent: (event: MatchEvent) => void;
  onStatus?: (status: SocketStatus) => void;
};

/** Position frames carry a negative seq — they must never move the cursor. */
const isDurable = (event: MatchEvent) => event.seq > 0;

/** How long to wait for the stream to actually open before polling instead. */
const OPEN_TIMEOUT_MS = 6_000;

export type MatchSocket = {
  close: () => void;
  status: () => SocketStatus;
};

export function openMatchSocket(
  matchId: string,
  handlers: MatchSocketHandlers,
  options: { afterSeq?: number } = {},
): MatchSocket {
  let cursor = options.afterSeq ?? 0;
  let status: SocketStatus = "idle";
  let closed = false;
  let source: EventSource | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;

  const setStatus = (next: SocketStatus) => {
    if (status === next) return;
    status = next;
    handlers.onStatus?.(next);
  };

  const deliver = (event: MatchEvent) => {
    if (isDurable(event)) {
      // Replay after a reconnect can hand back frames we already applied.
      if (event.seq <= cursor) return;
      cursor = event.seq;
    }
    handlers.onEvent(event);
  };

  /* ------------------------------------------------------------------- sse */

  const openSse = () => {
    if (closed) return;
    setStatus("connecting");
    const url = `${window.location.origin}/api/realtime/match/${encodeURIComponent(matchId)}${
      cursor > 0 ? `?afterSeq=${cursor}` : ""
    }`;
    const es = new EventSource(url, { withCredentials: true });
    source = es;

    // A buffering proxy in the path accepts the connection and then holds the
    // stream: no open, no error, no events. Without a deadline the channel
    // would sit in "connecting" for the life of the page, so give up on SSE
    // and poll instead.
    openTimer = setTimeout(() => {
      openTimer = null;
      if (closed || status === "live") return;
      es.close();
      source = null;
      startPolling();
    }, OPEN_TIMEOUT_MS);

    es.onopen = () => {
      if (openTimer) {
        clearTimeout(openTimer);
        openTimer = null;
      }
      failures = 0;
      setStatus("live");
    };

    for (const type of MATCH_EVENTS) {
      es.addEventListener(type, (raw) => {
        try {
          deliver(JSON.parse((raw as MessageEvent<string>).data) as MatchEvent);
        } catch {
          /* a malformed frame is dropped rather than killing the channel */
        }
      });
    }

    es.onerror = () => {
      if (closed) return;
      failures += 1;
      // The browser retries SSE on its own; two clean failures in a row means
      // something in the path is eating the stream, so switch to polling.
      if (failures >= 3) {
        es.close();
        source = null;
        startPolling();
      } else {
        setStatus("connecting");
      }
    };
  };

  /* --------------------------------------------------------------- polling */

  const startPolling = () => {
    if (closed || pollTimer) return;
    setStatus("polling");
    const tick = async () => {
      if (closed) return;
      try {
        const result = await client.battle.events({ matchId, afterSeq: cursor });
        for (const event of result.events) deliver(event as MatchEvent);
      } catch {
        /* keep polling — a transient API error is not fatal */
      }
      if (!closed) pollTimer = setTimeout(tick, 2_000);
    };
    pollTimer = setTimeout(tick, 0);
  };

  if (typeof EventSource === "undefined") startPolling();
  else openSse();

  return {
    close() {
      closed = true;
      source?.close();
      source = null;
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      if (openTimer) clearTimeout(openTimer);
      openTimer = null;
      setStatus("closed");
    },
    status: () => status,
  };
}
