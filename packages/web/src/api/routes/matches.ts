import { z } from "zod";
import { base } from "../__core/app";
import { playerProc } from "../middleware/auth";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  createMatch,
  finish,
  joinMatch,
  leaveMatch,
  myMatches,
  openMatches,
  quickMatch,
  startMatch,
} from "../services/matches";
import { matchSnapshot, requireMatchMember } from "../battle/engine";
import { selectableAvatars } from "../services/avatars";

/**
 * Matchmaking: 2-4 players per match, anchored to a GPS zone.
 *
 * Lifecycle — `create`/`join` (status `waiting`) → `start` (host only, seeds
 * the authoritative battle states) → combat through the `battle` routes →
 * `finish` (or automatic when one player is left standing).
 */
export const matches = {
  config: base.handler(() => ({ minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS })),

  /** Avatars the caller can bring into a match right now. */
  eligibleAvatars: playerProc.handler(({ context }) => selectableAvatars(context.player.id)),

  /** Only lobbies the caller may join: same age tier, no blocks. */
  open: playerProc
    .input(z.object({ zoneId: z.string().optional() }).optional())
    .handler(({ input, context }) => openMatches(context.player.id, input?.zoneId)),

  mine: playerProc
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional())
    .handler(({ input, context }) => myMatches(context.player.id, input?.limit ?? 20)),

  /** Full lobby/battle snapshot for lobby members — safe to poll, and the SSE stream's baseline. */
  get: playerProc
    .input(z.object({ matchId: z.string() }))
    .handler(async ({ input, context }) => {
      await requireMatchMember(input.matchId, context.player);
      return matchSnapshot(input.matchId);
    }),

  create: playerProc
    .input(
      z.object({
        avatarId: z.string(),
        zoneId: z.string().optional(),
        maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS).default(MAX_PLAYERS),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    )
    .handler(({ input, context }) =>
      createMatch({
        hostPlayerId: context.player.id,
        avatarId: input.avatarId,
        zoneId: input.zoneId,
        maxPlayers: input.maxPlayers,
        lat: input.lat,
        lng: input.lng,
      }),
    ),

  join: playerProc
    .input(z.object({ matchId: z.string(), avatarId: z.string() }))
    .handler(({ input, context }) =>
      joinMatch({
        matchId: input.matchId,
        playerId: context.player.id,
        avatarId: input.avatarId,
      }),
    ),

  /** One-call matchmaking: join the nearest open lobby, or open one. */
  quick: playerProc
    .input(
      z.object({
        avatarId: z.string(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    )
    .handler(({ input, context }) =>
      quickMatch({
        playerId: context.player.id,
        avatarId: input.avatarId,
        lat: input.lat,
        lng: input.lng,
      }),
    ),

  leave: playerProc
    .input(z.object({ matchId: z.string() }))
    .handler(({ input, context }) =>
      leaveMatch({ matchId: input.matchId, playerId: context.player.id }),
    ),

  start: playerProc
    .input(z.object({ matchId: z.string() }))
    .handler(({ input, context }) =>
      startMatch({ matchId: input.matchId, playerId: context.player.id }),
    ),

  /** End an active match early and settle rewards. */
  finish: playerProc
    .input(z.object({ matchId: z.string() }))
    .handler(({ input, context }) =>
      finish({ matchId: input.matchId, playerId: context.player.id }),
    ),
};
