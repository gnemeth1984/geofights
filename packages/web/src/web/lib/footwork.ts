import { DEFENSIVE_COMBOS } from "../../api/lib/creature-form";
import type { AnimationState } from "@/ar/character";

/**
 * Which way the stick was pointing, relative to the opponent, when a move was
 * pressed.
 *
 * The stick used to be movement and the pad used to be attacks, and the two
 * never met: a player crossing the floor and a player standing still threw
 * exactly the same blow. This is the join. Facing is locked onto the opponent
 * now, so the stick is pure footwork — closing, giving ground, circling — and
 * footwork is the oldest way there is of saying which strike you meant.
 *
 * `null` is the thumb off the stick, and it is not a direction: a centred
 * stick throws the move on the button, unchanged.
 */
export type DriveBearing = "toward" | "away" | "left" | "right" | null;

/**
 * Closing on the opponent: the version of this blow that covers ground.
 *
 * One-to-one, and every pairing is the same blow arriving off a run rather
 * than a different move — a swipe becomes the lunging swipe, a bite becomes
 * the lunging bite, a punch becomes the running punch. Nothing here invents a
 * strike the body was not already asking for.
 *
 * The moves that already close are absent on purpose: a dash has covered its
 * ground by definition, and running at somebody to breathe fire on them is
 * worse than standing still to do it.
 */
const CLOSE_WITH: Partial<Record<AnimationState, readonly AnimationState[]>> = {
  swipe: ["dash_strike"],
  bite: ["dash_bite"],
  tail_whip: ["dash_whip"],
  ground_slam: ["dash_slam", "charge_slam"],
  punch: ["dash_punch"],
  kick: ["dash_punch"],
  grapple: ["dash_punch", "dash_strike"],
  pounce: ["pounce_bite"],
  charge: ["charge_slam"],
  piston_slam: ["charge_slam", "dash_slam"],
  pincer_snap: ["dash_bite"],
  dive_bomb: ["dash_strike"],
  spike_burst: ["gust_spike"],
  wing_gust: ["gust_spike"],
};

/**
 * Giving ground: what you throw while stepping back out of reach.
 *
 * Not a table but an order of preference, because a retreating strike is not
 * "this blow, further away" — it is whichever thing this body owns that
 * reaches without following. A tail lashes behind a step back; wings push
 * something away from you; breath and a burst never needed the distance
 * closing in the first place.
 */
const KEEP_AWAY: readonly AnimationState[] = [
  "tail_whip",
  "wing_gust",
  "fire_breath",
  "elemental_burst",
  "spike_burst",
];

/**
 * Circling: the chain that comes round the side.
 *
 * A step across an opponent buys the one thing a standing exchange never has
 * — an angle — and what it is worth spending on is a second hit off the
 * first, from a side the guard is not on.
 */
const FLANK_WITH: readonly AnimationState[] = [
  "swipe_bite",
  "punch_kick",
  "pounce_bite",
  "tail_whip",
];

/**
 * The move a press actually means, given where the thumb was.
 *
 * Silent about what it cannot do, deliberately. A directional variant is
 * gated on the same two things every move in this game is — the body having
 * the parts for it and the booster having unlocked it — so a level 1 creature
 * pushing forward on a punch simply throws the punch. A player leaning on the
 * stick should never be told off by the pad for it; they should feel the
 * difference the day the combo unlocks.
 *
 * `throwable` is the list the server will check this against, not a guess at
 * it, so this can only ever pick a move the fight would have accepted anyway.
 */
export function moveForFootwork(input: {
  pressed: AnimationState;
  bearing: DriveBearing;
  throwable: readonly AnimationState[];
}): AnimationState {
  const { pressed, bearing, throwable } = input;
  if (!bearing) return pressed;
  // Defences answer a blow in the air on their own timing. Footwork has
  // nothing to say about them, and the attack endpoint would refuse them.
  if (!throwable.includes(pressed)) return pressed;

  const candidates =
    bearing === "toward"
      ? (CLOSE_WITH[pressed] ?? [])
      : bearing === "away"
        ? KEEP_AWAY.includes(pressed)
          ? []
          : KEEP_AWAY
        : FLANK_WITH.includes(pressed)
          ? []
          : FLANK_WITH;

  for (const move of candidates) {
    if (move === pressed) continue;
    if ((DEFENSIVE_COMBOS as readonly string[]).includes(move)) continue;
    if (throwable.includes(move)) return move;
  }
  return pressed;
}

/** Everything this body may throw as an attack, in the order the pad shows it. */
export function throwableMoves(moves: {
  attacks: readonly AnimationState[];
  combos: readonly AnimationState[];
} | null): readonly AnimationState[] {
  if (!moves) return [];
  return [
    ...moves.attacks,
    ...moves.combos.filter((move) => !(DEFENSIVE_COMBOS as readonly string[]).includes(move)),
  ];
}
