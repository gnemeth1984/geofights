/**
 * What a move *does*, as opposed to what it looks like.
 *
 * The animation layer has always known that a ground slam is heavier than a
 * bite: `DURATION` and `STRIKE_BEATS` in `character.ts` say so, in seconds and
 * in contact weight. The combat engine did not. It took `{ matchId,
 * targetPlayerId }`, ran one damage formula and then picked an animation from a
 * hash — so nineteen moves resolved identically and the pad was, by its own
 * admission, showing the player a move they had not chosen.
 *
 * This file is where a move gets consequences. Power, reach, stamina, how long
 * its telegraph runs and how exposed it leaves the body; and on the other side
 * of the exchange, what a defence costs and what it is good against.
 *
 * Like `creature-form.ts` and `damage.ts` it imports nothing, because three
 * separate things read it and they must not disagree: the engine resolving a
 * hit, the pad deciding whether a button is throwable, and the stage deciding
 * whether a swing finds air.
 *
 * ## Timing is read, never restated
 *
 * Every `windupMs` and `durationMs` below is the animation's own number, in
 * milliseconds, derived by one rule and no judgement:
 *
 *   durationMs = animationDuration(move) × 1000
 *   windupMs   = the first strike frame with weight ≥ CONTACT_WEIGHT_MIN,
 *                or the first frame at all if none of them clear it
 *
 * They are duplicated here because the server cannot import `character.ts`
 * (it pulls in three.js), and duplicated numbers drift. So they do not get to
 * drift quietly: `timing-check.ts` imports the real module, recomputes both
 * from `strikeFrames()` and `animationDuration()`, and fails on a single
 * millisecond of disagreement. Retune a curve and the check says this table is
 * stale. It has already caught five numbers that a hand-copy got wrong.
 */

/**
 * How much contact weight a strike frame needs before the fight treats it as
 * the blow rather than as travel.
 *
 * `dodge_counter` opens with a 0.12-weight hop and `swipe_bite` with a
 * 0.44-weight swipe: one of those is a blow you have to answer and one is
 * footwork. This is the line between them.
 */
export const CONTACT_WEIGHT_MIN = 0.3;

/* --------------------------------------------------------------- categories */

/**
 * What a move *is*, for the purpose of answering it.
 *
 * A guard that works against a claw does not work against a shockwave coming
 * through the floor, and a sidestep that beats a lunge cannot sidestep an area
 * burst. Two categories is enough to make that true without a matrix nobody
 * can hold in their head.
 */
export type MoveKind = "melee" | "area";

/* ------------------------------------------------------------ attack profile */

export type AttackProfile = {
  kind: MoveKind;
  /**
   * Damage multiplier on the engine's own number. `computeDamage` still owns
   * attack, defence and mitigation — this scales the result, so a stat
   * advantage is never deleted by a move choice, only shaded by it.
   */
  power: number;
  /**
   * How far past the close guard this move can touch, in AR-room metres.
   *
   * Un-floored, unlike the client's old table: a bite genuinely cannot reach
   * from where the game seats a sparring pair, and closing that gap is the
   * player's job. See `REACH_NOTE`.
   */
  reachM: number;
  /** Stamina it costs to throw. */
  stamina: number;
  /**
   * Milliseconds from the move starting to the blow landing — its telegraph.
   * The defender's whole read happens inside this window, so it is also the
   * move's fairness: 201 ms is a poke nobody can answer on sight, 1311 ms is a
   * commitment that deserves to be punished.
   */
  windupMs: number;
  /** The move's own length, start to recovered. */
  durationMs: number;
  /**
   * How long after the blow the attacker is still committed. What a parry or a
   * whiff gets to punish, and why a heavy move is a decision rather than a
   * default.
   */
  recoveryMs: number;
  /** Added to the crit chance, before the speed term. Fast light moves crit. */
  critBonus: number;
  /**
   * Metres of ground the move itself eats before it swings, added to reach
   * when the hit is checked.
   *
   * This is what a dash is *for*. Spacing is only interesting if there is a
   * way to beat it, and the answer to standing outside a bite's 0.30 m is a
   * move that closes 0.45 m on its own — at the cost of a windup long enough
   * to read and a recovery long enough to punish. Zero for everything that
   * swings from where it stands.
   */
  closesM: number;
};

/**
 * Every attack, with its consequences.
 *
 * The shape of the table is deliberate and consistent: the further left a move
 * sits on the windup axis the less it should pay out, and the heavy end buys
 * its power with telegraph, stamina and recovery. `spike_burst` is the cheap
 * fast poke; `ground_slam` and the dash combos are the commitments.
 */
export const ATTACK_PROFILE: Record<string, AttackProfile> = {
  // --- singles -------------------------------------------------------------
  swipe: {
    kind: "melee",
    power: 0.84,
    reachM: 0.4,
    stamina: 12,
    windupMs: 232,
    durationMs: 700,
    recoveryMs: 190,
    critBonus: 0.05,
    closesM: 0,
  },
  bite: {
    kind: "melee",
    power: 0.98,
    // The shortest reach in the game, and below the gap a spar starts at: a
    // bite is what you land once you have closed, not an opener.
    reachM: 0.3,
    stamina: 14,
    windupMs: 325,
    durationMs: 600,
    recoveryMs: 210,
    critBonus: 0.04,
    closesM: 0,
  },
  tail_whip: {
    kind: "melee",
    power: 1.06,
    reachM: 0.66,
    stamina: 16,
    windupMs: 331,
    durationMs: 800,
    recoveryMs: 260,
    critBonus: 0.02,
    closesM: 0,
  },
  wing_gust: {
    kind: "area",
    power: 0.9,
    reachM: 0.95,
    stamina: 18,
    windupMs: 592,
    durationMs: 950,
    recoveryMs: 240,
    critBonus: 0,
    closesM: 0,
  },
  spike_burst: {
    kind: "area",
    // The fast poke: 201 ms of telegraph is barely a read, so it pays least.
    power: 0.76,
    reachM: 0.8,
    stamina: 13,
    windupMs: 201,
    durationMs: 650,
    recoveryMs: 200,
    critBonus: 0.03,
    closesM: 0,
  },
  charge: {
    kind: "melee",
    power: 1.2,
    reachM: 0.5,
    stamina: 22,
    windupMs: 475,
    durationMs: 850,
    recoveryMs: 320,
    critBonus: 0,
    closesM: 0.34,
  },
  dash_strike: {
    kind: "melee",
    power: 1.14,
    // A dash brings its range with it; the stage adds the ground it covers.
    reachM: 0.42,
    stamina: 20,
    windupMs: 548,
    durationMs: 1050,
    recoveryMs: 300,
    critBonus: 0.04,
    closesM: 0.52,
  },
  ground_slam: {
    kind: "area",
    power: 1.42,
    reachM: 0.72,
    stamina: 26,
    windupMs: 530,
    durationMs: 1000,
    recoveryMs: 400,
    critBonus: 0,
    closesM: 0,
  },
  elemental_burst: {
    kind: "area",
    power: 1.32,
    reachM: 1.15,
    stamina: 25,
    windupMs: 418,
    durationMs: 1100,
    recoveryMs: 350,
    critBonus: 0,
    closesM: 0,
  },

  // --- category singles ----------------------------------------------------
  // The moves a creature gets for *being* something rather than for having a
  // part. Same axis as everything above — telegraph buys payout — and pinned
  // to the same reference points: `punch` sits alongside `spike_burst` at the
  // fast cheap end, `piston_slam` alongside `ground_slam` at the committed
  // end, and nothing in between is priced better than both of its neighbours.
  punch: {
    kind: "melee",
    // The cheapest, fastest, weakest thing in the game, and the only attack
    // with a recovery short enough to throw twice before an answer lands. A
    // jab is a jab: it is how a humanoid holds the initiative, not how it
    // wins, and every category's core move out-damages it.
    power: 0.72,
    // Arm's length — further than a bite has to close for, shorter than the
    // arc a claw sweeps through.
    reachM: 0.34,
    stamina: 9,
    windupMs: 204,
    durationMs: 500,
    recoveryMs: 160,
    critBonus: 0.07,
    closesM: 0,
  },
  kick: {
    kind: "melee",
    // A leg is heavier than an arm and reaches further, and the chambered
    // knee buys the defender 71 ms more than the punch does.
    power: 1,
    reachM: 0.48,
    stamina: 15,
    windupMs: 275,
    durationMs: 580,
    recoveryMs: 250,
    critBonus: 0.04,
    closesM: 0,
  },
  grapple: {
    kind: "melee",
    // The longest humanoid telegraph and the shortest humanoid reach: you
    // have to be inside a bite's distance to take hold of something, and the
    // 587 ms it takes is plenty of warning that you are trying to.
    power: 1.38,
    reachM: 0.32,
    stamina: 24,
    windupMs: 587,
    durationMs: 900,
    recoveryMs: 420,
    critBonus: 0.02,
    closesM: 0.12,
  },
  pounce: {
    kind: "melee",
    // The beastly answer to spacing. Less ground than a dash and less
    // telegraph, so it trades the dash's power for getting there sooner.
    power: 1.16,
    reachM: 0.38,
    stamina: 19,
    windupMs: 388,
    durationMs: 820,
    recoveryMs: 300,
    critBonus: 0.05,
    closesM: 0.4,
  },
  fire_breath: {
    kind: "area",
    // The longest reach in the game — it is the one attack that does not need
    // to arrive anywhere — priced against `elemental_burst`, which it lines
    // up with almost exactly on telegraph.
    power: 1.3,
    reachM: 1.2,
    stamina: 26,
    windupMs: 422,
    durationMs: 1050,
    recoveryMs: 340,
    critBonus: 0,
    closesM: 0,
  },
  pincer_snap: {
    kind: "melee",
    // Two clacks in one move, which is two chances at the crit roll and why
    // this carries the second-highest `critBonus` in the table on a move that
    // is otherwise unremarkable.
    power: 0.88,
    reachM: 0.36,
    stamina: 12,
    windupMs: 266,
    durationMs: 500,
    recoveryMs: 210,
    critBonus: 0.06,
    closesM: 0,
  },
  dive_bomb: {
    kind: "melee",
    // The longest single-move telegraph in the game. It has to be: it closes
    // half a metre and arrives at 0.84 weight, and a player who does not get
    // to see that coming has no game to play.
    power: 1.34,
    reachM: 0.44,
    stamina: 23,
    windupMs: 613,
    durationMs: 1050,
    recoveryMs: 380,
    critBonus: 0.03,
    closesM: 0.5,
  },
  piston_slam: {
    kind: "melee",
    // The heaviest single-target blow in the game, which is deliberate: it is
    // the *only* core move a mechanical body has, so the category lives or
    // dies on it. Paid for with the second-longest telegraph and the longest
    // recovery of any single, and no crit at all — a ram does not get lucky.
    power: 1.45,
    reachM: 0.5,
    stamina: 27,
    windupMs: 519,
    durationMs: 900,
    recoveryMs: 430,
    critBonus: 0,
    closesM: 0,
  },

  // --- combos --------------------------------------------------------------
  // Two blows on one timeline. They resolve as one hit, at the first frame that
  // is actually a *blow* (see CONTACT_WEIGHT_MIN), and pay for the pair with
  // stamina and a recovery nobody wants to be caught in. For the dash combos
  // that is the dash itself, which lands well before the finisher. For
  // `dodge_counter` it is not: the opening hop carries no weight, so the read
  // is on the counter at 1.09 s — which is why it hits as hard as it does and
  // why it is the one move you get over a second to answer.
  swipe_bite: {
    kind: "melee",
    power: 1.34,
    reachM: 0.38,
    stamina: 26,
    windupMs: 219,
    durationMs: 1200,
    recoveryMs: 340,
    critBonus: 0.05,
    closesM: 0,
  },
  charge_slam: {
    kind: "area",
    power: 1.74,
    reachM: 0.6,
    stamina: 38,
    windupMs: 475,
    durationMs: 1700,
    recoveryMs: 520,
    critBonus: 0,
    closesM: 0.34,
  },
  gust_spike: {
    kind: "area",
    power: 1.4,
    reachM: 0.9,
    stamina: 30,
    windupMs: 468,
    durationMs: 1500,
    recoveryMs: 400,
    critBonus: 0.02,
    closesM: 0,
  },
  dash_bite: {
    kind: "melee",
    power: 1.46,
    reachM: 0.36,
    stamina: 30,
    windupMs: 469,
    durationMs: 1550,
    recoveryMs: 420,
    critBonus: 0.05,
    closesM: 0.52,
  },
  dash_whip: {
    kind: "melee",
    power: 1.52,
    reachM: 0.5,
    stamina: 32,
    windupMs: 488,
    durationMs: 1700,
    recoveryMs: 440,
    critBonus: 0.03,
    closesM: 0.52,
  },
  dash_slam: {
    kind: "area",
    power: 1.82,
    reachM: 0.66,
    stamina: 40,
    windupMs: 502,
    durationMs: 1850,
    recoveryMs: 560,
    critBonus: 0,
    closesM: 0.46,
  },
  dodge_counter: {
    kind: "melee",
    power: 1.5,
    reachM: 0.44,
    stamina: 28,
    windupMs: 1088,
    durationMs: 1500,
    recoveryMs: 360,
    critBonus: 0.08,
    closesM: 0.2,
  },
  absorb_burst: {
    kind: "area",
    power: 1.66,
    reachM: 1.0,
    stamina: 34,
    windupMs: 549,
    durationMs: 1900,
    recoveryMs: 480,
    critBonus: 0,
    closesM: 0,
  },

  // --- category combos -----------------------------------------------------
  // Same rule as the combos above: the read is on the *first* frame heavy
  // enough to count, so a pair that opens with a real blow gets a short
  // windup and has to be priced down for it.
  punch_kick: {
    kind: "melee",
    // Opens at 197 ms — the shortest telegraph of any combo in the game,
    // because the jab that starts it is already a hit. That makes it the
    // cheapest and weakest pair on the board: it beats either single on its
    // own but loses to every other combo, which is the trade for being the
    // one you can actually throw on reaction.
    power: 1.2,
    // The kick finishes, so it reaches nearly as far as the kick does.
    reachM: 0.46,
    // Just under punch + kick paid separately (24 vs 24), so the pair is
    // never a stamina *saving* over throwing both.
    stamina: 24,
    windupMs: 197,
    durationMs: 1050,
    // Shortest recovery of any combo, and the only reason this move is worth
    // having over its two halves.
    recoveryMs: 300,
    critBonus: 0.05,
    closesM: 0,
  },
  dash_punch: {
    kind: "melee",
    // The lightest of the four dash combos — `dash_bite` at 1.46 is the one
    // to beat and this does not, because a fist is not a jaw. What it gets
    // instead is 46 ms less telegraph and the best crit roll of the set.
    power: 1.38,
    reachM: 0.4,
    stamina: 28,
    windupMs: 423,
    durationMs: 1350,
    recoveryMs: 380,
    critBonus: 0.06,
    // The dash is the dash: same ground as the rest of the family.
    closesM: 0.5,
  },
  pounce_bite: {
    kind: "melee",
    // `dash_bite` with the pounce in front instead of the dash. It arrives
    // 112 ms sooner and closes slightly less ground, and pays for the sooner
    // with a shade less power.
    power: 1.4,
    // The bite finishes, and a bite has to be right on top of you.
    reachM: 0.36,
    stamina: 29,
    windupMs: 357,
    durationMs: 1300,
    recoveryMs: 400,
    critBonus: 0.05,
    // A touch more than the bare pounce's 0.4 — the bite leans in.
    closesM: 0.44,
  },

  // --- fallback ------------------------------------------------------------
  /**
   * What a body with no form at all swings with, and what an unknown move
   * name resolves to.
   *
   * Tuned to be the worst sustained option in the game on purpose. On the old
   * numbers (power 1.0, 200 ms recovery) it was the *best* — a short cadence
   * on a full-strength hit gave it the highest sustained output of any move,
   * which meant the degenerate case outperformed every move a creature had
   * actually earned. Nothing should be gained by having no body, so the lurch
   * is now slow and weak and strictly worse than `bite`, the one attack every
   * form gets for free.
   *
   * `windupMs` and `durationMs` are the real animation and are not tunable;
   * power and recovery are.
   */
  attack_lurch: {
    // Priced against the honest cadence. At 0.7 this out-throughputs six real
    // moves once the cooldown stopped flattening every move to 1.5s, which
    // made the degenerate case the best case.
    kind: "melee",
    power: 0.6,
    reachM: 0.4,
    stamina: 15,
    windupMs: 238,
    durationMs: 500,
    recoveryMs: 380,
    critBonus: 0,
    closesM: 0,
  },
};

export const FALLBACK_ATTACK = "attack_lurch";

/** The profile for a move, or the fallback if the client named something odd. */
export function attackProfile(move: string): AttackProfile {
  return ATTACK_PROFILE[move] ?? ATTACK_PROFILE[FALLBACK_ATTACK]!;
}

/* ----------------------------------------------------------- defence profile */

export type DefenceProfile = {
  /** Stamina it costs to put up, win or lose. */
  stamina: number;
  /**
   * Damage multiplier when the read was *early* — guard up in time, but not
   * on the frame. The safe, unspectacular outcome.
   */
  early: number;
  /** Damage multiplier on a clean parry. */
  parry: number;
  /** Damage multiplier when the answer arrived a touch after contact. */
  late: number;
  /**
   * What this defence is answering. A move of the wrong kind slips straight
   * past it: `"melee"` cannot turn a shockwave, `"area"` braces for one and is
   * out of position for a claw, `"any"` works on both and pays for the
   * privilege elsewhere.
   */
  answers: MoveKind | "any";
  /**
   * Damage dealt straight back on a clean parry, as a share of what the blow
   * would have done. The punish, without needing a second button press.
   */
  riposte: number;
  /** True if a parry with this move staggers the attacker out of its recovery. */
  staggers: boolean;
};

/**
 * The six defences, differentiated at last.
 *
 * `dodge` is the highest ceiling and the lowest floor: it beats a melee strike
 * outright and does nothing whatsoever about an area burst, because stepping
 * aside is not an answer to the floor moving. `shell_guard` is the opposite —
 * it covers everything, cheaply, and never turns anything around.
 */
export const DEFENCE_PROFILE: Record<string, DefenceProfile> = {
  shell_guard: {
    stamina: 10,
    early: 0.6,
    parry: 0.34,
    late: 0.82,
    answers: "any",
    riposte: 0,
    staggers: false,
  },
  wing_shield: {
    stamina: 14,
    early: 0.5,
    parry: 0.26,
    late: 0.78,
    answers: "area",
    riposte: 0,
    staggers: false,
  },
  dodge: {
    stamina: 12,
    early: 0.7,
    // Nothing at all. A read dodge is the cleanest outcome in the game.
    parry: 0,
    late: 0.95,
    answers: "melee",
    riposte: 0,
    staggers: true,
  },
  parry: {
    stamina: 16,
    early: 0.66,
    parry: 0.12,
    late: 0.86,
    answers: "melee",
    riposte: 0.45,
    staggers: true,
  },
  absorb: {
    stamina: 18,
    early: 0.44,
    parry: 0.2,
    late: 0.7,
    answers: "area",
    riposte: 0.3,
    staggers: false,
  },
  counter_stance: {
    stamina: 20,
    early: 0.74,
    parry: 0.18,
    late: 0.9,
    answers: "melee",
    riposte: 0.6,
    staggers: true,
  },
};

export function defenceProfile(move: string): DefenceProfile | null {
  return DEFENCE_PROFILE[move] ?? null;
}

/* ------------------------------------------------------------------ grading */

/**
 * The windows, in milliseconds either side of contact.
 *
 * Negative is early — the guard went up before the blow landed, which is what
 * reading a telegraph looks like. The parry window straddles contact slightly
 * late of centre because that is where it feels right to a player: you press
 * *as* it hits, not before.
 */
export const GUARD_WINDOW = {
  /** Earliest a guard still counts as up. Before this it has dropped again. */
  earlyMs: -520,
  /** Early becomes a clean parry here. */
  parryFromMs: -140,
  /** The parry window closes. */
  parryToMs: 40,
  /** After this the answer simply did not arrive. */
  lateToMs: 180,
} as const;

export type GuardGrade = "parry" | "early" | "late" | "clean" | "wrong";

export type GuardVerdict = {
  grade: GuardGrade;
  /** What the incoming damage gets multiplied by. */
  multiplier: number;
  /** Share of the blow handed back to the attacker. */
  riposte: number;
  /** Whether the attacker is knocked out of its recovery. */
  stagger: boolean;
  /** Milliseconds the answer landed from contact. Negative is early. */
  offsetMs: number | null;
};

const CLEAN: GuardVerdict = {
  grade: "clean",
  multiplier: 1,
  riposte: 0,
  stagger: false,
  offsetMs: null,
};

/**
 * Grade a defence against the blow it was answering.
 *
 * Both timestamps are the server's own: `strikeAt` is stamped when the attack
 * commits, `guardAt` when the defender's request arrives. Nothing here trusts
 * a clock it did not read, which is the whole reason the telegraph is
 * broadcast rather than the press being self-reported.
 *
 * Two ways to get nothing: answer too late, or answer the wrong kind of blow.
 * A dodge against a ground slam is graded `wrong` however perfectly it was
 * timed — the timing was never the problem.
 */
export function gradeGuard(input: {
  attackMove: string;
  defenceMove: string | null;
  /** ms since epoch the blow lands. */
  strikeAt: number;
  /** ms since epoch the defence was registered, or null if none was. */
  guardAt: number | null;
}): GuardVerdict {
  if (!input.defenceMove || input.guardAt == null) return CLEAN;
  const defence = defenceProfile(input.defenceMove);
  if (!defence) return CLEAN;

  const attack = attackProfile(input.attackMove);
  const offsetMs = input.guardAt - input.strikeAt;

  if (offsetMs < GUARD_WINDOW.earlyMs || offsetMs > GUARD_WINDOW.lateToMs) {
    return { ...CLEAN, offsetMs };
  }

  // Right timing, wrong answer. The guard was up; it was up against the other
  // kind of attack, so the blow goes straight through it.
  if (defence.answers !== "any" && defence.answers !== attack.kind) {
    return { grade: "wrong", multiplier: 0.94, riposte: 0, stagger: false, offsetMs };
  }

  if (offsetMs >= GUARD_WINDOW.parryFromMs && offsetMs <= GUARD_WINDOW.parryToMs) {
    return {
      grade: "parry",
      multiplier: defence.parry,
      riposte: defence.riposte,
      stagger: defence.staggers,
      offsetMs,
    };
  }
  if (offsetMs < GUARD_WINDOW.parryFromMs) {
    return { grade: "early", multiplier: defence.early, riposte: 0, stagger: false, offsetMs };
  }
  return { grade: "late", multiplier: defence.late, riposte: 0, stagger: false, offsetMs };
}

/**
 * What a successful parry costs the attacker, on top of the recovery they had
 * already committed to.
 *
 * This is the punish, and it is the reason a heavy move is a risk rather than
 * a default: read a ground slam and its 400 ms of recovery becomes 1.2 s of
 * standing there while the fight happens to you.
 */
export const STAGGER_MS = 800;

/**
 * A guard that turned the fight around does not play as a guard.
 *
 * `dodge_counter` and `absorb_burst` were built as defensive combos and then
 * never came out of anything defensive — the old engine rolled them at random
 * on the receiving side. They are exactly this: the animation of a dodge or an
 * absorb that earned a hit back. A body without the combo unlocked plays the
 * plain defence, and gets the damage either way.
 */
export const RIPOSTE_ANIMATION: Record<string, string> = {
  dodge: "dodge_counter",
  absorb: "absorb_burst",
};

/** Feed wording for a grade. The player should never have to guess why. */
export const GRADE_LABEL: Record<GuardGrade, string> = {
  parry: "Parried",
  early: "Blocked",
  late: "Clipped",
  clean: "Clean hit",
  wrong: "Guard beaten",
};

/* ------------------------------------------------------------------ stamina */

/**
 * Stamina, and why it exists.
 *
 * One 1.5 s cooldown on every move made all nineteen interchangeable: there
 * was no reason not to throw the heaviest thing available every time it came
 * up. A shared pool priced per move means a slam is a choice paid for out of
 * the same budget as the three pokes you did not throw.
 *
 * `speed` buys regen, which is how the stat line keeps mattering: a fast build
 * genuinely gets more moves per exchange, and that is a booster's doing.
 */
/**
 * Floor on the gap between two attacks — not the limiter.
 *
 * What actually gates the next swing is the move's own duration plus its own
 * recovery, which is what the engine enforces off `recoverUntil` and what a
 * parry extends. This used to be a flat 1.5s on top of that, and because 1.5s
 * of regen covers the cost of any single move, it quietly made the stamina
 * pool unreachable: every move came back at the same cadence with the pool
 * already refilled, so a slam cost nothing in practice. It stays only as a
 * floor for a move with no profile of its own.
 */
export const ATTACK_COOLDOWN_MS = 600;

export const STAMINA_MAX = 100;
/** Points a second at zero speed. */
export const STAMINA_REGEN_BASE = 7;
/** Extra points a second per point of the speed stat. */
export const STAMINA_REGEN_PER_SPEED = 0.14;
/**
 * The ceiling on regen, and the reason the pool means anything.
 *
 * A move can only be rationed if the pool cannot refill the move's own cost
 * inside the move's own cadence. The slowest commitments here come back up
 * every 2.1–2.4s and cost 30–40, which puts the break-even rate near 15 points
 * a second — so regen has to stay under that at *any* speed stat, boosters
 * included, and far enough under it that the drain shows inside one fight
 * rather than after forty seconds of perfect spam. Speed still buys real throughput below the cap; what it cannot buy
 * is a build that throws slams forever.
 */
export const STAMINA_REGEN_CAP = 12;
/**
 * A move may be thrown with less stamina than it costs, down to this share of
 * it — and comes out proportionally weaker. Being empty should mean throwing
 * something desperate, not being locked out of the fight with a full health bar.
 */
export const STAMINA_MIN_SHARE = 0.4;

export function regenPerSecond(speed: number): number {
  return Math.min(
    STAMINA_REGEN_CAP,
    STAMINA_REGEN_BASE + Math.max(0, speed) * STAMINA_REGEN_PER_SPEED,
  );
}

/** Stamina now, from what it was and how long ago that was. */
export function staminaNow(input: {
  stamina: number;
  since: number;
  now: number;
  speed: number;
}): number {
  const seconds = Math.max(0, input.now - input.since) / 1000;
  return Math.min(STAMINA_MAX, input.stamina + regenPerSecond(input.speed) * seconds);
}

/**
 * Can this move be thrown, and how hard does it come out?
 *
 * Above its cost: full power. Between the floor and the cost: it comes out, at
 * the share of the cost that was actually paid. Below the floor: nothing.
 */
export function staminaCheck(input: {
  stamina: number;
  cost: number;
}): { allowed: boolean; scale: number; spend: number } {
  if (input.stamina >= input.cost) {
    return { allowed: true, scale: 1, spend: input.cost };
  }
  const floor = input.cost * STAMINA_MIN_SHARE;
  if (input.stamina < floor) return { allowed: false, scale: 0, spend: 0 };
  return {
    allowed: true,
    // A move thrown on fumes lands between half and full: the exhausted swing
    // is weak, not free.
    scale: 0.5 + 0.5 * (input.stamina / input.cost),
    spend: input.stamina,
  };
}

/* ------------------------------------------------------------------- spacing */

/**
 * Reach, and whose metres these are.
 *
 * `ATTACK_RANGE_M = 30` in the engine is GPS: it answers "are these two
 * players in the same place at all". Every `reachM` here is AR-room metres,
 * where a sparring pair is seated 1.05 m apart and spends 0.55 m of that on
 * the close guard — so 0.5 m of daylight, and a bite's 0.3 m genuinely cannot
 * cross it.
 *
 * The server cannot see that space. So the gap is measured by the clients and
 * **both** of them report it, and the server takes the larger of the two. An
 * attacker who under-reports to force a hit is overruled by the target's own
 * measurement; over-reporting only ever costs the liar a hit. It is a soft
 * check, and the incentive points the safe way.
 */
export const REACH_NOTE = "AR-room metres past the close guard; see gapForCheck";
/** Forgiveness on the edge of range, matching the stage's own slack. */
export const REACH_SLACK_M = 0.12;
/** The close guard two bodies keep. Subtracted before a reach is compared. */
export const CLOSE_GUARD_M = 0.55;

/** The gap a reach check should use, given what each side measured. */
export function gapForCheck(attackerGapM: number | null, defenderGapM: number | null): number | null {
  const values = [attackerGapM, defenderGapM].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );
  if (values.length === 0) return null;
  return Math.max(...values);
}

/**
 * Did it connect?
 *
 * `null` gap means nobody measured — a headless client, a spectator, a match
 * played without the AR stage up — and an unmeasured fight is not one anybody
 * should lose a hit to, so it connects.
 */
export function inReach(input: {
  move: string;
  gapM: number | null;
  /** Extra metres on top of what the move closes on its own. */
  closesM?: number;
}): boolean {
  if (input.gapM == null) return true;
  const profile = attackProfile(input.move);
  const reach = profile.reachM + profile.closesM + (input.closesM ?? 0);
  return input.gapM - CLOSE_GUARD_M <= reach + REACH_SLACK_M;
}

/* ------------------------------------------------------------------ cornered */

/**
 * Backed against something real.
 *
 * The one thing the room gets to decide. Knockback is how a struck body sheds
 * part of a blow — it gives ground instead of taking all of it — so a body
 * with nothing behind it eats the difference. The client already knows how
 * much space it has, from hit-test and its own roam clamp; it reports that,
 * and this decides what it costs.
 *
 * Deliberately one mechanic. Ten AR gimmicks would each be shallower than
 * this one is.
 */
export const CORNERED_SPACE_M = 0.35;
export const CORNERED_DAMAGE = 1.22;

export function corneredMultiplier(spaceBehindM: number | null): number {
  if (spaceBehindM == null) return 1;
  return spaceBehindM <= CORNERED_SPACE_M ? CORNERED_DAMAGE : 1;
}

/* -------------------------------------------------------------------- timing */

/** Every move's telegraph, for a client that wants to show the window. */
export function windupMs(move: string): number {
  return attackProfile(move).windupMs;
}

/**
 * How long the server holds a request open waiting for the blow to land.
 *
 * The telegraph has to be real — the defender cannot read a window that has
 * already closed by the time they see it — so resolution is deferred to the
 * strike frame inside the attack request itself.
 *
 * The cap sits above the slowest windup in the table (`dodge_counter`, 1.09 s)
 * on purpose. A cap that bit would settle damage before the animation showed
 * contact, and the feed would be calling hits the fight had not thrown yet;
 * better to hold the attacker's request for the length of their own windup,
 * which is time they spend watching their own animation anyway. It is a
 * ceiling against a bad table, not a budget.
 */
export const MAX_DEFER_MS = 1_250;

export function deferMs(move: string): number {
  return Math.min(MAX_DEFER_MS, attackProfile(move).windupMs);
}
