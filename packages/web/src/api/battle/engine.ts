import { and, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { generateBattleMessage, generateMatchSummary } from "../ai/content";
import { distanceM } from "../lib/geo";
import { emit } from "../realtime/bus";
import {
  DEFENSIVE_COMBOS,
  movesForForm,
  pickAttackMove,
  pickDefenseMove,
} from "../lib/creature-form";
import {
  FALLBACK_ATTACK,
  GRADE_LABEL,
  GUARD_WINDOW,
  RIPOSTE_ANIMATION,
  STAGGER_MS,
  STAMINA_MIN_SHARE,
  attackProfile,
  corneredMultiplier,
  defenceProfile,
  deferMs,
  gapForCheck,
  hitCancelRecoverAt,
  gradeGuard,
  inReach,
  regenPerSecond,
  staminaCheck,
  staminaNow,
  type GuardGrade,
  type GuardVerdict,
} from "../lib/move-combat";
import { computeDamage, type DamageResult } from "../lib/damage";
import { combatFormFor } from "../services/avatars";
import { adjustCurrency, grantXp, logTransaction, recordResult } from "../services/players";
import { assess, requireSafe, unsafeError } from "../services/safety";
import { BOOSTER_XP_REWARD, awardBoosterXp, rollBattleDrop } from "../services/boosters";
import { effectiveStats, type AbilityDef } from "./stats";

/**
 * Authoritative battle engine. Clients only ever report intent
 * (attack / useAbility / updatePosition) — every number below is computed
 * server-side from `battle_state`, so a modified client cannot inflate damage.
 */

/** Max metres between two avatars for a basic attack to connect. */
export const ATTACK_RANGE_M = 30;
export { ATTACK_COOLDOWN_MS } from "../lib/move-combat";
/**
 * GeoFights is played standing still. Above this ground speed the player is
 * walking, and their own combat pauses — they can still explore and collect,
 * they just cannot fight while their eyes are on the screen and their feet
 * are moving.
 */
export const WALK_SPEED_MPS = 1.2;
/** How long after the last detected movement combat stays paused. */
export const MOVE_SETTLE_MS = 1_500;
/**
 * A position older than this is no evidence of anything. Without it, a player
 * who stops reporting mid-stride would be locked out of combat forever.
 */
const STALE_POSITION_MS = 6_000;
/** Ignore deltas outside this window — GPS jitter below, teleports above. */
const MIN_SPEED_DT_MS = 400;
const MAX_SPEED_DT_MS = 30_000;

export interface MovementStatus {
  moving: boolean;
  settling: boolean;
  /** Combat is suspended while true. */
  paused: boolean;
  speedMps: number | null;
  resumeInMs: number;
}

/**
 * Whether this avatar is allowed to fight right now, judged from the server's
 * own speed history. The client is never asked.
 */
export function movementStatus(state: typeof schema.battleState.$inferSelect): MovementStatus {
  const now = Date.now();
  const lastMoveAt = state.movingSince?.getTime() ?? 0;
  const positionAge = now - (state.updatedAt?.getTime() ?? 0);
  const moving = state.moving && positionAge < STALE_POSITION_MS;
  const sinceMove = now - lastMoveAt;
  const settling = !moving && lastMoveAt > 0 && sinceMove < MOVE_SETTLE_MS;
  return {
    moving,
    settling,
    paused: moving || settling,
    speedMps: state.lastSpeedMps ?? null,
    resumeInMs: moving ? MOVE_SETTLE_MS : settling ? Math.ceil(MOVE_SETTLE_MS - sinceMove) : 0,
  };
}

/** Throw the movement rule at an actor trying to fight on the move. */
function requireStationary(state: typeof schema.battleState.$inferSelect) {
  const move = movementStatus(state);
  if (!move.paused) return move;
  throw new ORPCError("BAD_REQUEST", {
    message: move.moving
      ? "Stand still to fight — walking pauses your battle"
      : `Steady… you can attack in ${move.resumeInMs}ms`,
    data: { reason: "moving", speedMps: move.speedMps, resumeInMs: move.resumeInMs },
  });
}

/** Refuse a combat action taken somewhere a child should not be standing. */
async function requireSafeToFight(
  state: typeof schema.battleState.$inferSelect,
  playerId: string,
  kind: string,
) {
  if (state.lat == null || state.lng == null) return null;
  const safety = await requireSafe({
    playerId,
    kind,
    lat: state.lat,
    lng: state.lng,
    speedMps: state.lastSpeedMps,
    need: "battle",
  });
  if (!safety.canBattle) throw unsafeError(safety);
  return safety;
}

// The formula itself lives in `lib/damage.ts` so the training area can show
// what a swing would have done without the engine — and without health moving.
export { computeDamage };
export type { DamageResult };

/* ------------------------------------------------------------------ helpers */

export async function requireActiveMatch(matchId: string) {
  const [row] = await db.select().from(schema.match).where(eq(schema.match.id, matchId));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Match not found" });
  if (row.status !== "active") {
    throw new ORPCError("BAD_REQUEST", { message: `Match is ${row.status}` });
  }
  return row;
}

export async function requireState(matchId: string, playerId: string) {
  const [row] = await db
    .select()
    .from(schema.battleState)
    .where(and(eq(schema.battleState.matchId, matchId), eq(schema.battleState.playerId, playerId)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "You are not in this match" });
  return row;
}

export async function matchStates(matchId: string) {
  return db
    .select({
      state: schema.battleState,
      username: schema.player.username,
      avatarName: schema.avatar.name,
      avatarModelId: schema.avatar.modelId,
      avatarRarity: schema.avatar.rarity,
      avatarForm: schema.avatar.form,
    })
    .from(schema.battleState)
    .innerJoin(schema.player, eq(schema.player.id, schema.battleState.playerId))
    .innerJoin(schema.avatar, eq(schema.avatar.id, schema.battleState.avatarId))
    .where(eq(schema.battleState.matchId, matchId));
}

/** Snapshot the whole match — the shape the AR client renders from. */
export async function matchSnapshot(matchId: string) {
  const [match] = await db.select().from(schema.match).where(eq(schema.match.id, matchId));
  if (!match) throw new ORPCError("NOT_FOUND", { message: "Match not found" });
  const [zone] = await db.select().from(schema.zone).where(eq(schema.zone.id, match.zoneId));
  const states = await matchStates(matchId);
  // `players` is derived from `battle_state`, which only exists once the match
  // starts. A waiting lobby therefore has no players at all — so the roster of
  // who has joined comes from `match_player`, and the client renders that until
  // the first shot is fired.
  const lobby = await db
    .select({ row: schema.matchPlayer, username: schema.player.username, avatarName: schema.avatar.name })
    .from(schema.matchPlayer)
    .innerJoin(schema.player, eq(schema.player.id, schema.matchPlayer.playerId))
    .innerJoin(schema.avatar, eq(schema.avatar.id, schema.matchPlayer.avatarId))
    .where(eq(schema.matchPlayer.matchId, matchId));
  return {
    match,
    zone: zone ?? null,
    lobby: lobby
      .filter((entry) => entry.row.leftAt == null)
      .map((entry) => ({
        playerId: entry.row.playerId,
        username: entry.username,
        avatarId: entry.row.avatarId,
        avatarName: entry.avatarName,
        isHost: entry.row.playerId === match.hostPlayerId,
      })),
    players: states.map((row) => ({
      playerId: row.state.playerId,
      username: row.username,
      avatarId: row.state.avatarId,
      avatarName: row.avatarName,
      // The opponent's body, so the client can build the same procedural mesh
      // for them that it builds for the player. Read-only presentation data —
      // the fight is still resolved entirely from the columns below.
      modelId: row.avatarModelId,
      rarity: row.avatarRarity,
      form: row.avatarForm,
      health: row.state.currentHealth,
      maxHealth: row.state.maxHealth,
      attack: row.state.attack,
      defense: row.state.defense,
      speed: row.state.speed,
      alive: row.state.alive,
      kills: row.state.kills,
      damageDealt: row.state.damageDealt,
      damageTaken: row.state.damageTaken,
      position: row.state.lat != null && row.state.lng != null
        ? { lat: row.state.lat, lng: row.state.lng, heading: row.state.heading, altitude: row.state.altitude }
        : null,
      abilities: JSON.parse(row.state.abilities) as AbilityDef[],
      abilityReadyAt: row.state.abilityReadyAt,
    })),
  };
}

/* --------------------------------------------------------------- position */

export async function updatePosition(input: {
  matchId: string;
  playerId: string;
  lat: number;
  lng: number;
  heading?: number;
  altitude?: number;
}) {
  await requireActiveMatch(input.matchId);
  const state = await requireState(input.matchId, input.playerId);
  if (!state.alive) throw new ORPCError("BAD_REQUEST", { message: "You are knocked out" });

  const now = new Date();
  // Speed is derived here, from two server-stamped positions. The client has
  // no say in whether it is moving.
  const speedMps = groundSpeed(state, input, now);
  const moving = speedMps != null && speedMps >= WALK_SPEED_MPS;

  const [updated] = await db
    .update(schema.battleState)
    .set({
      lat: input.lat,
      lng: input.lng,
      heading: input.heading ?? state.heading,
      altitude: input.altitude ?? state.altitude,
      moving,
      lastSpeedMps: speedMps,
      // Doubles as "last moment movement was seen", which is what the settle
      // window counts from.
      movingSince: moving ? now : state.movingSince,
      updatedAt: now,
    })
    .where(eq(schema.battleState.id, state.id))
    .returning();

  const safety = await assess({ lat: input.lat, lng: input.lng, speedMps });
  const movement = movementStatus(updated!);

  await emit(
    input.matchId,
    "avatar_position",
    {
      playerId: input.playerId,
      avatarId: state.avatarId,
      lat: input.lat,
      lng: input.lng,
      heading: updated!.heading,
      altitude: updated!.altitude,
      speedMps,
      moving: movement.moving,
      /** Opponents see that this avatar's combat is suspended. */
      combatPaused: movement.paused || !safety.canBattle,
    },
    { actorPlayerId: input.playerId },
  );

  return {
    ...updated!,
    speedMps,
    movement,
    /** The overlay the client renders: verdict, headline, nearby hazards. */
    safety,
  };
}

/** Metres per second between the stored position and the new one, or null. */
function groundSpeed(
  state: typeof schema.battleState.$inferSelect,
  next: { lat: number; lng: number },
  now: Date,
) {
  if (state.lat == null || state.lng == null || state.updatedAt == null) return null;
  const dt = now.getTime() - state.updatedAt.getTime();
  if (dt < MIN_SPEED_DT_MS || dt > MAX_SPEED_DT_MS) return null;
  const metres = distanceM({ lat: state.lat, lng: state.lng }, next);
  return Math.round((metres / (dt / 1_000)) * 100) / 100;
}

/* ---------------------------------------------------------------- stamina */

/**
 * This avatar's stamina right now.
 *
 * Nothing ticks. The pool is a reading plus the time it was taken, and regen
 * is integrated forward on read — so an idle match costs nothing to keep
 * current, and a client that stops talking to the server regenerates at
 * exactly the same rate as one that spams it.
 */
export function staminaOf(state: typeof schema.battleState.$inferSelect, now = Date.now()) {
  return staminaNow({
    stamina: state.stamina,
    since: state.staminaAt?.getTime() ?? state.updatedAt?.getTime() ?? now,
    now,
    speed: state.speed,
  });
}

/** When this avatar can act again, and why it cannot yet. */
export function readyState(state: typeof schema.battleState.$inferSelect, now = Date.now()) {
  const recover = state.recoverUntil?.getTime() ?? 0;
  const stagger = state.staggeredUntil?.getTime() ?? 0;
  const until = Math.max(recover, stagger);
  return {
    readyInMs: Math.max(0, until - now),
    staggered: stagger > now,
    recovering: recover > now,
  };
}

/**
 * The commitment rule. You cannot act out of your own recovery, and a parry
 * extends it — which is the entire risk side of throwing something heavy.
 */
function requireActable(state: typeof schema.battleState.$inferSelect, now: number) {
  const ready = readyState(state, now);
  if (ready.readyInMs <= 0) return ready;
  throw new ORPCError("TOO_MANY_REQUESTS", {
    message: ready.staggered
      ? `Staggered — ${ready.readyInMs}ms`
      : `Still recovering (${ready.readyInMs}ms)`,
    data: {
      reason: ready.staggered ? "staggered" : "recovering",
      readyInMs: ready.readyInMs,
    },
  });
}

/** Hold the request open until the blow actually lands. */
const waitUntil = (at: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, at - Date.now())));

/* ------------------------------------------------------------ move intent */

/**
 * Which attack is being thrown.
 *
 * The move now comes from the player. It is checked against the body that has
 * to perform it — `movesForForm` is the same gate the pad renders from, so a
 * request for a wing gust from a creature with no wings is a bug or a cheat
 * and is refused rather than quietly swapped for something else. Quietly
 * swapping is how the old engine ended up animating moves nobody chose.
 *
 * A request with no move at all still works, and still gets the old seeded
 * roll: the training area, the headless suites and any client older than this
 * change keep behaving exactly as they did.
 */
async function resolveAttackMove(input: {
  matchId: string;
  attacker: typeof schema.battleState.$inferSelect;
  target: typeof schema.battleState.$inferSelect;
  moveType?: string | null;
  effect?: string | null;
}) {
  const body = await combatFormFor(input.attacker.avatarId);
  if (!body) return { move: FALLBACK_ATTACK, chosen: false };

  const { attacks, combos } = movesForForm(body.form, body.level);
  const throwable = [
    ...attacks,
    ...combos.filter((move) => !(DEFENSIVE_COMBOS as readonly string[]).includes(move)),
  ];

  if (input.moveType) {
    if (!throwable.includes(input.moveType as never)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Your avatar cannot throw ${input.moveType}`,
        data: { reason: "move_unavailable", throwable },
      });
    }
    return { move: input.moveType, chosen: true };
  }

  const seed = `${input.matchId}:${input.attacker.playerId}:${input.target.playerId}:${input.attacker.damageDealt}:${input.target.damageTaken}`;
  return {
    move: pickAttackMove({
      form: body.form,
      level: body.level,
      seed,
      effect: input.effect ?? null,
    }) as string,
    chosen: false,
  };
}

/* ------------------------------------------------------------------ guard */

/**
 * Commit a defence.
 *
 * This is the other half of the fight, and the timing model is the reason it
 * can be trusted: the client sends *what* it is doing and never *when*. The
 * arrival is stamped here, the blow's landing was stamped here when the attack
 * committed, and the gap between the two is graded at resolution. A client
 * cannot claim a parry it did not make in time, because it has no say in the
 * clock.
 *
 * Stamina is spent on the read whether or not it turns out to be right.
 */
export async function guard(input: {
  matchId: string;
  playerId: string;
  moveType: string;
  gapM?: number | null;
  spaceBehindM?: number | null;
}) {
  const now = Date.now();
  await requireActiveMatch(input.matchId);
  const state = await requireState(input.matchId, input.playerId);
  if (!state.alive) throw new ORPCError("BAD_REQUEST", { message: "You are knocked out" });
  requireStationary(state);
  requireActable(state, now);

  const profile = defenceProfile(input.moveType);
  if (!profile) {
    throw new ORPCError("BAD_REQUEST", { message: `${input.moveType} is not a defence` });
  }
  const body = await combatFormFor(state.avatarId);
  if (body) {
    const { defenses } = movesForForm(body.form, body.level);
    if (!defenses.includes(input.moveType as never)) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Your avatar cannot ${input.moveType}`,
        data: { reason: "move_unavailable", defenses },
      });
    }
  }

  const stamina = staminaOf(state, now);
  const check = staminaCheck({ stamina, cost: profile.stamina });
  if (!check.allowed) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Too winded to guard",
      data: { reason: "stamina", stamina: Math.round(stamina), cost: profile.stamina },
    });
  }

  const at = new Date(now);
  await db
    .update(schema.battleState)
    .set({
      stamina: stamina - check.spend,
      staminaAt: at,
      guardMove: input.moveType,
      guardAt: at,
      arGapM: input.gapM ?? state.arGapM,
      spaceBehindM: input.spaceBehindM ?? state.spaceBehindM,
      // A guard is a committed animation too: you cannot guard twice inside
      // one, and its own recovery is what a feinting attacker plays against.
      recoverUntil: new Date(now + GUARD_COMMIT_MS),
      updatedAt: at,
    })
    .where(eq(schema.battleState.id, state.id));

  // Broadcast so the striker's client can show the read going up. Ephemeral —
  // a guard means nothing once the exchange it answered is over.
  await emit(
    input.matchId,
    "avatar_guard",
    {
      playerId: input.playerId,
      defenseType: input.moveType,
      answers: profile.answers,
      at: now,
    },
    { actorPlayerId: input.playerId },
  );

  return {
    defenseType: input.moveType,
    at: now,
    answers: profile.answers,
    stamina: Math.round(stamina - check.spend),
    window: GUARD_WINDOW,
  };
}

/**
 * How long a guard commits the defender for.
 *
 * Shorter than any attack's recovery on purpose: guessing wrong should cost
 * you the exchange, not the round.
 */
export const GUARD_COMMIT_MS = 420;

/* ----------------------------------------------------------------- attack */

export interface AttackInput {
  matchId: string;
  playerId: string;
  targetPlayerId: string;
  /** The move the player chose, validated against their own body. */
  moveType?: string | null;
  /** AR-room metres this device measured to the target. Soft — see reachOf. */
  gapM?: number | null;
  /** Metres of real space behind the striker's own back. */
  spaceBehindM?: number | null;
}

/**
 * One exchange, resolved in two halves.
 *
 * The old version did everything in one breath: roll damage, write it, then
 * pick an animation to explain what had already happened. Nothing the defender
 * did could matter, because by the time they saw anything it was over.
 *
 * Now the attack commits, pays for itself, announces itself, and only *then*
 * lands — at a moment the server stamped before anyone could react to it. In
 * between, the defender gets the length of the move's own windup to answer it,
 * and the answer is graded against that stamp. The request is held open for
 * that window because the striker is watching their own animation play out
 * anyway, and it means the result and the contact arrive together.
 */
export async function attack(input: AttackInput) {
  const committedAt = Date.now();
  await requireActiveMatch(input.matchId);
  if (input.playerId === input.targetPlayerId) {
    throw new ORPCError("BAD_REQUEST", { message: "Pick another target" });
  }
  const attacker = await requireState(input.matchId, input.playerId);
  const target = await requireState(input.matchId, input.targetPlayerId);
  if (!attacker.alive) throw new ORPCError("BAD_REQUEST", { message: "You are knocked out" });
  if (!target.alive) throw new ORPCError("BAD_REQUEST", { message: "Target is already down" });
  requireStationary(attacker);
  await requireSafeToFight(attacker, input.playerId, "attack");
  requireActable(attacker, committedAt);

  const range = rangeBetween(attacker, target);
  if (range != null && range > ATTACK_RANGE_M) {
    throw new ORPCError("BAD_REQUEST", { message: `Target ${Math.round(range)}m away, out of ${ATTACK_RANGE_M}m range` });
  }

  const picked = await resolveAttackMove({
    matchId: input.matchId,
    attacker,
    target,
    moveType: input.moveType,
  });
  const profile = attackProfile(picked.move);

  const stamina = staminaOf(attacker, committedAt);
  const check = staminaCheck({ stamina, cost: profile.stamina });
  if (!check.allowed) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: `Too winded for ${picked.move}`,
      data: {
        reason: "stamina",
        stamina: Math.round(stamina),
        cost: profile.stamina,
        readyInMs: Math.round(
          ((profile.stamina * STAMINA_MIN_SHARE - stamina) / regenPerSecond(attacker.speed)) * 1000,
        ),
      },
    });
  }

  const strikeAt = committedAt + deferMs(picked.move);
  // Pay up front. The stamina and the recovery are spent the moment the move
  // is thrown, so a request abandoned mid-windup still cost what it cost —
  // there is no free feint.
  await db
    .update(schema.battleState)
    .set({
      stamina: stamina - check.spend,
      staminaAt: new Date(committedAt),
      lastAttackAt: new Date(committedAt),
      recoverUntil: new Date(committedAt + profile.durationMs + profile.recoveryMs),
      arGapM: input.gapM ?? attacker.arGapM,
      spaceBehindM: input.spaceBehindM ?? attacker.spaceBehindM,
      updatedAt: new Date(committedAt),
    })
    .where(eq(schema.battleState.id, attacker.id));

  // The telegraph. Everything the defender needs to read this blow, sent
  // before it lands rather than after: what is coming, what kind of thing it
  // is, and the exact moment it arrives.
  await emit(
    input.matchId,
    "avatar_windup",
    {
      playerId: input.playerId,
      targetPlayerId: input.targetPlayerId,
      attackType: picked.move,
      kind: profile.kind,
      windupMs: profile.windupMs,
      durationMs: profile.durationMs,
      strikeAt,
      parryFromMs: strikeAt + GUARD_WINDOW.parryFromMs,
      parryToMs: strikeAt + GUARD_WINDOW.parryToMs,
    },
    { actorPlayerId: input.playerId, targetPlayerId: input.targetPlayerId },
  );

  await waitUntil(strikeAt);

  // Re-read both sides: the defender has had the whole windup to answer, and
  // either of them may have been knocked out by someone else in the meantime.
  const striker = await requireState(input.matchId, input.playerId);
  const receiver = await requireState(input.matchId, input.targetPlayerId);
  if (!striker.alive || !receiver.alive) {
    return {
      damage: 0,
      crit: false,
      critChance: 0,
      variance: 1,
      expected: 0,
      targetHealth: receiver.currentHealth,
      killed: false,
      voided: true,
      whiff: false,
      grade: "clean" as GuardGrade,
      gradeLabel: GRADE_LABEL.clean,
      offsetMs: null,
      rangeM: range,
      gapM: null,
      strikeAt,
      windupMs: profile.windupMs,
      attackType: picked.move,
      defenseType: null,
      riposte: 0,
      cornered: false,
      staminaScale: check.scale,
      stamina: Math.round(staminaOf(striker)),
      message: null,
    };
  }

  const verdict = gradeGuard({
    attackMove: picked.move,
    defenceMove: receiver.guardMove,
    strikeAt,
    guardAt: receiver.guardAt?.getTime() ?? null,
  });

  // Whose metres these are: both devices measure the same AR gap and the
  // larger reading wins, so under-reporting to force a hit is overruled by the
  // target's own measurement. Nothing measured at all still connects, which is
  // what keeps a headless or pre-AR client playable.
  const gapM = gapForCheck(input.gapM ?? null, receiver.arGapM ?? null);
  const connected = inReach({ move: picked.move, gapM });

  const cornered = corneredMultiplier(receiver.spaceBehindM);
  const swing = computeDamage({
    attack: striker.attack,
    defense: receiver.defense,
    attackerSpeed: striker.speed,
    targetHealth: receiver.currentHealth,
    multiplier: profile.power * check.scale * cornered,
    critBonus: profile.critBonus,
  });

  // The defence scales what lands, not what was thrown — so a riposte is a
  // share of the blow the defender actually turned around, and a hard-won
  // parry against a slam pays what a slam is worth.
  const landed = !connected
    ? 0
    : verdict.multiplier <= 0
      ? 0
      : Math.max(1, Math.round(swing.damage * verdict.multiplier));
  const targetHealth = Math.max(0, receiver.currentHealth - landed);
  const result: DamageResult = {
    ...swing,
    damage: landed,
    crit: connected && swing.crit,
    targetHealth,
    killed: targetHealth === 0 && landed > 0,
  };
  const riposte = connected && verdict.riposte > 0 ? Math.round(swing.damage * verdict.riposte) : 0;

  /*
   * Hit confirm. A blow that connected and was not parried lets go of the body
   * early — a fraction of its own recovery from the contact frame, instead of
   * the whole swing plus the whole recovery — so landing a hit is what buys
   * the next one and pressure is a thing a player can hold. A whiff pays the
   * full price it always did, and a parry pays more than that.
   */
  const fullRecoverAt = committedAt + profile.durationMs + profile.recoveryMs;
  const cancelled = connected && landed > 0 && !verdict.stagger;
  const recoverAt = cancelled
    ? hitCancelRecoverAt({ strikeAt, fullRecoverAt })
    : fullRecoverAt;

  await db
    .update(schema.battleState)
    .set({
      damageDealt: striker.damageDealt + landed,
      kills: striker.kills + (result.killed ? 1 : 0),
      // A parry does not just reduce the blow, it takes the exchange away:
      // the attacker is held in their own recovery for longer than they chose.
      staggeredUntil: verdict.stagger
        ? new Date(fullRecoverAt + STAGGER_MS)
        : striker.staggeredUntil,
      ...(cancelled ? { recoverUntil: new Date(recoverAt) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.battleState.id, striker.id));

  if (landed > 0) await applyDamage(receiver, result);

  // A guard is consumed by the blow it answered — but a whiff consumes
  // nothing, so a read that the attacker swung short of is still up for the
  // next one.
  let riposteResult: DamageResult | null = null;
  if (connected) {
    const cleared: Partial<typeof schema.battleState.$inferInsert> = {
      guardMove: null,
      guardAt: null,
      updatedAt: new Date(),
    };
    await db.update(schema.battleState).set(cleared).where(eq(schema.battleState.id, receiver.id));

    if (riposte > 0) {
      const strikerHealth = Math.max(0, striker.currentHealth - riposte);
      riposteResult = {
        damage: riposte,
        crit: false,
        critChance: 0,
        variance: 1,
        expected: riposte,
        targetHealth: strikerHealth,
        killed: strikerHealth === 0,
      };
      await applyDamage({ ...striker, damageTaken: striker.damageTaken }, riposteResult);
      await db
        .update(schema.battleState)
        .set({
          damageDealt: receiver.damageDealt + riposte,
          kills: receiver.kills + (riposteResult.killed ? 1 : 0),
          updatedAt: new Date(),
        })
        .where(eq(schema.battleState.id, receiver.id));
    }
  }

  const names = await displayNames(input.matchId, [input.playerId, input.targetPlayerId]);
  const message = await generateBattleMessage({
    kind: connected ? "hit" : "miss",
    actor: names[input.playerId] ?? "Unknown",
    target: names[input.targetPlayerId] ?? "Unknown",
    damage: landed,
    grade: connected ? GRADE_LABEL[verdict.grade] : "Whiffed",
  });

  const defenseType = await defenceAnimation({
    matchId: input.matchId,
    receiver,
    verdict,
    landed,
    seed: `${input.matchId}:${input.playerId}:${input.targetPlayerId}:${striker.damageDealt}`,
  });

  await emit(
    input.matchId,
    "avatar_damage",
    {
      playerId: input.playerId,
      targetPlayerId: input.targetPlayerId,
      damage: landed,
      crit: result.crit,
      /** The roll, shown rather than hidden. */
      critChance: result.critChance,
      variance: result.variance,
      expected: result.expected,
      targetHealth,
      source: "attack",
      rangeM: range,
      gapM,
      whiff: !connected,
      attackType: picked.move,
      defenseType,
      grade: verdict.grade,
      gradeLabel: connected ? GRADE_LABEL[verdict.grade] : "Whiffed",
      offsetMs: verdict.offsetMs,
      riposte,
      cornered: cornered > 1,
      staminaScale: Math.round(check.scale * 100) / 100,
      /**
       * What the attacker has left to wait, from the moment this was sent.
       *
       * The client keeps its own copy of the recovery deadline — it has to,
       * because the poll answers every two seconds and a fight is decided in
       * less — and it guessed that deadline from the profile table on the
       * press. A hit confirm changes the answer after the press, so the real
       * one is sent with the landing rather than left to be discovered on the
       * next poll, two whole exchanges later.
       */
      recoverInMs: Math.max(0, recoverAt - Date.now()),
      cancelled,
    },
    { message, actorPlayerId: input.playerId, targetPlayerId: input.targetPlayerId },
  );

  // The blow resolved before the riposte did, so the striker's kill is settled
  // first and at most one death is announced per exchange.
  if (result.killed) {
    await handleDeath(input.matchId, input.playerId, input.targetPlayerId);
  } else if (riposteResult?.killed) {
    await handleDeath(input.matchId, input.targetPlayerId, input.playerId);
  }

  return {
    ...result,
    voided: false,
    whiff: !connected,
    grade: verdict.grade,
    gradeLabel: connected ? GRADE_LABEL[verdict.grade] : "Whiffed",
    offsetMs: verdict.offsetMs,
    rangeM: range,
    gapM,
    strikeAt,
    windupMs: profile.windupMs,
    attackType: picked.move,
    defenseType,
    riposte,
    cornered: cornered > 1,
    staminaScale: check.scale,
    stamina: Math.round(staminaOf({ ...striker, stamina: stamina - check.spend, staminaAt: new Date(committedAt) })),
    message,
  };
}

/**
 * What the defending body plays.
 *
 * A graded guard plays what the player actually pressed — upgraded to its
 * defensive combo when the read earned a hit back, because that is what those
 * combos were always for. An ungraded one (nobody answered, or the answer
 * missed the window entirely) falls back to the old seeded roll, so an
 * unattended opponent still moves like a creature instead of standing there.
 */
async function defenceAnimation(input: {
  matchId: string;
  receiver: typeof schema.battleState.$inferSelect;
  verdict: GuardVerdict;
  landed: number;
  seed: string;
}) {
  const body = await combatFormFor(input.receiver.avatarId);
  const guarded = input.verdict.grade !== "clean" && input.receiver.guardMove;
  if (guarded) {
    const move = input.receiver.guardMove!;
    if (input.verdict.grade === "parry" && input.verdict.riposte > 0) {
      const combo = RIPOSTE_ANIMATION[move];
      if (combo && body && movesForForm(body.form, body.level).combos.includes(combo as never)) {
        return combo;
      }
    }
    return move;
  }
  if (!body) return null;
  return pickDefenseMove({
    form: body.form,
    level: body.level,
    seed: `${input.seed}:d`,
    hit: input.landed > 0,
  }) as string;
}

/* ------------------------------------------------------------- abilities */

export async function useAbility(input: {
  matchId: string;
  playerId: string;
  abilityId: string;
  targetPlayerId?: string;
}) {
  await requireActiveMatch(input.matchId);
  const caster = await requireState(input.matchId, input.playerId);
  if (!caster.alive) throw new ORPCError("BAD_REQUEST", { message: "You are knocked out" });
  requireStationary(caster);
  await requireSafeToFight(caster, input.playerId, "ability");
  if (caster.abilityReadyAt && caster.abilityReadyAt.getTime() > Date.now()) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: `Ability ready in ${Math.ceil((caster.abilityReadyAt.getTime() - Date.now()) / 1000)}s`,
    });
  }

  const abilities = JSON.parse(caster.abilities) as AbilityDef[];
  const ability = abilities.find((a) => a.id === input.abilityId) ?? abilities[0];
  if (!ability) throw new ORPCError("BAD_REQUEST", { message: "No ability available" });

  const names = await displayNames(input.matchId);
  const hits: {
    playerId: string;
    damage: number;
    health: number;
    killed: boolean;
    defenseType?: string | null;
  }[] = [];
  let selfHeal = 0;
  // An ability animates as one attack on the caster, chosen from the body and
  // nudged by the ability's own effect: an area effect comes out as a slam or a
  // burst, never a bite.
  const casterBody = await combatFormFor(caster.avatarId);
  const abilitySeed = `${input.matchId}:${input.playerId}:${ability.id}:${caster.damageDealt}`;
  let attackType: string | null = casterBody
    ? pickAttackMove({
        form: casterBody.form,
        level: casterBody.level,
        seed: abilitySeed,
        effect: ability.effect,
      })
    : null;
  // A heal or a shield is not a strike — the caster guards instead.
  if (ability.effect === "heal" || ability.effect === "shield") {
    attackType = casterBody
      ? pickDefenseMove({ form: casterBody.form, level: casterBody.level, seed: abilitySeed, hit: false })
      : null;
  }

  if (ability.effect === "heal" || ability.effect === "shield") {
    const gain = Math.round(ability.damage || 20);
    const healed = Math.min(caster.maxHealth, caster.currentHealth + gain);
    selfHeal = healed - caster.currentHealth;
    await db
      .update(schema.battleState)
      .set({ currentHealth: healed, updatedAt: new Date() })
      .where(eq(schema.battleState.id, caster.id));
  } else {
    const targets = await abilityTargets(input.matchId, caster, ability, input.targetPlayerId);
    for (const target of targets) {
      const result = computeDamage({
        attack: Math.round(caster.attack * 0.5 + ability.damage),
        defense: target.defense,
        attackerSpeed: caster.speed,
        targetHealth: target.currentHealth,
      });
      await applyDamage(target, result);
      const targetBody = await combatFormFor(target.avatarId);
      hits.push({
        playerId: target.playerId,
        damage: result.damage,
        health: result.targetHealth,
        killed: result.killed,
        defenseType: targetBody
          ? pickDefenseMove({
              form: targetBody.form,
              level: targetBody.level,
              seed: `${abilitySeed}:${target.playerId}`,
              hit: result.damage > 0,
            })
          : null,
      });
    }
  }

  const totalDamage = hits.reduce((sum, h) => sum + h.damage, 0);
  await db
    .update(schema.battleState)
    .set({
      abilityReadyAt: new Date(Date.now() + ability.cooldownSeconds * 1_000),
      damageDealt: caster.damageDealt + totalDamage,
      kills: caster.kills + hits.filter((h) => h.killed).length,
      updatedAt: new Date(),
    })
    .where(eq(schema.battleState.id, caster.id));

  const message = await generateBattleMessage({
    kind: "ability",
    actor: names[input.playerId] ?? "Unknown",
    target: hits.length === 1 ? names[hits[0]!.playerId] : undefined,
    ability: ability.name,
    damage: totalDamage || selfHeal,
  });

  await emit(
    input.matchId,
    "avatar_action",
    {
      playerId: input.playerId,
      action: "ability",
      abilityId: ability.id,
      abilityName: ability.name,
      effect: ability.effect,
      radiusM: ability.radiusM,
      hits,
      selfHeal,
      cooldownSeconds: ability.cooldownSeconds,
      attackType,
    },
    { message, actorPlayerId: input.playerId },
  );

  for (const hit of hits) {
    await emit(
      input.matchId,
      "avatar_damage",
      {
        playerId: input.playerId,
        targetPlayerId: hit.playerId,
        damage: hit.damage,
        targetHealth: hit.health,
        source: "ability",
        abilityName: ability.name,
        attackType,
        defenseType: hit.defenseType ?? null,
      },
      { actorPlayerId: input.playerId, targetPlayerId: hit.playerId },
    );
    if (hit.killed) await handleDeath(input.matchId, input.playerId, hit.playerId);
  }

  return { ability, hits, selfHeal, message, attackType };
}

async function abilityTargets(
  matchId: string,
  caster: typeof schema.battleState.$inferSelect,
  ability: AbilityDef,
  explicitTargetId?: string,
) {
  const all = await db
    .select()
    .from(schema.battleState)
    .where(eq(schema.battleState.matchId, matchId));
  const enemies = all.filter((s) => s.playerId !== caster.playerId && s.alive);

  if (explicitTargetId) {
    const target = enemies.find((s) => s.playerId === explicitTargetId);
    if (!target) throw new ORPCError("BAD_REQUEST", { message: "Target unavailable" });
    return [target];
  }
  if (ability.radiusM > 0) {
    const inRadius = enemies.filter((s) => {
      const range = rangeBetween(caster, s);
      return range == null || range <= Math.max(ability.radiusM, 5);
    });
    return inRadius.length > 0 ? inRadius : enemies.slice(0, 1);
  }
  return enemies.slice(0, 1);
}

/* ------------------------------------------------------- damage and death */

async function applyDamage(target: typeof schema.battleState.$inferSelect, result: DamageResult) {
  await db
    .update(schema.battleState)
    .set({
      currentHealth: result.targetHealth,
      damageTaken: target.damageTaken + result.damage,
      alive: result.targetHealth > 0,
      diedAt: result.targetHealth === 0 ? new Date() : target.diedAt,
      updatedAt: new Date(),
    })
    .where(eq(schema.battleState.id, target.id));
}

async function handleDeath(matchId: string, killerPlayerId: string, victimPlayerId: string) {
  const names = await displayNames(matchId, [killerPlayerId, victimPlayerId]);
  const message = await generateBattleMessage({
    kind: "death",
    actor: names[killerPlayerId] ?? "Unknown",
    target: names[victimPlayerId] ?? "Unknown",
  });
  await emit(
    matchId,
    "avatar_death",
    { playerId: victimPlayerId, killedByPlayerId: killerPlayerId },
    { message, actorPlayerId: killerPlayerId, targetPlayerId: victimPlayerId },
  );

  const alive = (await db.select().from(schema.battleState).where(eq(schema.battleState.matchId, matchId))).filter(
    (s) => s.alive,
  );
  if (alive.length <= 1) {
    await finishMatch({ matchId, reason: "last_standing" });
  }
}

function rangeBetween(
  a: typeof schema.battleState.$inferSelect,
  b: typeof schema.battleState.$inferSelect,
) {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  return distanceM({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
}

async function displayNames(matchId: string, only?: string[]) {
  const rows = await db
    .select({ playerId: schema.battleState.playerId, avatarName: schema.avatar.name })
    .from(schema.battleState)
    .innerJoin(schema.avatar, eq(schema.avatar.id, schema.battleState.avatarId))
    .where(eq(schema.battleState.matchId, matchId));
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (!only || only.includes(row.playerId)) map[row.playerId] = row.avatarName;
  }
  return map;
}

/* ---------------------------------------------------------------- rewards */

export const REWARDS = {
  baseXp: 40,
  xpPerKill: 25,
  xpPerHundredDamage: 8,
  winXpBonus: 60,
  baseCurrency: 25,
  currencyPerKill: 15,
  winCurrencyBonus: 50,
};

/** Settle a match: rank players, pay rewards, roll drops, write the summary. */
export async function finishMatch(input: { matchId: string; reason: string }) {
  const [match] = await db.select().from(schema.match).where(eq(schema.match.id, input.matchId));
  if (!match) throw new ORPCError("NOT_FOUND", { message: "Match not found" });
  if (match.status === "finished") return matchSnapshot(input.matchId);

  const rows = await matchStates(input.matchId);
  const ranked = [...rows].sort((a, b) => {
    if (a.state.alive !== b.state.alive) return a.state.alive ? -1 : 1;
    if (b.state.kills !== a.state.kills) return b.state.kills - a.state.kills;
    return b.state.damageDealt - a.state.damageDealt;
  });
  const winner = ranked[0];
  const rewards: {
    playerId: string;
    username: string;
    placement: number;
    xp: number;
    currency: number;
    drop: { name: string; rarity: string; instanceId: string } | null;
    boosterProgress: Awaited<ReturnType<typeof awardBoosterXp>>;
  }[] = [];

  for (const [index, row] of ranked.entries()) {
    const won = index === 0 && ranked.length > 1;
    const xp =
      REWARDS.baseXp +
      row.state.kills * REWARDS.xpPerKill +
      Math.round((row.state.damageDealt / 100) * REWARDS.xpPerHundredDamage) +
      (won ? REWARDS.winXpBonus : 0);
    const currency =
      REWARDS.baseCurrency + row.state.kills * REWARDS.currencyPerKill + (won ? REWARDS.winCurrencyBonus : 0);

    await grantXp(row.state.playerId, xp);
    await adjustCurrency(row.state.playerId, currency);
    await recordResult(row.state.playerId, won);
    await logTransaction({
      type: "battle_reward",
      toPlayerId: row.state.playerId,
      amount: currency,
      netAmount: currency,
      note: `Match ${input.matchId} placement ${index + 1}`,
    });
    await db
      .update(schema.matchPlayer)
      .set({ placement: index + 1, xpEarned: xp, currencyEarned: currency })
      .where(
        and(
          eq(schema.matchPlayer.matchId, input.matchId),
          eq(schema.matchPlayer.playerId, row.state.playerId),
        ),
      );

    const drop = await rollBattleDrop(row.state.playerId, won ? 1.6 : 1);
    // Boosters that fought level up too — win pays roughly 2.5x a loss.
    const boosterProgress = await awardBoosterXp({
      ownerId: row.state.playerId,
      avatarId: row.state.avatarId,
      amount: won ? BOOSTER_XP_REWARD.battle_win : BOOSTER_XP_REWARD.battle_loss,
    });
    rewards.push({
      playerId: row.state.playerId,
      username: row.username,
      placement: index + 1,
      xp,
      currency,
      drop: drop ? { name: drop.booster.name, rarity: drop.booster.rarity, instanceId: drop.instance.id } : null,
      boosterProgress,
    });
  }

  const [zone] = await db.select().from(schema.zone).where(eq(schema.zone.id, match.zoneId));
  const summary = await generateMatchSummary({
    zoneName: zone?.name ?? "the zone",
    winner: winner?.username ?? null,
    scoreboard: rows.map((row) => ({
      username: row.username,
      avatar: row.avatarName,
      kills: row.state.kills,
      damageDealt: row.state.damageDealt,
      alive: row.state.alive,
    })),
  });

  await db
    .update(schema.match)
    .set({
      status: "finished",
      endTime: new Date(),
      winnerPlayerId: winner?.state.playerId ?? null,
      summary,
    })
    .where(eq(schema.match.id, input.matchId));

  await emit(
    input.matchId,
    "match_finished",
    { reason: input.reason, winnerPlayerId: winner?.state.playerId ?? null, rewards },
    { message: summary },
  );

  return { ...(await matchSnapshot(input.matchId)), rewards, summary };
}

/** Build the per-avatar battle state rows when a match starts. */
export async function seedBattleStates(matchId: string) {
  const participants = await db
    .select()
    .from(schema.matchPlayer)
    .where(eq(schema.matchPlayer.matchId, matchId));

  for (const participant of participants) {
    const stats = await effectiveStats(participant.avatarId);
    const existing = await db
      .select({ id: schema.battleState.id })
      .from(schema.battleState)
      .where(
        and(
          eq(schema.battleState.matchId, matchId),
          eq(schema.battleState.playerId, participant.playerId),
        ),
      );
    if (existing.length > 0) continue;

    await db.insert(schema.battleState).values({
      id: `bts_${participant.id}`,
      matchId,
      playerId: participant.playerId,
      avatarId: participant.avatarId,
      maxHealth: stats.effective.health,
      currentHealth: stats.effective.health,
      attack: stats.effective.attack,
      defense: stats.effective.defense,
      speed: stats.effective.speed,
      abilities: JSON.stringify(stats.abilities),
    });
  }
}
