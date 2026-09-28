import { z } from "zod";
import { base } from "../__core/app";
import { playerProc } from "../middleware/auth";
import {
  ATTACK_COOLDOWN_MS,
  ATTACK_RANGE_M,
  GUARD_COMMIT_MS,
  REWARDS,
  attack,
  guard,
  matchSnapshot,
  readyState,
  requireState,
  staminaOf,
  updatePosition,
  useAbility,
} from "../battle/engine";
import {
  CORNERED_DAMAGE,
  CORNERED_SPACE_M,
  GUARD_WINDOW,
  REACH_SLACK_M,
  STAMINA_MAX,
  STAMINA_MIN_SHARE,
  STAMINA_REGEN_BASE,
} from "../lib/move-combat";
import { REALTIME_EVENTS, eventsSince, subscriberCount } from "../realtime/bus";

/**
 * Battle engine endpoints. Every number is decided on the server: the client
 * reports intent (position, attack, ability) and receives the resolved result,
 * while spectators and opponents learn about it through the realtime stream.
 *
 * Range, cooldowns, damage, death and rewards are all validated here — a
 * modified client cannot hit from across the map or fire faster than the
 * cooldown allows.
 */
export const battle = {
  config: base.handler(() => ({
    attackRangeM: ATTACK_RANGE_M,
    attackCooldownMs: ATTACK_COOLDOWN_MS,
    /**
     * Guard timing is server-clocked. The client is told the windows so it can
     * draw the telegraph honestly, but arrival is stamped here, not there.
     */
    guard: {
      window: GUARD_WINDOW,
      commitMs: GUARD_COMMIT_MS,
    },
    stamina: {
      max: STAMINA_MAX,
      regenPerSecond: STAMINA_REGEN_BASE,
      minShare: STAMINA_MIN_SHARE,
    },
    space: {
      reachSlackM: REACH_SLACK_M,
      corneredSpaceM: CORNERED_SPACE_M,
      corneredDamage: CORNERED_DAMAGE,
    },
    rewards: REWARDS,
    realtimeEvents: REALTIME_EVENTS,
    /** Subscribe with EventSource; payloads match the WS event contract. */
    streamPath: "/api/realtime/match/:matchId",
  })),

  /** Authoritative state of every avatar in the match. */
  state: base
    .input(z.object({ matchId: z.string() }))
    .handler(({ input }) => matchSnapshot(input.matchId)),

  /** The caller's own combat state — health, cooldowns, abilities. */
  myState: playerProc
    .input(z.object({ matchId: z.string() }))
    .handler(async ({ input, context }) => {
      const state = await requireState(input.matchId, context.player.id);
      const now = Date.now();
      const ready = readyState(state, now);
      return {
        ...state,
        /**
         * How long the pad should stay greyed, which has to be how long the
         * server will actually refuse — and that is the move's own recovery or
         * a stagger, nothing else.
         *
         * It used to carry `ATTACK_COOLDOWN_MS` from the last swing as a floor
         * on top. The engine has never charged that floor — `requireActable`
         * reads `recoverUntil` and `staggeredUntil` and no third thing — so
         * all the floor ever did was grey a button the server would have
         * accepted. Harmless while every recovery was longer than it; actively
         * wrong now that a landed hit cancels into a window shorter than it,
         * because the one press the cancel exists for was the press it ate.
         */
        attackReadyInMs: ready.readyInMs,
        abilityReadyInMs: Math.max(0, (state.abilityReadyAt?.getTime() ?? 0) - now),
        /** Recovery or stagger — the pad greys out until this hits 0. */
        readyInMs: ready.readyInMs,
        staggered: ready.staggered,
        recovering: ready.recovering,
        /** Live pool, regenerated to now — not the stale stored figure. */
        stamina: staminaOf(state, now),
        staminaMax: STAMINA_MAX,
        abilities: JSON.parse(state.abilities) as unknown[],
      };
    }),

  /** Report the device pose. Broadcast as `avatar_position`, never persisted. */
  updatePosition: playerProc
    .input(
      z.object({
        matchId: z.string(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        heading: z.number().min(0).max(360).optional(),
        altitude: z.number().optional(),
      }),
    )
    .handler(({ input, context }) =>
      updatePosition({
        matchId: input.matchId,
        playerId: context.player.id,
        lat: input.lat,
        lng: input.lng,
        heading: input.heading,
        altitude: input.altitude,
      }),
    ),

  /**
   * Throw a move. The request is held open for that move's own windup: it
   * emits `avatar_windup` at once, then resolves damage at the strike frame,
   * so the answer arrives with the contact instead of ahead of it.
   *
   * `moveType` is checked against the caller's own body server-side; omit it
   * and the server picks for them. `gapM` and `spaceBehindM` are the device's
   * AR-room readings — advisory, and cross-checked against the target's own.
   */
  attack: playerProc
    .input(
      z.object({
        matchId: z.string(),
        targetPlayerId: z.string(),
        moveType: z.string().optional(),
        gapM: z.number().min(0).max(50).optional(),
        spaceBehindM: z.number().min(0).max(50).optional(),
      }),
    )
    .handler(({ input, context }) =>
      attack({
        matchId: input.matchId,
        playerId: context.player.id,
        targetPlayerId: input.targetPlayerId,
        moveType: input.moveType,
        gapM: input.gapM,
        spaceBehindM: input.spaceBehindM,
      }),
    ),

  /**
   * Answer an incoming move. Commit a defence and the server stamps when it
   * arrived — the gap between that stamp and the strike frame is the grade,
   * so a client cannot backdate a parry it did not make.
   */
  guard: playerProc
    .input(
      z.object({
        matchId: z.string(),
        moveType: z.string(),
        gapM: z.number().min(0).max(50).optional(),
        spaceBehindM: z.number().min(0).max(50).optional(),
      }),
    )
    .handler(({ input, context }) =>
      guard({
        matchId: input.matchId,
        playerId: context.player.id,
        moveType: input.moveType,
        gapM: input.gapM,
        spaceBehindM: input.spaceBehindM,
      }),
    ),

  /** Fire an avatar or booster-granted ability. Emits `avatar_action`. */
  useAbility: playerProc
    .input(
      z.object({
        matchId: z.string(),
        abilityId: z.string(),
        targetPlayerId: z.string().optional(),
      }),
    )
    .handler(({ input, context }) =>
      useAbility({
        matchId: input.matchId,
        playerId: context.player.id,
        abilityId: input.abilityId,
        targetPlayerId: input.targetPlayerId,
      }),
    ),

  /**
   * Polling fallback for the event stream — same events, same ordering.
   * Pass the highest `seq` already seen.
   */
  events: base
    .input(z.object({ matchId: z.string(), afterSeq: z.number().int().min(0).default(0) }))
    .handler(async ({ input }) => ({
      events: await eventsSince(input.matchId, input.afterSeq),
      liveSubscribers: subscriberCount(input.matchId),
    })),
};
