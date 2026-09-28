import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/lib/api";
import { openMatchSocket, type MatchEvent, type SocketStatus } from "@/lib/match-socket";

/**
 * React lifecycle around the match channel.
 *
 * Three jobs. It keeps the last position each opponent broadcast — that is what
 * puts an enemy marker in the world between the slower snapshot polls — and it
 * invalidates the snapshot queries whenever a durable event lands, so the HUD
 * reads authoritative numbers from the server instead of trying to replay
 * damage maths from the event payloads.
 *
 * The third is the timed ones. A windup and a guard are telegraphs: true for
 * the few hundred milliseconds of the blow they describe and then nothing.
 * Through `feed` they would park in a durable array for the rest of the fight
 * and refetch the whole battle state on every swing, so they leave through
 * `onEphemeral` as they arrive — a callback rather than state, because two in
 * one tick must both be seen and a state slot would keep only the last.
 */

export type OpponentPose = {
  playerId: string;
  lat: number;
  lng: number;
  heading: number | null;
  speedMps: number | null;
  moving: boolean;
  combatPaused: boolean;
  at: number;
};

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

/**
 * Broadcast, never logged: they describe a moment instead of recording one.
 *
 * Which also means the polling fallback cannot carry them — `battle.events`
 * replays the durable log and these were never in it. On a connection that
 * cannot hold SSE open the fight loses its telegraphs and a guard becomes a
 * plain button, which is a degradation and not a break: the server still
 * grades whatever arrives against the strike time it stamped itself.
 */
const EPHEMERAL: ReadonlySet<string> = new Set(["avatar_windup", "avatar_guard"]);

export function useMatchChannel(
  matchId: string | null,
  options: { onEphemeral?: (event: MatchEvent) => void } = {},
) {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<SocketStatus>("idle");
  const [poses, setPoses] = React.useState<Record<string, OpponentPose>>({});
  const [feed, setFeed] = React.useState<MatchEvent[]>([]);

  // Held in a ref so a caller passing an inline handler — which is every
  // caller — does not tear the socket down and reconnect on each render.
  const ephemeral = React.useRef(options.onEphemeral);
  React.useEffect(() => {
    ephemeral.current = options.onEphemeral;
  }, [options.onEphemeral]);

  React.useEffect(() => {
    setPoses({});
    setFeed([]);
    if (!matchId) {
      setStatus("idle");
      return;
    }

    const socket = openMatchSocket(matchId, {
      onStatus: setStatus,
      onEvent: (event) => {
        if (event.type === "avatar_position") {
          const playerId = event.payload.playerId;
          const lat = num(event.payload.lat);
          const lng = num(event.payload.lng);
          if (typeof playerId !== "string" || lat == null || lng == null) return;
          setPoses((current) => ({
            ...current,
            [playerId]: {
              playerId,
              lat,
              lng,
              heading: num(event.payload.heading),
              speedMps: num(event.payload.speedMps),
              moving: event.payload.moving === true,
              combatPaused: event.payload.combatPaused === true,
              at: Date.now(),
            },
          }));
          return;
        }

        // A telegraph. Handed straight to whoever is reading the fight, and
        // deliberately not invalidating anything: the windup has not changed
        // any server state yet — that is the whole point of it arriving early.
        if (EPHEMERAL.has(event.type)) {
          ephemeral.current?.(event);
          return;
        }

        // Durable events change server state — re-read it rather than guess.
        setFeed((current) => [event, ...current].slice(0, 30));
        void queryClient.invalidateQueries({ queryKey: orpc.matches.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.battle.key() });
      },
    });

    return () => socket.close();
  }, [matchId, queryClient]);

  return { status, poses, feed };
}
