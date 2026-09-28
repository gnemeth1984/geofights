import * as THREE from "three";
import { createSpeechBubble } from "./speech";
import { blockPlanFor, buildBlock, type BlockContext } from "./mesh-blocks";
import { applySkin } from "./skin";
import { buildLimb, buildSpine, buildTorso } from "./anatomy";
import { buildWing, wingStyleFor } from "./wings";
import {
  dressHead,
  dressLimb,
  dressSegment,
  dressTorso,
  shellMaterial,
  trimMaterial,
  type Dressing,
} from "./shell";
import {
  formFromModelId,
  type AttackMove,
  type ComboMove,
  type CreatureForm,
  type DefenseMove,
} from "../../api/lib/creature-form";

/**
 * Battle characters: procedural creatures built from primitives, never loaded.
 *
 * A character is not a fixed humanoid. Its body comes from a `CreatureForm` —
 * theme, body shape, silhouette, leg count, wings, horns, spikes, tail, palette,
 * glow and scale — which is either what the player's description parsed into or,
 * for creatures minted before descriptions existed, derived from the stable
 * `modelId` hash. Either way the whole creature is a few dozen primitives laid
 * out by maths, so it appears the frame it is asked for: no GLTF, no textures,
 * nothing to download on a phone in a park on mobile data.
 *
 * Animation follows the same principle. There is no rig and no clip, so every
 * move is a short curve evaluated per frame and written into a fixed set of
 * channels (lean, push, squash, wing flap, tail swing, …) that the body applies
 * however its own shape allows. That is what lets one move list — eight attacks,
 * six defences, five combos and the four core states — play believably on a
 * floating orb, a six-legged insect and a winged serpent alike.
 */

export type CharacterConfig = {
  modelId: string;
  name: string;
  rarity: string;
  /**
   * Equipped booster level, 1–5. Scales how hard the reactions read: a
   * levelled-up character lunges further and celebrates harder. 1 is the
   * baseline the curves below were tuned against.
   */
  level?: number;
  /**
   * The creature's body. Omitted (an avatar with no stored form), a form is
   * derived from `modelId` so the same character always rebuilds identically.
   */
  form?: CreatureForm | null;
};

/** The four core states every creature always has. */
export type CoreState = "idle" | "attack_lurch" | "hit_react" | "celebrate";

/**
 * Everything a character can be told to play. Attacks, defences and combos come
 * from the shared move list, so the server naming a move and the client
 * animating it cannot drift.
 */
export type AnimationState = CoreState | AttackMove | DefenseMove | ComboMove;

/* ------------------------------------------------------------------ curves */

/** Rises to 1 and decays back to 0 — the shape of a lunge or a flinch. */
function impulse(t: number, sharpness = 2.6): number {
  const x = Math.max(0, t) * sharpness;
  return x * Math.exp(1 - x);
}

/** Damped oscillation, for the wobble after an impact and the snap back. */
function spring(t: number, cycles = 3, decay = 7): number {
  return Math.exp(-decay * t) * Math.sin(cycles * Math.PI * 2 * t);
}

/** 0 → 1 → 0 over the life of the move, smoothly. */
function arc(t: number): number {
  return Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
}

/** Ramps in fast and holds, for stances that are struck and then kept. */
function hold(t: number, rise = 0.22, fall = 0.75): number {
  const x = Math.max(0, Math.min(1, t));
  if (rise > 0 && x < rise) return x / rise;
  if (x > fall) return fall < 1 ? Math.max(0, 1 - (x - fall) / (1 - fall)) : 1;
  return 1;
}

/**
 * One sub-beat of a move: 0 → 1 → 0 inside `[from, to]` and nothing outside it,
 * so a move is written as a sequence of overlapping beats — wind-up, strike,
 * follow-through, recovery — instead of one curve doing all four jobs.
 *
 * `bias` shapes where the beat peaks: 1 is symmetric, below 1 snaps up early
 * and eases out long (an impact), above 1 builds slowly and peaks late (a drop
 * accelerating). Every shape starts and ends at exactly 0 *and* at zero speed,
 * which is what keeps the body from snapping as one beat hands over to the next.
 *
 * The obvious spelling of that, `sin(pi * x ** bias)`, is a trap: the value is
 * 0 at both ends, but its slope is `x ** (bias - 1)`, which is *infinite* at
 * the start whenever bias is below 1 — so exactly the impact beats snap the
 * body a visible distance in a single frame. Instead the peak position that
 * bias asks for is solved for directly, and each side of it is a smoothstep,
 * which leaves value and speed at 0 on both edges and at the crest.
 */
function beat(t: number, from: number, to: number, bias = 1): number {
  if (t <= from || t >= to || to <= from) return 0;
  const x = (t - from) / (to - from);
  // Where `sin(pi * x ** bias)` would have crested, so tuned biases still read
  // the same: 1 peaks halfway, 0.3 snaps to a crest a tenth of the way in.
  const peak = Math.min(0.98, Math.max(0.02, Math.pow(0.5, 1 / bias)));
  const half = x < peak ? x / peak : 1 - (x - peak) / (1 - peak);
  return half * half * (3 - 2 * half);
}

/**
 * A beat that is held rather than passed through: ramps in, sits at 1, releases.
 * Used for the parts of a move that are a pose — a tuck, a coil, a dash held at
 * full extension — while the accents around it come from `beat`.
 */
function sustain(t: number, from: number, to: number, rise = 0.25, fall = 0.7): number {
  if (t <= from || t >= to || to <= from) return 0;
  return hold((t - from) / (to - from), rise, fall);
}

/**
 * Height of a body in free flight through `[from, to]`, peaking at 1.
 *
 * A parabola rather than a `beat`, because the difference is the whole point: a
 * beat leaves and arrives at zero *speed*, which is a body being lifted and set
 * down. Under gravity the speed is largest at both ends and zero at the apex,
 * so the take-off snaps, the apex hangs, and the landing accelerates into the
 * floor — without any of it being hand-tuned.
 */
function ballistic(t: number, from: number, to: number): number {
  if (t <= from || t >= to || to <= from) return 0;
  const x = (t - from) / (to - from);
  return 4 * x * (1 - x);
}

/**
 * Vertical speed of that same flight, in [-1, 1]: +1 leaving the ground, 0 at
 * the apex, -1 arriving. The squash and stretch of a jump is read off this
 * rather than written per move, which is why every jump in the table stretches
 * on the way up and compresses on the way down by the same rule.
 */
function ballisticVelocity(t: number, from: number, to: number): number {
  if (t <= from || t >= to || to <= from) return 0;
  const x = (t - from) / (to - from);
  return 1 - 2 * x;
}

/**
 * A whole jump, written into the channels at once: the crouch that loads it,
 * the flight, the stretch and squash that come off its own vertical speed, and
 * the landing compression.
 *
 * Moves call this instead of spelling a jump out in `lift` beats, so every
 * airborne move in the table obeys the same gravity and lands with the same
 * weight. `height` is in metres at the apex; `turns` spins the body through
 * that many full flips during the flight.
 *
 * `heft` is how much body there is to put back down, 0 to 1 — see `heftFactor`.
 * A heavy body does not hang: it comes down earlier inside its own flight
 * window and spends what it saved sinking into its legs, so its absorb is
 * longer and deeper while the move is exactly as long as it was. Durations are
 * fixed, so the time has to come out of the flight; there is nowhere else to
 * take it from.
 *
 * Only pass `heft` to the landing that *ends* the movement. A mid-move rebound
 * — celebrate's first bounce — is not an absorb: it converts the landing
 * straight back into the next jump, and stretching it would leave the body
 * still compressing while it is airborne again, and would stack its squash on
 * top of the next jump's crouch until the rig visibly flattens.
 */
function leap(
  c: Channels,
  t: number,
  from: number,
  to: number,
  height: number,
  i: number,
  turns = 0,
  heft = 0,
): void {
  // Touchdown, pulled earlier the heavier the body. At heft 0 this is exactly
  // `to` and every line below is the shipped curve untouched.
  const touch = to - (to - from) * heft * 0.16;
  const load = beat(t, Math.max(0, from - 0.14), from + 0.015, 0.85);
  const air = ballistic(t, from, touch);
  const climb = ballisticVelocity(t, from, touch);
  const airborne = air > 0 ? 1 : 0;
  // Touchdown, then the window it has to come back up in — still clamped to
  // the end of the move. The bias stays put at every heft: bias moves the crest
  // and the release together, so a heavy body cresting later would pay for it
  // with an earlier release, which is backwards.
  const absorb = 1 + heft * 1.7;
  const landing = beat(t, touch - 0.02, Math.min(1, touch + 0.18 * absorb), 0.32);
  c.lift += (air * height - load * 0.03 * height) * i;
  // Loaded legs compress, fast vertical motion stretches (squash is negative
  // when stretched), the apex is neutral, and the floor compresses again —
  // deeper the more there was to stop. The crouch is deliberately not deepened
  // by heft: it overlaps the previous landing on a move that bounces, and the
  // two together flatten the body.
  c.squash +=
    (load * 0.17 - Math.abs(climb) * airborne * 0.14 + landing * (0.3 + heft * 0.12)) * i;
  c.pulse += (-load * 0.02 + landing * -0.04) * i;
  if (turns !== 0) {
    // Smoothed so the rotation accelerates off the ground and is already
    // stopped by the landing, and a whole number of turns so the wrap back to
    // rest is the same pose the body left in.
    // Keyed off `touch`, not `to`, so the flip is finished when the body
    // arrives rather than still turning through a heavy body's earlier landing.
    const x =
      air > 0 ? Math.min(1, Math.max(0, (t - from) / (touch - from))) : t >= touch ? 1 : 0;
    const eased = x * x * (3 - 2 * x);
    c.tumble += eased * Math.PI * 2 * turns * (x >= 1 ? 0 : 1);
  }
  c.dust += load * 0.4 + landing * (1.1 + heft * 0.55);
}

/**
 * Deterministic pseudo-noise in [-1, 1]. Used for the hit jitter: a real
 * random() would shimmer differently every frame at the same t, which reads as
 * video noise rather than a character being rattled.
 */
function jitterNoise(t: number, channel: number): number {
  return Math.sin(t * 137.3 + channel * 41.7) * Math.sin(t * 61.1 + channel * 12.9);
}

/**
 * Level 1 leaves every curve exactly as tuned; level 5 pushes it to 1.4x.
 * Intensity is deliberately sub-linear so a maxed booster is felt, not comical.
 */
function intensityForLevel(level: number | undefined): number {
  const clamped = Math.max(1, Math.min(5, Math.round(level ?? 1)));
  return 1 + (clamped - 1) * 0.1;
}

/* ---------------------------------------------------------------- channels */

/**
 * Every move writes into these and nothing else. The body reads them at the end
 * of the frame and applies each one as far as its own shape allows — a creature
 * with no wings simply ignores `wingFlap`, which is why the same move table is
 * valid for every silhouette the generator can produce.
 */
type Channels = {
  /** Rotate about X; positive tips the body toward the player. */
  lean: number;
  /**
   * Free pitch, in radians, on top of `lean`. Unbounded on purpose: `lean` is a
   * few degrees of weight shift that has to return to rest, while a flip is a
   * whole turn that happens to end where it started. Keeping them apart means a
   * body can lean *while* it is upside down, and means the wrap from 2π back to
   * 0 lands on a channel nothing else reads.
   */
  tumble: number;
  /** Metres along local +Z, which is where the player stands. */
  push: number;
  /** Metres along local X. */
  sway: number;
  lift: number;
  /** Rotate about Y. */
  spin: number;
  /** Rotate about Z, the weight shift. */
  roll: number;
  /** 1 = flattened and splayed, -1 = stretched tall and thin. */
  squash: number;
  /** Uniform scale offset, on top of squash. */
  pulse: number;
  /** Stretch along Z only — a body committing forward into a strike. */
  stretch: number;
  /**
   * Arms swinging at the shoulder. **Positive reaches forward**, along the
   * same +Z the body's `push`, `stretch` and `headPush` all point down and
   * that `legThrust` throws a leg toward — one direction convention for every
   * channel that means "toward the opponent", so a curve can be written
   * without knowing which way a shoulder pivot happens to face.
   *
   * The pivot itself faces the other way: a limb hangs along -Y, so a positive
   * `rotation.x` on it puts the hand behind the body. The render loop negates
   * for that, exactly as it already did for `legThrust`.
   */
  armSwing: number;
  armFlare: number;
  /**
   * How one-sided `armSwing` is, 0–1.
   *
   * At 0 both arms take the swing together, which is every move written before
   * categories existed and is what a two-handed slam or a wing-assisted gust
   * wants. At 1 the lead arm takes the whole swing and the off arm takes the
   * opposite of it, so the shoulders counter-rotate — which is the difference
   * between a creature waving both arms and a fighter throwing a punch.
   *
   * It is a blend rather than a switch so a combo can crossfade from a
   * two-handed move into a one-sided one without the arms snapping across.
   */
  armAlternate: number;
  /**
   * Elbow fold, in radians, on top of the resting flex. Positive chambers the
   * forearm back toward the shoulder, negative straightens it — clamped at the
   * rest flex, so an arm can reach straight but never hyperextend.
   *
   * Nothing before the strike moves drove the elbow at all: it existed only as
   * a static bulge that kept a standing creature from looking like it was
   * balanced on poles. A punch is the first thing that needs it, because an
   * arm that rotates at the shoulder without the elbow opening reads as a
   * slap, however fast it goes.
   */
  armFold: number;
  /**
   * The lead leg driving forward off the hip, 0–1. 1 is a leg reaching level
   * with the body's own forward axis.
   *
   * Only the lead leg follows it; the others brace back against it, because a
   * body that swings every leg forward at once is a body falling over. Which
   * leg leads is decided when the body is built, so a kick always comes off
   * the same side and a combo can chain two of them.
   */
  legThrust: number;
  /**
   * Knee fold on the lead leg, in radians on top of the resting flex — the
   * leg's counterpart to `armFold`. A kick chambers the knee up, then snaps it
   * open through contact; skipping that and rotating the whole leg from the hip
   * reads as a body falling forward rather than a leg being thrown.
   */
  legFold: number;
  /** Head thrust along +Z, for bites and snaps. */
  headPush: number;
  /** Wings beating: 1 is the bottom of a downbeat. */
  wingFlap: number;
  /** Wings folding forward across the body, 0–1. */
  wingWrap: number;
  /** Tail swinging laterally, -1 to 1. */
  tailSwing: number;
  /** Spikes standing out from the back, 0–1. */
  spikeFlare: number;
  /** Emissive parts flaring white-hot, 0–1. */
  glowFlash: number;
  /** Emissive parts dimming toward matte, 0–1. */
  glowDrain: number;
  /** Expanding ground shockwave, 0 (none) → 1 (fully expanded and gone). */
  shock: number;
  /** Ground scuff kicked up at the feet, 0–1+. Intensity, not progress. */
  dust: number;
  /** Expanding energy shell, 0 (none) → 1 (fully expanded and gone). */
  aura: number;
};

function blankChannels(): Channels {
  return {
    lean: 0,
    tumble: 0,
    push: 0,
    sway: 0,
    lift: 0,
    spin: 0,
    roll: 0,
    squash: 0,
    pulse: 0,
    stretch: 0,
    armSwing: 0,
    armFlare: 0,
    armAlternate: 0,
    armFold: 0,
    legThrust: 0,
    legFold: 0,
    headPush: 0,
    wingFlap: 0,
    wingWrap: 0,
    tailSwing: 0,
    spikeFlare: 0,
    glowFlash: 0,
    glowDrain: 0,
    shock: 0,
    dust: 0,
    aura: 0,
  };
}

const CHANNEL_KEYS = Object.keys(blankChannels()) as (keyof Channels)[];

/**
 * A move: given progress 0–1, an intensity and an agility, write the channels
 * it drives.
 *
 * `agility` is how far off the ground the body is willing to go, 0–1, and it is
 * a property of the creature rather than the move — so one curve covers both
 * readings of the same action. A lithe creature dodges by flipping over the
 * attack; a six-legged insect on the same curve scuttles out from under it.
 * Blended, not switched, so nothing pops at a threshold.
 */
type MoveCurve = (t: number, c: Channels, i: number, agility: number) => void;

/**
 * How airborne each body shape is willing to be.
 *
 * Mass and leg count, essentially: a whippet leaves the ground, a slab of a
 * brute shoves off it, and an insect keeps six feet planted because that is
 * what six feet are for. An orb has no legs to push with, so it hovers up
 * rather than jumping and never flips — it has no visible front to flip over.
 */
const SHAPE_AGILITY: Record<CreatureForm["bodyShape"], number> = {
  upright: 0.68,
  bulky: 0.24,
  lithe: 1,
  serpentine: 0.86,
  insectoid: 0.14,
  orb: 0.42,
};

/**
 * Agility for a whole creature: its shape, plus wings to carry it and minus
 * the size it has to carry. Wings are what let a serpent flip instead of
 * merely leaping, which is why a winged serpent tumbles and a ground one does
 * not quite get there.
 */
function agilityForForm(form: CreatureForm): number {
  const base = SHAPE_AGILITY[form.bodyShape] ?? 0.6;
  const winged = form.wings > 0 ? 0.16 : 0;
  const heavy = Math.max(0, form.scale - 1.1) * 0.5;
  return Math.max(0, Math.min(1, base + winged - heavy));
}

/**
 * How much of a flip an agile body is allowed. Ramps in from halfway up the
 * agility range, so the moves read as "this creature is quick" rather than as
 * two different animations either side of a threshold.
 */
function airFactor(agility: number): number {
  return Math.max(0, Math.min(1, (agility - 0.42) / 0.5));
}

/**
 * How much of a landing a body has to absorb: the other end of `airFactor`.
 *
 * Agility already folds in the size a body has to carry, so what is left below
 * mid-range is mass — and mass is what a landing is about. A brute does not
 * land in the same time a whippet does; it arrives, sinks into its legs, and
 * comes back up. Ramped rather than switched, same as everything else here, so
 * nothing pops at a threshold.
 */
function heftFactor(agility: number): number {
  return Math.max(0, Math.min(1, (0.6 - agility) / 0.45));
}

/* ------------------------------------------------------------- core states */

const CORE_CURVES: Record<Exclude<CoreState, "idle">, MoveCurve> = {
  // Forward squash into the lunge, then a damped spring hauls the weight back
  // past centre and settles it.
  attack_lurch: (t, c, i) => {
    const k = impulse(t, 3);
    const back = spring(t, 1.25, 4.5);
    c.lean = (k * 0.3 + back * 0.08) * i;
    c.push = (k * 0.2 + back * 0.05) * i;
    c.squash = -k * 0.1 * i;
    // Same sign as `lean` and `push` above, because they are the same motion:
    // the whole body goes at the opponent and the arms go with it. Negative
    // here threw the arms out the back of every creature that lurched.
    c.armSwing = k * 1.15 * i;
  },
  // Compressed by the impact, then rattles: the jitter is a fast decaying shake
  // on all three offsets, not a clean oscillation.
  hit_react: (t, c, i) => {
    const k = impulse(t, 4);
    const shake = Math.exp(-9 * t) * 0.035 * i;
    c.lean = -k * 0.24 * i + jitterNoise(t, 2) * shake * 1.6;
    c.push = -k * 0.13 * i + jitterNoise(t, 1) * shake;
    c.sway = jitterNoise(t, 0) * shake;
    c.roll = jitterNoise(t, 3) * shake * 1.8;
    c.squash = k * 0.16 * i;
    c.armSwing = k * 0.55 * i;
    c.tailSwing = jitterNoise(t, 4) * 0.5;
  },
  // Two real bounces, the second one taken higher, and a full turn worked into
  // them. An agile body throws that second bounce into a flip and spins less,
  // because it is already turning; a heavy one keeps both feet low and takes
  // the whole turn on the ground.
  celebrate: (t, c, i, a) => {
    const decay = 1 - t;
    const air = airFactor(a);
    const heft = heftFactor(a);
    // The first bounce is a rebound — it goes straight back up at 0.47, so it
    // gets no heft. The second is the landing that ends the move, and that is
    // where a heavy body's long sink belongs.
    leap(c, t, 0.07, 0.42, 0.12 * (1 + air * 0.5), i, 0);
    leap(c, t, 0.47, 0.85, 0.14 * (1 + air * 0.9), i, air >= 0.6 ? 1 : 0, heft);
    c.spin = t * t * (3 - 2 * t) * Math.PI * 2 * (1 - air * 0.7);
    c.pulse += Math.sin(t * Math.PI * 4) * 0.06 * decay * i;
    c.armFlare = 0.9 * Math.min(1, t * 4) * decay;
    c.armSwing = -spring(t, 2, 1.4) * 0.2;
    c.wingFlap = Math.sin(t * Math.PI * 4) * 0.8 * decay;
    c.tailSwing = Math.sin(t * Math.PI * 3) * 0.7 * decay;
    c.glowFlash = arc(t) * 0.4;
    c.dust *= 0.5;
  },
};

/* ----------------------------------------------------------------- attacks */

const ATTACK_CURVES: Record<AttackMove, MoveCurve> = {
  // Wind-up into a side arc, the reach stretching through it, a follow-through
  // that carries past centre, and a damped settle back to guard.
  swipe: (t, c, i) => {
    const load = beat(t, 0, 0.3, 1.6);
    const sweep = beat(t, 0.22, 0.74, 0.45);
    const through = beat(t, 0.62, 0.96, 1.4);
    const settle = t > 0.7 ? spring((t - 0.7) / 0.3, 1.5, 6) : 0;
    c.spin = (-load * 0.24 + sweep * 0.58 + through * 0.12 + settle * 0.06) * i;
    c.sway = (-load * 0.04 + sweep * 0.08) * i;
    c.roll = (load * 0.08 - sweep * 0.2 - through * 0.06) * i;
    c.stretch = sweep * 0.18 * i;
    c.push = (-load * 0.05 + sweep * 0.08) * i;
    c.squash = load * 0.08 - sweep * 0.1;
    // Load chambers the arm back, the sweep throws it, the follow-through
    // carries it past. Read the signs against `push` on the line above: both
    // are "toward the opponent" channels and both have to agree, or the body
    // steps into a swipe the hand is travelling away from.
    c.armSwing = (-load * 0.5 + sweep * 1.6 + through * 0.3) * i;
    c.armFlare = sweep * 0.55 + through * 0.2;
    c.tailSwing = load * 0.4 - sweep * 0.9 - through * 0.3;
    c.spikeFlare = sweep * 0.25;
    c.glowFlash = beat(t, 0.28, 0.52, 0.5) * 0.35;
    c.dust = beat(t, 0.3, 0.82, 0.4) * 0.5;
  },
  // Coil back, lunge the head out, shut the jaw on it, then ride the recoil.
  // The jaw runs off `headPush`, so dropping it at contact is the bite closing.
  bite: (t, c, i) => {
    const coil = beat(t, 0, 0.26, 1.5);
    const lunge = beat(t, 0.18, 0.58, 0.5);
    const shut = beat(t, 0.5, 0.74, 0.4);
    const recoil = beat(t, 0.62, 1, 0.6);
    c.headPush = (lunge * 0.2 - coil * 0.05 - shut * 0.06) * i;
    c.push = (lunge * 0.14 - coil * 0.05 - recoil * 0.06) * i;
    c.lean = (lunge * 0.24 - coil * 0.1 - recoil * 0.12) * i;
    c.stretch = lunge * 0.22 * i - recoil * 0.06;
    c.squash = coil * 0.1 - lunge * 0.09 + recoil * 0.08;
    c.armSwing = (-coil * 0.4 - lunge * 0.5 + recoil * 0.3) * i;
    c.tailSwing = -coil * 0.5 + lunge * 0.6;
    c.spin = spring(t, 1.2, 7) * 0.05;
    c.glowFlash = shut * 0.5;
    c.dust = lunge * 0.3;
  },
  // Load the tail against a body counter-rotation, crack it through, let the
  // segments whip past on their own lag, then unwind.
  tail_whip: (t, c, i) => {
    const load = sustain(t, 0, 0.44, 0.5, 0.75);
    const crack = beat(t, 0.34, 0.76, 0.4);
    const through = beat(t, 0.62, 0.96, 1.2);
    const settle = t > 0.7 ? spring((t - 0.7) / 0.3, 1.6, 5) : 0;
    c.spin = (-load * 0.32 + crack * 0.78 + through * 0.12 + settle * 0.08) * i;
    c.tailSwing = -load * 0.7 + crack * 1.7 + through * 0.5 + settle * 0.35;
    c.roll = (load * 0.06 + crack * 0.16 - through * 0.05) * i;
    c.sway = crack * 0.06 * i;
    c.lean = (-load * 0.1 + crack * 0.05) * i;
    c.squash = load * 0.07 - crack * 0.05;
    c.lift = crack * 0.03 * i;
    c.armSwing = -load * 0.6 + crack * 0.4;
    // The tip drags along the ground through the crack, so the scuff runs long.
    c.dust = crack * 0.8 + through * 0.3;
  },
  // Two beats of air: wings up, one downbeat, a half recovery, then a harder
  // second beat that shoves the body back and flattens it into the downdraft.
  wing_gust: (t, c, i) => {
    const raise = sustain(t, 0, 0.3, 0.7, 0.85);
    const first = beat(t, 0.22, 0.52, 0.45);
    const lift2 = beat(t, 0.44, 0.64, 1);
    const second = beat(t, 0.56, 0.92, 0.4);
    const crouch = beat(t, 0.62, 1, 0.8);
    c.wingFlap = -raise * 0.95 + first * 1.3 - lift2 * 0.7 + second * 1.7;
    c.lift = (first * 0.06 + second * 0.09 - crouch * 0.04) * i;
    c.push = (-first * 0.08 - second * 0.14) * i;
    c.lean = (-first * 0.1 - second * 0.16 + crouch * 0.08) * i;
    c.squash = -second * 0.08 + crouch * 0.14;
    c.armFlare = first * 0.4 + second * 0.7;
    c.tailSwing = Math.sin(t * Math.PI * 2) * 0.35;
    c.spin = spring(t, 1, 6) * 0.04;
    c.glowFlash = second * 0.25;
    c.dust = first * 0.5 + second * 1.1;
  },
  // Spikes pull in flat against the body, then every sharp thing on it stands
  // up at once behind a scale pop and a ring that runs out along the ground.
  spike_burst: (t, c, i) => {
    const tuck = beat(t, 0, 0.3, 1.3);
    const flare = beat(t, 0.24, 0.74, 0.35);
    const stand = sustain(t, 0.3, 0.88, 0.15, 0.6);
    const settle = t > 0.62 ? spring((t - 0.62) / 0.38, 1.4, 5) : 0;
    c.spikeFlare = -tuck * 0.35 + Math.max(flare, stand * 0.8) + settle * 0.1;
    c.pulse = (-tuck * 0.08 + flare * 0.18) * i;
    c.push = (-tuck * 0.05 + flare * 0.1) * i;
    c.squash = tuck * 0.14 - flare * 0.13;
    c.armFlare = flare * 0.75;
    c.wingFlap = -tuck * 0.4 + flare * 0.7;
    c.glowFlash = flare * 0.6;
    c.shock = t > 0.3 ? Math.min(1, (t - 0.3) / 0.7) : 0;
    c.dust = flare * 0.45;
  },
  // Crouch, dash the whole distance in one held push, stop dead on the impact,
  // then unload the recoil. The stop is the beat that reads as contact.
  charge: (t, c, i) => {
    const crouch = beat(t, 0, 0.26, 1.4);
    const dash = sustain(t, 0.18, 0.64, 0.35, 0.7);
    const impact = beat(t, 0.52, 0.8, 0.35);
    const recover = beat(t, 0.68, 1, 1.1);
    c.push = (-crouch * 0.06 + dash * 0.36 + impact * 0.06 - recover * 0.12) * i;
    c.lean = (crouch * 0.12 + dash * 0.3 - impact * 0.05 - recover * 0.22) * i;
    c.stretch = dash * 0.26 * i - impact * 0.12;
    c.squash = crouch * 0.16 - dash * 0.1 + impact * 0.22;
    c.lift = dash * 0.02 * i - impact * 0.02;
    c.roll = spring(t, 2, 5) * 0.06;
    // Beat for beat the same signs as `push`: crouch gathers the arms back,
    // the dash carries them, the dead stop throws them the last of the way
    // forward, and the recovery unloads them to rest. It used to chamber
    // forward and then swing back hardest exactly on contact.
    c.armSwing = -crouch * 0.4 + dash * 0.55 + impact * 0.35 - recover * 0.3;
    c.tailSwing = Math.sin(t * Math.PI * 3) * 0.45;
    c.glowFlash = impact * 0.3;
    c.shock = t > 0.54 ? Math.min(1, (t - 0.54) / 0.46) : 0;
    c.dust = dash * 0.6 + impact * 1.2;
  },
  /**
   * Dash strike: three phases in one curve.
   *
   * Coil and lean, cover the ground, arrive with a claw. What is *not* in here
   * is the ground itself — the body only leans, squashes and swings, and the
   * metres are covered by the stage translating the whole body toward its
   * opponent across the window `DASH_WINDOW` names. A curve has no idea where
   * the other creature is standing and is not the place to find out; keeping
   * the travel out of it is also what keeps the move safe in AR, because the
   * distance is then something that can be capped and clamped.
   *
   * The beats: a short gather, a long held forward lean over the travel, the
   * arm arc landing just after the body stops, a scale-and-glow pulse on
   * contact, and the recoil unloading out of it. The tail swings across the
   * whole thing and flicks on the strike — secondary motion, so the body does
   * not read as one rigid piece sliding.
   */
  dash_strike: (t, c, i, a) => {
    const air = airFactor(a);
    const gather = beat(t, 0, 0.16, 1.5);
    const lunge = sustain(t, 0.05, 0.5, 0.18, 0.42);
    const strike = beat(t, 0.4, 0.74, 0.42);
    const impact = beat(t, 0.5, 0.72, 0.3);
    const recoil = beat(t, 0.72, 1, 1.05);
    c.lean = (gather * 0.16 + lunge * 0.34 - impact * 0.06 - recoil * 0.24) * i;
    // Body-relative shove on top of the real travel: the chest arrives a beat
    // before the feet stop, which is what sells the stop as contact.
    c.push = (-gather * 0.06 + lunge * 0.1 + strike * 0.08 - recoil * 0.14) * i;
    c.squash = gather * 0.18 - lunge * 0.12 + impact * 0.2;
    c.stretch = lunge * 0.24 * i - impact * 0.1;
    // Grounded bodies stay low and drive off the floor; a quick one leaves it
    // and arrives out of the air, landing on the same frame the strike does.
    c.lift = (lunge * 0.018 * i - impact * 0.016) * (1 - air);
    if (air > 0.05) leap(c, t, 0.16, 0.5, 0.05 + 0.13 * air, i, 0, heftFactor(a));
    // The strike beat is the one the whole move is named for, and it is the
    // one that has to go forward: `armFlare` opens the arm on the same beat
    // and `glowFlash` fires on the contact inside it. Signed against `push`
    // above — gather back, lunge and strike out, recoil home.
    c.armSwing = -gather * 0.38 + lunge * 0.3 + strike * 1.15 - recoil * 0.35;
    c.armFlare = strike * 0.8;
    c.spikeFlare = strike * 0.45;
    c.pulse = (impact * 0.14 - recoil * 0.03) * i;
    c.roll = strike * 0.09 - recoil * 0.03;
    c.tailSwing = Math.sin(t * Math.PI * 2) * 0.32 + strike * 0.6;
    c.glowFlash = impact * 0.75;
    c.dust = lunge * 0.55 + impact * 0.7;
    c.shock = t > 0.5 ? Math.min(1, (t - 0.5) / 0.5) * 0.55 : 0;
  },
  // Rear up, hang for an instant, drop accelerating, land flat, and let the
  // tremor rattle out of the body while the wave runs along the floor.
  //
  // A body quick enough to leave the ground does the same thing airborne: it
  // jumps the slam and turns over on the way, and the flip is timed to finish
  // exactly as the floor arrives — so the landing, the shockwave and the dust
  // are still on the frame they always were, whichever way the body got there.
  ground_slam: (t, c, i, a) => {
    const air = airFactor(a);
    const rear = sustain(t, 0, 0.36, 0.6, 0.8) * (1 - air * 0.7);
    const hang = beat(t, 0.26, 0.44, 1);
    const drop = beat(t, 0.36, 0.58, 2.2);
    const land = beat(t, 0.5, 0.8, 0.3);
    const tremor = t > 0.54 ? Math.exp(-7 * (t - 0.54)) : 0;
    c.lift = (rear * 0.2 + hang * 0.05 - drop * 0.06 - land * 0.03) * i;
    c.squash = -rear * 0.16 - hang * 0.04 + land * 0.34 * i;
    c.lean = -rear * 0.14 + drop * 0.22 - land * 0.04;
    c.pulse = -land * 0.06;
    if (air > 0.05)
      leap(c, t, 0.18, 0.54, 0.14 + 0.28 * air, i, air >= 0.6 ? 1 : 0, heftFactor(a));
    // Rearing takes the arms up and over, and the landing drives them down
    // onto the floor — down to rest and a little past it, which is where a
    // slam stops. The old `- land * 1` kept swinging after the floor had
    // already taken the blow and finished with both arms behind the back.
    c.armSwing = rear * 1.2 + hang * 0.2 - land * 0.3;
    c.wingFlap = rear * 0.8 - land * 0.5;
    c.tailSwing = rear * 0.5 - land * 0.8;
    c.spikeFlare = rear * 0.3 + land * 0.6;
    c.sway = jitterNoise(t, 5) * tremor * 0.03;
    c.roll = jitterNoise(t, 6) * tremor * 0.05;
    c.glowFlash = land * 0.4;
    c.shock = t > 0.52 ? Math.min(1, (t - 0.52) / 0.48) : 0;
    c.dust = land * 1.3 + tremor * 0.4;
  },
  // Draw everything lit inside it inward, release it as a shell and a ring,
  // then dim while the aura falls off — the cost of having spent it.
  elemental_burst: (t, c, i) => {
    const charge = sustain(t, 0, 0.44, 0.7, 0.9);
    const blow = beat(t, 0.34, 0.74, 0.3);
    const out = t > 0.36 ? Math.min(1, (t - 0.36) / 0.64) : 0;
    c.glowFlash = Math.max(charge * 0.7, blow * 1.4);
    c.glowDrain = beat(t, 0.62, 1, 0.5) * 0.85;
    c.pulse = (-charge * 0.09 + blow * 0.22) * i;
    c.lift = blow * 0.07 * i;
    c.lean = -charge * 0.14 + blow * 0.1;
    c.squash = charge * 0.1 - blow * 0.12;
    c.armFlare = charge * 0.3 + blow * 0.95;
    c.wingFlap = -charge * 0.5 + blow * 1.3;
    c.spikeFlare = charge * 0.4 + blow * 0.5;
    c.spin = spring(t, 1.5, 4) * 0.06;
    c.shock = out;
    c.aura = out;
    c.dust = blow * 0.6;
  },

  /* ------------------------------------------------- category core strikes */

  /**
   * Punch: chamber to the ribs, drive through, recover to guard.
   *
   * The first move in the table that is one-sided. Everything written before
   * categories existed swung both arms together, which is correct for a slam
   * and wrong for a punch — two fists going out at once is a creature shoving,
   * not a fighter throwing a hand. `armAlternate` is held near 1 for the whole
   * move so the lead shoulder takes the swing and the off shoulder counters
   * it, and `armFold` opens the elbow through contact, because an arm that
   * rotates at the shoulder with a locked elbow reads as a slap however fast
   * it travels.
   */
  punch: (t, c, i) => {
    const chamber = beat(t, 0, 0.3, 1.5);
    const drive = beat(t, 0.24, 0.6, 0.42);
    const impact = beat(t, 0.38, 0.6, 0.34);
    const recover = beat(t, 0.56, 1, 0.95);
    c.armAlternate = Math.min(1, sustain(t, 0, 1, 0.12, 0.84) * 1.3);
    c.armFold = (chamber * 1.05 - drive * 0.95) * i;
    c.armSwing = (-chamber * 0.34 + drive * 1.5 + impact * 0.2 - recover * 0.3) * i;
    c.armFlare = drive * 0.18;
    // The hips turn into it. This is where a punch's weight actually comes
    // from, and leaving it out is what makes an arm-only swing read as limp.
    c.spin = (-chamber * 0.16 + drive * 0.34 - recover * 0.06) * i;
    c.roll = (chamber * 0.05 - drive * 0.12) * i;
    c.push = (-chamber * 0.04 + drive * 0.12 - recover * 0.05) * i;
    c.lean = (chamber * 0.06 + drive * 0.16 - recover * 0.1) * i;
    c.stretch = drive * 0.16 * i - impact * 0.06;
    c.squash = chamber * 0.08 - drive * 0.07;
    // The rear knee straightens as the fist goes out: the drive comes off the
    // floor, not out of the shoulder.
    c.legFold = -drive * 0.18 * i;
    c.tailSwing = chamber * 0.35 - drive * 0.5;
    c.glowFlash = impact * 0.4;
    c.dust = drive * 0.35 + impact * 0.3;
  },
  /**
   * Kick: plant, chamber the knee, snap it open through contact, recover.
   *
   * The order is the whole move. Rotating a straight leg up from the hip is a
   * body falling forward; chambering the knee first and opening it on the way
   * out is a leg being thrown, and that is what `legFold` exists for. Only the
   * lead leg follows `legThrust` — the rest brace back against it, because a
   * body that swings every leg forward at once is a body on the floor.
   */
  kick: (t, c, i) => {
    // The chamber is held, not passed through: a kick that opens the knee the
    // instant it lifts it has no telegraph, and a 0.62-weight blow nobody can
    // read is not a move, it is a tax.
    const plant = beat(t, 0, 0.26, 1.4);
    const chamber = beat(t, 0.1, 0.52, 1.1);
    const snap = beat(t, 0.42, 0.76, 0.38);
    const recover = beat(t, 0.7, 1, 0.9);
    c.legFold = (chamber * 1.15 - snap * 1) * i;
    c.legThrust = (-plant * 0.12 + chamber * 0.45 + snap * 1) * i;
    // Weight rocks back over the standing leg and the torso counters the
    // kicking one, so the balance is readable rather than magical.
    c.lean = (-plant * 0.06 - chamber * 0.12 - snap * 0.18 + recover * 0.08) * i;
    c.roll = (chamber * 0.1 + snap * 0.16) * i;
    c.lift = (-plant * 0.015 + snap * 0.03) * i;
    c.push = (-chamber * 0.04 + snap * 0.1) * i;
    c.spin = (-chamber * 0.1 + snap * 0.2) * i;
    c.squash = plant * 0.12 - snap * 0.08 + recover * 0.06;
    c.stretch = snap * 0.14 * i;
    // Arms go the other way and stay split, which is what a body balancing on
    // one leg does with them.
    c.armAlternate = Math.min(1, sustain(t, 0.08, 1, 0.22, 0.8));
    c.armSwing = (-chamber * 0.5 - snap * 0.35 + recover * 0.2) * i;
    c.armFlare = chamber * 0.4 + snap * 0.55;
    c.tailSwing = chamber * 0.5 - snap * 0.8;
    c.glowFlash = snap * 0.45;
    c.dust = plant * 0.4 + snap * 0.5;
  },
  /**
   * Grapple: reach, seize, heave, put it down hard.
   *
   * Deliberately two-handed — `armAlternate` is left at 0 — because a hold is
   * the one humanoid move where both arms doing the same thing is right. The
   * elbows open to reach and close on the seize, which is the read of grabbing
   * something as opposed to pointing at it.
   */
  grapple: (t, c, i) => {
    const reach = beat(t, 0, 0.34, 0.6);
    const seize = sustain(t, 0.26, 0.58, 0.25, 0.7);
    const heave = beat(t, 0.46, 0.76, 0.5);
    const slam = beat(t, 0.62, 0.9, 0.32);
    const release = beat(t, 0.82, 1, 1.1);
    c.armSwing = (reach * 1.25 - seize * 0.2 + heave * 0.8 - slam * 1.1) * i;
    c.armFold = (-reach * 0.55 + seize * 0.95 + heave * 0.4 - slam * 0.7) * i;
    c.armFlare = reach * 0.45 - seize * 0.3;
    c.push = (reach * 0.14 + seize * 0.05 - heave * 0.08 - release * 0.08) * i;
    c.lean = (reach * 0.2 - heave * 0.24 + slam * 0.3 - release * 0.16) * i;
    c.lift = (heave * 0.07 - slam * 0.04) * i;
    c.spin = (-seize * 0.12 + heave * 0.3 - slam * 0.1) * i;
    c.roll = (heave * 0.14 - slam * 0.12) * i;
    c.squash = -heave * 0.1 + slam * 0.26;
    // Knees bend under the load and again on the drop: a body lifting
    // something takes it in the legs.
    c.legFold = (seize * 0.3 - heave * 0.2 + slam * 0.24) * i;
    c.stretch = reach * 0.18 * i - slam * 0.08;
    c.tailSwing = -reach * 0.4 + heave * 0.9;
    c.spikeFlare = seize * 0.35 + slam * 0.4;
    c.glowFlash = Math.max(seize * 0.3, slam * 0.75);
    c.shock = t > 0.64 ? Math.min(1, (t - 0.64) / 0.36) * 0.7 : 0;
    c.dust = heave * 0.3 + slam * 1.2;
  },
  /**
   * Pounce: gather every leg under the body, throw it forward, arrive clawed.
   *
   * A jump with claws in it, so the arc is `leap`'s and not hand-written — the
   * same gravity as every other airborne move in the table. What is this
   * move's own is the gather: `legFold` pulls all four legs in under the mass
   * before `legThrust` throws them back, which is the coil a cat has and a
   * biped does not.
   */
  pounce: (t, c, i, a) => {
    const air = airFactor(a);
    const coil = sustain(t, 0, 0.32, 0.4, 0.75);
    const launch = beat(t, 0.24, 0.5, 0.45);
    const claws = beat(t, 0.42, 0.72, 0.4);
    const land = beat(t, 0.6, 0.9, 0.32);
    const settle = beat(t, 0.82, 1, 1.1);
    leap(c, t, 0.26, 0.74, 0.14 + 0.2 * air, i, 0, heftFactor(a));
    c.legFold = (coil * 0.85 - launch * 0.55 + land * 0.4 - settle * 0.3) * i;
    c.legThrust = (-coil * 0.3 + launch * 0.9 + claws * 0.3) * i;
    c.lean = (-coil * 0.16 + launch * 0.2 + claws * 0.26 - land * 0.1 - settle * 0.12) * i;
    c.push = (-coil * 0.06 + launch * 0.2 + claws * 0.1 - settle * 0.08) * i;
    c.stretch = (launch * 0.22 + claws * 0.18) * i - land * 0.1;
    c.armSwing = -coil * 0.6 + claws * 1.35 - settle * 0.3;
    c.armFold = coil * 0.5 - claws * 0.6;
    c.armFlare = claws * 0.75;
    c.headPush = claws * 0.1 * i;
    c.spikeFlare = coil * 0.3 + claws * 0.6;
    c.tailSwing = Math.sin(t * Math.PI * 2) * 0.4 + claws * 0.5;
    c.glowFlash = claws * 0.5;
    c.dust = coil * 0.2 + claws * 0.3;
  },
  /**
   * Fire breath: fill the chest, pull the head back over it, let it out.
   *
   * The only attack that is a held stream rather than an accent, so the glow
   * is `sustain`ed across half the timeline instead of flashed on one frame,
   * and it ends on a drain — the breath is spent fuel, and a dragon that
   * breathes without dimming is a dragon with infinite fire.
   */
  fire_breath: (t, c, i) => {
    const inhale = sustain(t, 0, 0.42, 0.6, 0.85);
    const rear = beat(t, 0.1, 0.44, 1.2);
    const release = sustain(t, 0.36, 0.86, 0.14, 0.62);
    const spit = beat(t, 0.38, 0.6, 0.3);
    const cough = beat(t, 0.8, 1, 0.9);
    c.pulse = (inhale * 0.16 - release * 0.12) * i;
    c.headPush = (-rear * 0.09 + release * 0.16 + spit * 0.07) * i;
    c.lean = (-rear * 0.2 + release * 0.22 - cough * 0.1) * i;
    c.push = (-inhale * 0.05 + release * 0.1) * i;
    c.squash = inhale * 0.1 - release * 0.08 + cough * 0.1;
    c.stretch = release * 0.2 * i;
    c.wingFlap = -inhale * 0.6 + release * 1.15;
    c.armFlare = inhale * 0.25 + release * 0.6;
    c.armSwing = -inhale * 0.45 + release * 0.3;
    c.legFold = (inhale * 0.2 + release * 0.12) * i;
    c.tailSwing = -inhale * 0.5 + Math.sin(t * Math.PI * 3) * 0.3;
    c.spikeFlare = inhale * 0.45 + release * 0.7;
    c.glowFlash = Math.max(inhale * 0.55, release * 1.5, spit * 1.6);
    c.glowDrain = cough * 0.8;
    c.aura = t > 0.38 ? Math.min(1, (t - 0.38) / 0.62) : 0;
    c.dust = release * 0.8 + spit * 0.4;
  },
  /**
   * Pincer snap: two clacks, the second one the one that lands.
   *
   * Written on `armFlare` for the spread and `armFold` for the shut rather
   * than on `armSwing`, because an insect's forelimbs are short and a scissor
   * that is spelled as a swing disappears on a stubby limb. Two beats instead
   * of one: a single snap reads as a poke, and the doubling is what makes it
   * read as chitin.
   */
  pincer_snap: (t, c, i) => {
    const open = beat(t, 0, 0.26, 1.2);
    const snap1 = beat(t, 0.16, 0.44, 0.32);
    const reopen = beat(t, 0.38, 0.58, 1);
    const snap2 = beat(t, 0.5, 0.82, 0.3);
    const drop = beat(t, 0.76, 1, 1);
    c.armFlare = open * 0.7 - snap1 * 0.6 + reopen * 0.45 - snap2 * 0.5;
    c.armFold = (-open * 0.45 + snap1 * 1.1 - reopen * 0.3 + snap2 * 1.2) * i;
    c.armSwing = (open * 0.3 + snap1 * 0.55 + snap2 * 0.7 - drop * 0.35) * i;
    c.headPush = (snap1 * 0.06 + snap2 * 0.1) * i;
    c.push = (-open * 0.03 + snap1 * 0.06 + snap2 * 0.11) * i;
    c.lean = (open * 0.05 + snap2 * 0.14 - drop * 0.1) * i;
    c.stretch = snap2 * 0.12 * i;
    c.squash = open * 0.06 - snap2 * 0.06;
    c.spin = (snap1 * 0.1 - snap2 * 0.14) * i;
    c.legFold = (open * 0.14 - snap2 * 0.1) * i;
    c.spikeFlare = snap1 * 0.3 + snap2 * 0.5;
    c.tailSwing = snap1 * 0.4 - snap2 * 0.6;
    c.glowFlash = Math.max(snap1 * 0.3, snap2 * 0.55);
    c.dust = snap2 * 0.45;
  },
  /**
   * Dive bomb: beat up, climb, tip over, fall, arrive talons first.
   *
   * The climb is wing-driven and the drop is not — that is the difference
   * between this and a jumping slam. `leap` owns the arc so the fall
   * accelerates under the same gravity as everything else, and the talons come
   * forward at the bottom on `legThrust` with the knees opening out of the
   * tuck they held through the dive.
   */
  dive_bomb: (t, c, i, a) => {
    const air = airFactor(a);
    const upbeat = beat(t, 0, 0.3, 0.8);
    const climb = sustain(t, 0.06, 0.4, 0.3, 0.7);
    const tip = beat(t, 0.3, 0.54, 1);
    const drop = beat(t, 0.42, 0.72, 2);
    const talons = beat(t, 0.56, 0.8, 0.3);
    const pullOut = beat(t, 0.74, 1, 0.8);
    leap(c, t, 0.08, 0.78, 0.18 + 0.28 * air, i, 0, heftFactor(a));
    c.wingFlap = upbeat * 1.6 - climb * 0.35 - drop * 0.8 + pullOut * 1.4;
    c.lean = (-climb * 0.18 + tip * 0.3 + drop * 0.5 - talons * 0.1 - pullOut * 0.35) * i;
    c.push = (-climb * 0.04 + drop * 0.18 + talons * 0.08 - pullOut * 0.1) * i;
    c.stretch = (drop * 0.24 + talons * 0.1) * i - pullOut * 0.06;
    c.legThrust = (-climb * 0.35 + talons * 1.05) * i;
    c.legFold = (climb * 0.75 + drop * 0.5 - talons * 0.8) * i;
    c.armSwing = -climb * 0.5 + talons * 0.9 - pullOut * 0.3;
    c.armFlare = climb * 0.3 + talons * 0.6;
    c.headPush = (drop * 0.08 + talons * 0.06) * i;
    c.spikeFlare = drop * 0.3 + talons * 0.7;
    c.tailSwing = Math.sin(t * Math.PI * 2) * 0.3 - tip * 0.5;
    c.glowFlash = talons * 0.6;
    c.shock = t > 0.6 ? Math.min(1, (t - 0.6) / 0.4) * 0.6 : 0;
    c.dust = drop * 0.3 + talons * 0.9;
  },
  /**
   * Piston slam: load, fire, absorb the recoil, vent.
   *
   * A machine does not wind up, it loads — so the retract is `sustain`ed flat
   * at full compression instead of eased through, and the release is close to
   * a step. What follows contact is the chassis absorbing its own blow: a
   * tight, fast rattle rather than the loose swing a body with give in it
   * would settle with. Grounded on purpose; a construct shoves off the floor,
   * it does not leave it.
   */
  piston_slam: (t, c, i) => {
    const retract = sustain(t, 0, 0.56, 0.16, 0.9);
    const fire = beat(t, 0.52, 0.76, 0.22);
    const impact = beat(t, 0.56, 0.8, 0.26);
    const recoil = beat(t, 0.72, 0.92, 0.5);
    const vent = beat(t, 0.86, 1, 1.2);
    const ring = t > 0.62 ? Math.exp(-13 * (t - 0.62)) : 0;
    c.armFold = (retract * 1.3 - fire * 1.25) * i;
    c.armSwing = (-retract * 0.25 + fire * 1.45 + impact * 0.25 - recoil * 0.5) * i;
    c.push = (-retract * 0.05 + fire * 0.16 - recoil * 0.07) * i;
    c.lean = (retract * 0.08 + fire * 0.14 - recoil * 0.12 - vent * 0.04) * i;
    c.stretch = fire * 0.2 * i - impact * 0.1;
    c.squash = retract * 0.14 - fire * 0.06 + impact * 0.3;
    c.pulse = -impact * 0.05 + vent * 0.04;
    c.sway = jitterNoise(t, 7) * ring * 0.02;
    c.roll = jitterNoise(t, 8) * ring * 0.03;
    c.legFold = (retract * 0.35 - fire * 0.15 + impact * 0.3) * i;
    c.spikeFlare = retract * 0.2 + impact * 0.55;
    c.glowFlash = Math.max(retract * 0.25, impact * 0.9);
    c.glowDrain = vent * 0.45;
    c.shock = t > 0.58 ? Math.min(1, (t - 0.58) / 0.42) : 0;
    c.dust = fire * 0.4 + impact * 1.35;
  },
};
/* ---------------------------------------------------------------- defences */

const DEFENSE_CURVES: Record<DefenseMove, MoveCurve> = {
  // Tuck every limb inside its own volume, brace against the hit, shudder it
  // off, then unfold. The shudder is what makes the guard read as *used*.
  shell_guard: (t, c, i) => {
    const tuck = sustain(t, 0, 0.92, 0.2, 0.62);
    const brace = beat(t, 0.28, 0.62, 0.7);
    const shrug = t > 0.42 && t < 0.74 ? Math.exp(-11 * (t - 0.42)) : 0;
    const unfold = beat(t, 0.72, 1, 1.2);
    c.pulse = (-tuck * 0.15 - brace * 0.04 + unfold * 0.05) * i;
    c.squash = (tuck * 0.22 + brace * 0.06) * i;
    c.lean = tuck * 0.1 + brace * 0.05 - unfold * 0.06;
    c.push = -brace * 0.05 * i;
    // A tuck is elbows, not shoulders. The arms come a little across the front
    // and then fold tight over the body, which is what the wings are doing on
    // the line below. Swinging the shoulders back instead — which is what
    // `-tuck * 1.45` did — opened the guard it was supposed to be closing and
    // left both arms trailing behind a creature hiding inside its own shell.
    c.armSwing = tuck * 0.55;
    c.armFold = tuck * 1.35 + brace * 0.2;
    c.wingWrap = tuck * 0.65;
    c.spikeFlare = tuck * 0.8 + brace * 0.3;
    c.glowDrain = tuck * 0.7;
    c.glowFlash = brace * 0.2;
    c.sway = jitterNoise(t, 1) * shrug * 0.022;
    c.roll = jitterNoise(t, 2) * shrug * 0.04;
  },
  // Wings come forward and close over the body, flex under what lands on them,
  // then throw open again on the release.
  wing_shield: (t, c, i) => {
    const wrap = sustain(t, 0, 0.9, 0.18, 0.6);
    const flex = beat(t, 0.32, 0.64, 0.35);
    const unfurl = beat(t, 0.68, 1, 1.3);
    c.wingWrap = Math.max(0, wrap - unfurl * 0.35);
    c.wingFlap = -wrap * 0.4 + flex * 0.3 + unfurl * 1.1;
    c.pulse = (-wrap * 0.05 - flex * 0.04 + unfurl * 0.04) * i;
    c.lean = wrap * 0.12 - flex * 0.08;
    c.push = (-wrap * 0.05 - flex * 0.07) * i;
    c.sway = -flex * 0.04 * i;
    c.squash = flex * 0.08;
    // The wings are closing over the body, so the arms tuck in under them
    // rather than swinging out behind where the wings no longer cover.
    c.armSwing = wrap * 0.4;
    c.armFold = wrap * 1.1;
    c.glowDrain = wrap * 0.35 + flex * 0.3;
    c.glowFlash = unfurl * 0.3;
    c.roll = jitterNoise(t, 3) * flex * 0.03;
  },
  // Dip onto the back foot, dart clear, land and check the slide. The roll is
  // a body that leans to change direction instead of sliding flat.
  //
  // The quicker the body, the more of that clearance it buys with height
  // instead of ground: a whippet throws itself backwards over the attack and
  // lands on its feet, an insect keeps its feet down and scuttles out from
  // under it. Same beats either way — the dodge is clear at the same moment.
  dodge: (t, c, i, a) => {
    const air = airFactor(a);
    const dip = beat(t, 0, 0.22, 1.5);
    const dart = beat(t, 0.14, 0.68, 0.35);
    const land = beat(t, 0.56, 1, 0.9);
    // Ground covered trades against height: the flip goes up and back, so it
    // needs less sideways distance to get out of the way.
    c.sway = (dart * 0.34 * (1 - air * 0.45) + land * 0.05) * i;
    // A body mid-flip has nothing to bank against, so the lateral lean that
    // sells a ground dodge gets out of the way of the rotation.
    c.roll = (-dip * 0.06 - dart * 0.34 * (1 - air * 0.8)) * i;
    c.spin = (-dart * 0.2 + land * 0.06) * (1 - air * 0.6);
    c.lift = (-dip * 0.02 + dart * 0.05) * (1 - air);
    c.squash = dip * 0.12 - dart * 0.08 + land * 0.1;
    c.push = -dart * 0.04 * i;
    // The dip sits back onto the rear foot and takes the arms with it, then
    // the dart pulls them in tight instead of throwing them out behind: a body
    // getting out of the way makes itself small, and the fold is what does
    // that. A flip needs them tighter still, so `air` deepens the fold rather
    // than the swing.
    c.armSwing = -dip * 0.3 + dart * 0.25;
    c.armFold = dart * (0.85 + air * 0.5);
    c.tailSwing = dart * 1.2 + land * 0.4;
    c.dust = dart * 0.5 + land * 0.5;
    if (air > 0.05)
      leap(c, t, 0.16, 0.72, 0.1 + 0.24 * air, i, air >= 0.6 ? -1 : 0, heftFactor(a));
  },
  // Set the guard, sweep the incoming hit off-line, catch it, and lean into
  // the space that opens up behind it.
  parry: (t, c, i) => {
    const set = beat(t, 0, 0.2, 1.4);
    const deflect = beat(t, 0.14, 0.54, 0.35);
    const caught = beat(t, 0.4, 0.68, 0.4);
    const counter = beat(t, 0.56, 1, 0.9);
    c.push = (deflect * 0.13 - caught * 0.05 - counter * 0.1) * i;
    c.lean = (set * 0.06 + deflect * 0.15 - counter * 0.2) * i;
    c.spin = -set * 0.1 + deflect * 0.26 - counter * 0.08;
    c.roll = -deflect * 0.12 + counter * 0.1;
    c.sway = deflect * 0.05 * i;
    c.squash = counter * 0.12 * i;
    // Setting the guard draws the arm back, the deflect sweeps it out across
    // the incoming hit, and the counter unloads it — the same signs `push`
    // carries three lines up. Reversed, the arm swept its hardest *behind* the
    // body, which parries nothing.
    c.armSwing = -set * 0.5 + deflect * 1.7 - counter * 0.6;
    c.armFlare = deflect * 0.5 + caught * 0.3;
    c.tailSwing = -deflect * 0.5 + counter * 0.4;
    c.spikeFlare = caught * 0.4;
    c.glowFlash = caught * 0.55;
  },
  // Draw the damage in as the glow drains, hold it, then hand it back as a
  // flash and an expanding shell: the one defence that ends as an attack.
  absorb: (t, c, i) => {
    const draw = sustain(t, 0, 0.58, 0.5, 0.75);
    const held = beat(t, 0.4, 0.64, 1);
    const give = beat(t, 0.54, 0.92, 0.3);
    const out = t > 0.56 ? Math.min(1, (t - 0.56) / 0.44) : 0;
    c.glowDrain = draw * 0.95;
    c.glowFlash = give * 1.1;
    c.pulse = (-draw * 0.07 - held * 0.03 + give * 0.15) * i;
    c.squash = draw * 0.12 - give * 0.08;
    c.lean = draw * 0.09 - give * 0.07;
    c.lift = give * 0.04 * i;
    c.wingWrap = Math.max(0, draw * 0.45 - give * 0.2);
    c.spikeFlare = -draw * 0.2 + give * 0.6;
    // Drawing it in is a gather in front of the chest — forward at the
    // shoulder, folded hard at the elbow — and giving it back throws that same
    // fold open. The one defence that ends as an attack should end with the
    // arms out in front, not behind.
    c.armSwing = draw * 0.3 + give * 0.7;
    c.armFold = draw * 1.15 - give * 0.9;
    c.aura = out;
    c.dust = give * 0.5;
  },
  // Coil back onto the rear foot, hold the read, then snap forward off it.
  // A stance, not a flinch — and the snap is the counter it was waiting for.
  counter_stance: (t, c, i, a) => {
    const air = airFactor(a);
    const coil = sustain(t, 0, 0.64, 0.25, 0.7);
    const snapBack = beat(t, 0.6, 0.88, 0.35);
    const settle = beat(t, 0.8, 1, 1.2);
    c.lean = (-coil * 0.22 + snapBack * 0.26 - settle * 0.08) * i;
    c.push = (-coil * 0.08 + snapBack * 0.14) * i;
    c.roll = coil * 0.1 - snapBack * 0.08;
    c.squash = coil * 0.08 - snapBack * 0.06;
    c.stretch = snapBack * 0.12 * i;
    c.headPush = coil * 0.03 + snapBack * 0.08;
    // Coil chambers back onto the rear foot with the lean, and `snapBack` is
    // the counter itself, so it goes out — the arm cannot be the one thing on
    // the body still travelling backwards on the beat the stance was waiting
    // for. The elbow carries it the rest of the way, exactly as a punch does.
    c.armSwing = -coil * 0.8 + snapBack * 1.3;
    c.armFold = coil * 0.85 - snapBack * 0.8;
    c.armFlare = coil * 0.3 + snapBack * 0.5;
    c.tailSwing = -coil * 0.55 + Math.sin(t * Math.PI * 3) * 0.14 + snapBack * 0.7;
    c.spikeFlare = coil * 0.5 + snapBack * 0.5;
    c.glowFlash = snapBack * 0.45;
    c.dust = snapBack * 0.5;
    // A quick body does not just lean into the counter, it pushes off the
    // floor with it. Small on purpose: this is the last beat of a stance, not
    // a jump of its own.
    if (air > 0.05) leap(c, t, 0.62, 0.86, 0.04 + 0.09 * air, i, 0, heftFactor(a));
  },
};
/* ------------------------------------------------------------------ combos */

/**
 * A combo is two moves played back to back inside one uninterruptible window,
 * which is what a levelled booster buys. Each part gets its own slice of the
 * timeline and is evaluated on its own local 0–1, so the component curves are
 * reused exactly as tuned rather than rewritten.
 */
const COMBO_PARTS: Record<ComboMove, ReadonlyArray<{ move: AttackMove | DefenseMove; share: number }>> = {
  swipe_bite: [
    { move: "swipe", share: 0.55 },
    { move: "bite", share: 0.45 },
  ],
  charge_slam: [
    { move: "charge", share: 0.5 },
    { move: "ground_slam", share: 0.5 },
  ],
  gust_spike: [
    { move: "wing_gust", share: 0.5 },
    { move: "spike_burst", share: 0.5 },
  ],
  // The dash always leads: it is what closes the gap, so it owns the larger
  // share and the finisher lands out of its follow-through.
  dash_bite: [
    { move: "dash_strike", share: 0.58 },
    { move: "bite", share: 0.42 },
  ],
  dash_whip: [
    { move: "dash_strike", share: 0.55 },
    { move: "tail_whip", share: 0.45 },
  ],
  dash_slam: [
    { move: "dash_strike", share: 0.52 },
    { move: "ground_slam", share: 0.48 },
  ],
  dodge_counter: [
    { move: "dodge", share: 0.38 },
    { move: "counter_stance", share: 0.62 },
  ],
  absorb_burst: [
    { move: "absorb", share: 0.5 },
    { move: "elemental_burst", share: 0.5 },
  ],
  // One-two. The punch is the shorter half and the kick lands out of its
  // recovery, which is the order a fighter throws them in: the hand sets the
  // distance and the leg is what actually hurts.
  punch_kick: [
    { move: "punch", share: 0.46 },
    { move: "kick", share: 0.54 },
  ],
  // Same rule as every other dash combo: the dash owns the larger share
  // because it is what closes the gap, and the fist arrives out of its
  // follow-through rather than after it.
  dash_punch: [
    { move: "dash_strike", share: 0.6 },
    { move: "punch", share: 0.4 },
  ],
  // Land on it, then bite what you landed on — the pounce's own claws and the
  // bite are two separate contacts, which is what makes this worth a combo
  // slot rather than a longer pounce.
  pounce_bite: [
    { move: "pounce", share: 0.58 },
    { move: "bite", share: 0.42 },
  ],
};

const ATTACK_KEYS = Object.keys(ATTACK_CURVES) as AttackMove[];
const DEFENSE_KEYS = Object.keys(DEFENSE_CURVES) as DefenseMove[];
const COMBO_KEYS = Object.keys(COMBO_PARTS) as ComboMove[];

function curveForMove(move: AttackMove | DefenseMove): MoveCurve {
  return (
    (ATTACK_CURVES as Record<string, MoveCurve>)[move] ??
    (DEFENSE_CURVES as Record<string, MoveCurve>)[move]!
  );
}

/**
 * How much of a combo's timeline the two halves share. Inside the seam both
 * parts are live and crossfaded, so the second move starts out of the first
 * one's follow-through instead of out of a neutral pose.
 */
const COMBO_SEAM = 0.14;

// Scratch space for the crossfade. Curves write whole channel sets, so blending
// two of them needs somewhere to evaluate each before mixing; a curve is only
// ever evaluated inside one frame's update, and combos never nest, so two
// module-level buffers are enough and keep the animation loop allocation-free.
const seamA = blankChannels();
const seamB = blankChannels();
// Two more for the finite difference that measures how fast the outgoing move
// was travelling as it handed over.
const seamV0 = blankChannels();
const seamV1 = blankChannels();

/**
 * Channels that describe where the body *is*, as opposed to how far through an
 * effect it is.
 *
 * The distinction matters anywhere channels are blended or carried: `lean` and
 * `armSwing` are a pose, and easing one into another is what smoothing means,
 * while `shock` and `aura` are a ring's own progress from 0 to 1 and `dust` is
 * an emission rate. Averaging those two together would run an expanding
 * shockwave backwards.
 */
const POSE_KEYS = [
  "lean",
  "tumble",
  "push",
  "sway",
  "lift",
  "spin",
  "roll",
  "squash",
  "pulse",
  "stretch",
  "armSwing",
  "armFlare",
  "armAlternate",
  "armFold",
  "legThrust",
  "legFold",
  "headPush",
  "wingFlap",
  "wingWrap",
  "tailSwing",
  "spikeFlare",
] as const satisfies ReadonlyArray<keyof Channels>;

function evalInto(
  curve: MoveCurve,
  local: number,
  out: Channels,
  intensity: number,
  agility: number,
): void {
  Object.assign(out, blankChannels());
  curve(Math.max(0, Math.min(1, local)), out, intensity, agility);
}

/**
 * How long the outgoing move's momentum keeps pushing the incoming one, in
 * combo-timeline units, and how much of it is kept.
 *
 * This is the difference between two moves played in a row and one move that
 * came out of another. Crossfading poses alone is continuous in *position* but
 * not in *speed*: the body arrives at the seam travelling, and on the far side
 * of it the second curve's own wind-up starts from nothing, so the motion
 * visibly stops and restarts even though nothing jumped. Carrying the measured
 * exit velocity across as a decaying push makes the speed continuous too, and
 * that is what reads as one move flowing into the next — the tail is still
 * unwinding from the whip when the slam starts pulling the body over.
 */
const MOMENTUM_TAU = COMBO_SEAM * 0.75;
const MOMENTUM_GAIN = 0.55;

/** One lookup for everything playable, combos included. */
const CURVES: Record<Exclude<AnimationState, "idle">, MoveCurve> = (() => {
  const table = { ...CORE_CURVES, ...ATTACK_CURVES, ...DEFENSE_CURVES } as Record<
    Exclude<AnimationState, "idle">,
    MoveCurve
  >;
  for (const combo of COMBO_KEYS) {
    const parts = COMBO_PARTS[combo];
    // Each part gets a window on the combo's own timeline, overlapping its
    // neighbour by the seam. Precomputed once, because this runs every frame.
    const spans = (() => {
      const out: Array<{ curve: MoveCurve; from: number; to: number; boost: number }> = [];
      let start = 0;
      for (const [index, part] of parts.entries()) {
        const last = index === parts.length - 1;
        const end = last ? 1 : start + part.share;
        out.push({
          curve: curveForMove(part.move),
          from: index === 0 ? 0 : start - COMBO_SEAM,
          to: end,
          // The back half of a combo lands harder than the move would alone.
          boost: index === 0 ? 1 : 1.18,
        });
        start = end;
      }
      return out;
    })();

    table[combo] = (t, c, i, a) => {
      let first: (typeof spans)[number] | null = null;
      let second: (typeof spans)[number] | null = null;
      for (const span of spans) {
        if (t < span.from || t > span.to) continue;
        if (!first) first = span;
        else if (!second) second = span;
      }
      const lead = first ?? spans[spans.length - 1]!;
      evalInto(lead.curve, (t - lead.from) / (lead.to - lead.from), seamA, i * lead.boost, a);
      if (second) {
        // Inside the seam: ease the outgoing pose into the incoming one.
        const span = second.to - second.from;
        evalInto(second.curve, (t - second.from) / span, seamB, i * second.boost, a);
        const overlap = Math.max(1e-4, lead.to - second.from);
        const raw = Math.max(0, Math.min(1, (t - second.from) / overlap));
        const k = raw * raw * (3 - 2 * raw);
        for (const key of CHANNEL_KEYS) c[key] = seamA[key] + (seamB[key] - seamA[key]) * k;
        // Effects are not poses and do not average: an expanding ring that is
        // 0.6 of the way out cannot be crossfaded with one that has not
        // started without running backwards. Whichever is further along wins.
        c.shock = Math.max(seamA.shock, seamB.shock);
        c.aura = Math.max(seamA.aura, seamB.aura);
        c.dust = Math.max(seamA.dust, seamB.dust);
        c.glowFlash = Math.max(seamA.glowFlash, seamB.glowFlash);
        c.glowDrain = Math.max(seamA.glowDrain, seamB.glowDrain);
      } else {
        for (const key of CHANNEL_KEYS) c[key] = seamA[key];
      }
      // Momentum across the join: measure how fast the outgoing move was
      // moving each part as it handed over, and keep pushing the body that way
      // for a moment after. `age * exp(-age / tau)` is zero at the seam and
      // rises at exactly the speed that was measured, so the body's velocity
      // is continuous across a join where only its position used to be, and it
      // has decayed away again before the second move's own strike lands.
      for (const span of spans.slice(1)) {
        const age = t - span.from;
        if (age <= 0 || age > MOMENTUM_TAU * 5) continue;
        const outgoing = spans[spans.indexOf(span) - 1]!;
        const seamLocal = (span.from - outgoing.from) / (outgoing.to - outgoing.from);
        const h = 0.012;
        if (seamLocal - h < 0 || seamLocal > 1) continue;
        evalInto(outgoing.curve, seamLocal - h, seamV0, i * outgoing.boost, a);
        evalInto(outgoing.curve, seamLocal, seamV1, i * outgoing.boost, a);
        const decay = age * Math.exp(-age / MOMENTUM_TAU) * MOMENTUM_GAIN;
        for (const key of POSE_KEYS) {
          const velocity = (seamV1[key] - seamV0[key]) / h;
          c[key] += velocity * decay;
        }
      }
      // One accent on the join, so a combo reads as a single bigger thing than
      // either of its halves rather than two moves played in a row.
      for (const span of spans.slice(1)) {
        const accent = beat(t, span.from, span.from + COMBO_SEAM * 1.6, 0.4);
        if (accent <= 0) continue;
        c.glowFlash = Math.max(c.glowFlash, accent * 0.7);
        c.dust += accent * 0.7;
        c.pulse += accent * 0.05 * i;
        c.spikeFlare += accent * 0.25;
      }
    };
  }
  return table;
})();

/**
 * How long the flinch layer runs for. Shorter than the shortest move on
 * purpose: it is an accent on a hit, not a reaction of its own.
 */
const FLINCH_SECONDS = 0.34;

/** Seconds each state runs before it hands back to idle. */
const DURATION: Record<AnimationState, number> = {
  idle: 0,
  attack_lurch: 0.5,
  hit_react: 0.42,
  celebrate: 1.8,
  swipe: 0.7,
  bite: 0.6,
  tail_whip: 0.8,
  wing_gust: 0.95,
  spike_burst: 0.65,
  charge: 0.85,
  // Spans the whole gather → dash → strike → recoil arc, because facing locks
  // onto the opponent for exactly this long and the dash has to stay aimed for
  // all of it.
  dash_strike: 1.05,
  ground_slam: 1,
  elemental_burst: 1.1,
  shell_guard: 1.05,
  wing_shield: 1,
  dodge: 0.52,
  parry: 0.6,
  absorb: 1,
  counter_stance: 1.15,
  swipe_bite: 1.2,
  charge_slam: 1.7,
  gust_spike: 1.5,
  dash_bite: 1.55,
  dash_whip: 1.7,
  dash_slam: 1.85,
  dodge_counter: 1.5,
  absorb_burst: 1.9,
  // The category strikes. A punch is the fastest thing in the table on
  // purpose — it is the move a humanoid throws when there is no time for
  // anything else — and the heavy category finishers sit up with the slams.
  punch: 0.5,
  kick: 0.58,
  grapple: 0.9,
  pounce: 0.82,
  fire_breath: 1.05,
  pincer_snap: 0.5,
  dive_bomb: 1.05,
  piston_slam: 0.9,
  punch_kick: 1.05,
  dash_punch: 1.35,
  pounce_bite: 1.3,
};

/* ------------------------------------------------------------ strike frames */

/**
 * The moment a move actually connects, written as the same beat window the
 * curve itself uses.
 *
 * A swing is not a uniform event: the body gathers, travels, lands the blow and
 * recovers, and only one instant in that arc is contact. Reacting on a fixed
 * timer after the move starts puts the impact wherever the timer happens to
 * fall — early on a long wind-up like `wing_gust`, late on a snap like `bite` —
 * and the hit reads as unrelated to the swing that caused it.
 *
 * So each move declares the accent that *is* its contact, by the numbers its
 * own curve already uses, and the frame is derived with `beat`'s own peak maths
 * below. Quoting the window instead of a hand-copied fraction means a retuned
 * curve and its strike frame cannot drift apart silently — they are the same
 * three numbers.
 *
 * `weight` is how heavy the blow reads, 0–1, and is what scales everything
 * downstream: how long both bodies freeze, how far the struck one gives ground,
 * how hard the camera is kicked. A claw swipe and a full body slam are the same
 * event to the server and must not be the same event to the eye.
 */
const STRIKE_BEATS: Record<
  Exclude<AnimationState, "idle" | ComboMove>,
  { from: number; to: number; bias: number; weight: number }
> = {
  // The generic swing the client falls back to when the server names a move it
  // does not know. Middling on every axis on purpose.
  attack_lurch: { from: 0, to: 0.6, bias: 3, weight: 0.38 },
  // Being hit is itself an impact — used when a reaction is all the client has.
  hit_react: { from: 0, to: 0.5, bias: 4, weight: 0.3 },
  // Nothing connects in a victory dance. Weight 0 suppresses the whole layer.
  celebrate: { from: 0, to: 1, bias: 1, weight: 0 },

  swipe: { from: 0.22, to: 0.74, bias: 0.45, weight: 0.44 },
  // `shut` — the jaw closing, not the lunge that carried it there.
  bite: { from: 0.5, to: 0.74, bias: 0.4, weight: 0.56 },
  // `crack` — the tip coming round, which is the part that hurts.
  tail_whip: { from: 0.34, to: 0.76, bias: 0.4, weight: 0.62 },
  // The *second* downbeat. The first is the wings raising for it.
  wing_gust: { from: 0.56, to: 0.92, bias: 0.4, weight: 0.48 },
  spike_burst: { from: 0.24, to: 0.74, bias: 0.35, weight: 0.54 },
  charge: { from: 0.52, to: 0.8, bias: 0.35, weight: 0.8 },
  // Matches the `impact` accent inside the dash, which is deliberately the same
  // window the stage closes distance over. The blow lands at the far end of the
  // travel, not on the frame the dash begins.
  dash_strike: { from: 0.5, to: 0.72, bias: 0.3, weight: 0.76 },
  // The heaviest thing in the game: a whole body arriving on the floor.
  ground_slam: { from: 0.5, to: 0.8, bias: 0.3, weight: 1 },
  elemental_burst: { from: 0.34, to: 0.74, bias: 0.3, weight: 0.86 },

  // `impact` — the fist arriving, not the drive that carried it. Light for its
  // speed: a punch is the cheap fast option and has to read as one.
  punch: { from: 0.38, to: 0.6, bias: 0.34, weight: 0.4 },
  // `snap` — the knee opening. A leg is heavier than an arm and lands like it.
  kick: { from: 0.42, to: 0.76, bias: 0.38, weight: 0.62 },
  // `slam` — putting the hold down, which is the only part that hurts. The
  // reach and the seize before it are setup, not contact.
  grapple: { from: 0.62, to: 0.9, bias: 0.32, weight: 0.9 },
  // `claws` — arriving on top of the target, mid-air, not the launch.
  pounce: { from: 0.42, to: 0.72, bias: 0.4, weight: 0.7 },
  // `spit` — the front of the stream. The breath keeps going after this, but
  // the blow is the moment it arrives.
  fire_breath: { from: 0.38, to: 0.6, bias: 0.3, weight: 0.82 },
  // The *second* clack. The first is the one that opens the pincers for it.
  pincer_snap: { from: 0.5, to: 0.82, bias: 0.3, weight: 0.5 },
  // `talons` — the bottom of the dive, where all the height turns into a hit.
  dive_bomb: { from: 0.56, to: 0.8, bias: 0.3, weight: 0.84 },
  // `impact` — a hydraulic ram at full extension, near the top of the scale.
  piston_slam: { from: 0.56, to: 0.8, bias: 0.26, weight: 0.96 },

  // A defence connects too — this is the frame the blow meets the guard, which
  // is when a block has to spark. Light, because the point of a guard is that
  // the energy goes somewhere other than the body behind it.
  shell_guard: { from: 0.28, to: 0.62, bias: 0.7, weight: 0.3 },
  wing_shield: { from: 0.32, to: 0.64, bias: 0.35, weight: 0.28 },
  // A dodge is contact that did not happen. Kept for the timing only.
  dodge: { from: 0.14, to: 0.68, bias: 0.35, weight: 0.12 },
  // `caught` — the instant the incoming blow is turned, which is the whole
  // point of the move and should hit harder than a passive block.
  parry: { from: 0.4, to: 0.68, bias: 0.4, weight: 0.46 },
  absorb: { from: 0.54, to: 0.92, bias: 0.3, weight: 0.34 },
  counter_stance: { from: 0.6, to: 0.88, bias: 0.35, weight: 0.6 },
};

/**
 * Where a beat window crests, using exactly the maths `beat` uses to place its
 * own peak. Derived rather than written down so a retuned bias moves the strike
 * frame with it.
 */
function beatPeak(from: number, to: number, bias: number): number {
  return from + (to - from) * Math.min(0.98, Math.max(0.02, Math.pow(0.5, 1 / bias)));
}

/** One contact inside a move: when it lands, and how hard. */
export type StrikeFrame = {
  /** Seconds from the start of the move. */
  at: number;
  /** Fraction of the move's own timeline, 0–1. */
  fraction: number;
  /** How heavy the blow reads, 0–1. */
  weight: number;
};

/**
 * Every contact in a move, in order.
 *
 * A combo has two, because it is two blows: the parts are laid out on the
 * combo's timeline exactly as `CURVES` lays them out — same shares, same seam,
 * same 1.18 boost on the back half — so the second contact lands where the
 * second curve's own accent lands rather than at some fraction of the whole.
 * Reading the layout from `COMBO_PARTS` is what keeps the two in step.
 */
const STRIKES: Record<AnimationState, readonly StrikeFrame[]> = (() => {
  const table = {} as Record<AnimationState, readonly StrikeFrame[]>;
  table.idle = [];
  for (const [name, spec] of Object.entries(STRIKE_BEATS) as Array<
    [Exclude<AnimationState, "idle" | ComboMove>, (typeof STRIKE_BEATS)[AttackMove]]
  >) {
    const fraction = beatPeak(spec.from, spec.to, spec.bias);
    table[name] =
      spec.weight > 0 ? [{ at: fraction * DURATION[name], fraction, weight: spec.weight }] : [];
  }
  for (const combo of COMBO_KEYS) {
    const total = DURATION[combo];
    const frames: StrikeFrame[] = [];
    let start = 0;
    for (const [index, part] of COMBO_PARTS[combo].entries()) {
      const last = index === COMBO_PARTS[combo].length - 1;
      const from = index === 0 ? 0 : start - COMBO_SEAM;
      const to = last ? 1 : start + part.share;
      start = to;
      const spec = STRIKE_BEATS[part.move];
      if (spec.weight <= 0) continue;
      // The part's own peak, expressed on the combo's timeline.
      const fraction = from + beatPeak(spec.from, spec.to, spec.bias) * (to - from);
      frames.push({
        at: fraction * total,
        fraction,
        // Same boost the curve gets: the back half of a combo lands harder.
        weight: Math.min(1, spec.weight * (index === 0 ? 1 : 1.18)),
      });
    }
    table[combo] = frames.sort((a, b) => a.at - b.at);
  }
  return table;
})();

/**
 * When a move connects, and how hard, for scheduling a reaction against the
 * blow itself instead of against a stopwatch. Empty for moves that never make
 * contact.
 */
export function strikeFrames(state: AnimationState): readonly StrikeFrame[] {
  return STRIKES[state] ?? [];
}

/**
 * The move's heaviest contact, 0–1, or 0 if it has none. What the camera and
 * the freeze scale against when all that is known is which move was thrown.
 */
export function strikeWeight(state: AnimationState): number {
  let weight = 0;
  for (const frame of strikeFrames(state)) weight = Math.max(weight, frame.weight);
  return weight;
}

/**
 * Priority stops a trickle of server events from stomping a bigger reaction: a
 * victory dance outranks the hit that happened to land on the same frame, and a
 * defence outranks the player's own outgoing attack, because what is being done
 * *to* a creature reads as more urgent than what it is doing.
 */
const PRIORITY: Record<AnimationState, number> = (() => {
  const table = { idle: 0, attack_lurch: 1, hit_react: 2, celebrate: 4 } as Record<
    AnimationState,
    number
  >;
  for (const move of ATTACK_KEYS) table[move] = 1;
  for (const move of DEFENSE_KEYS) table[move] = 2;
  for (const move of COMBO_KEYS) table[move] = 3;
  return table;
})();

export const ATTACK_STATES: readonly AttackMove[] = ATTACK_KEYS;
export const DEFENSE_STATES: readonly DefenseMove[] = DEFENSE_KEYS;
export const COMBO_STATES: readonly ComboMove[] = COMBO_KEYS;

/**
 * Whether a value off the wire names an animation this build can play. The
 * server chooses the move, so the client has to be able to ignore a name it
 * does not know — an older client meeting a newer server falls back to its own
 * core reaction instead of freezing on a missing curve.
 */
export function isAnimationState(value: unknown): value is AnimationState {
  return typeof value === "string" && value in DURATION;
}

/**
 * How long a state plays for, in seconds. Read from outside because facing has
 * to know when a swing is over: the body locks onto its opponent for exactly as
 * long as the move lasts, then goes back to looking where it is walking.
 */
export function animationDuration(state: AnimationState): number {
  return DURATION[state] ?? 0;
}

/* -------------------------------------------------------------- body plan */

const RARITY_COLOR: Record<string, number> = {
  common: 0x9aa4b2,
  uncommon: 0x5ec8e5,
  rare: 0xb6f03c,
  epic: 0xa473f5,
  legendary: 0xf0a63c,
};

/**
 * Resting joint flex, in radians.
 *
 * A limb held dead straight is the other half of why the old bodies read as
 * toys: nothing alive stands locked out. A few degrees of bend at the knee and
 * a little more at the elbow puts weight on the legs and lets the arms hang,
 * and because it is rest pose rather than animation the swing channels stack
 * on top of it untouched.
 */
const LEG_REST_FLEX = 0.22;
const ARM_REST_FLEX = 0.3;

/**
 * How hard the off arm counters the lead arm on a one-sided move.
 *
 * Same number, and the same reason, as the third of the thrust the off legs
 * brace back with: a counter is a shoulder rolling under the drive, not the
 * other hand throwing the mirror-image punch out the back of the body.
 */
const OFF_ARM_COUNTER = 0.34;

/**
 * Trunk height multiplier.
 *
 * The chibi build spends its height budget on the head, so the torso gives some
 * back. Applied here rather than edited into `SHAPE_DIMS` so the shape table
 * still reads as the relative proportions of the six body shapes, with the
 * house style kept as one number that can be dialled.
 */
const TRUNK_COMPACT = 0.72;

/**
 * Head size per body shape, as a multiplier on "half the trunk's largest
 * dimension".
 *
 * A brute's head is smaller relative to its slab of a chest, a whippet's is
 * bigger relative to its narrow one, and an orb barely has a head at all — it
 * is a body with no anatomy by definition, so a full chibi skull on top would
 * read as a second body.
 */
/**
 * The bulkiest mesh under a node, by bounding-box volume.
 *
 * Used to find the cranium inside a head block. A head block is authored as one
 * big ball with smaller features — a muzzle, a crest, a hinged jaw — hung off
 * it, so the largest single piece is the part a helmet is worn on. Measuring
 * the block as a whole instead includes everything that sticks out of it.
 *
 * World matrices are the caller's job to have refreshed.
 */
function bulkiestPiece(node: THREE.Object3D): THREE.Object3D | null {
  let best: THREE.Object3D | null = null;
  let bestVol = 0;
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  node.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    box.setFromObject(child);
    if (box.isEmpty()) return;
    box.getSize(size);
    const vol = size.x * size.y * size.z;
    if (vol > bestVol) {
      bestVol = vol;
      best = child;
    }
  });
  return best;
}

/**
 * How much narrower a limb is at the tip than at the root.
 *
 * Chibi limbs are stubby cylinders, not cones: the shape comes from the boot
 * and the glove at the end, and a shaft that tapers hard behind them reads as
 * a bowling pin. Arms taper a little more than legs because a hand is smaller
 * than a foot.
 */
const LEG_TAPER = 0.84;
const ARM_TAPER = 0.76;

const HEAD_RATIO: Record<CreatureForm["bodyShape"], number> = {
  upright: 1.0,
  bulky: 0.85,
  lithe: 1.1,
  serpentine: 0.95,
  insectoid: 1.0,
  orb: 0.55,
};

/** Base trunk dimensions per body shape, before the silhouette stretches them. */
const SHAPE_DIMS: Record<
  CreatureForm["bodyShape"],
  { width: number; height: number; length: number; y: number; upright: boolean }
> = {
  upright: { width: 0.34, height: 0.54, length: 0.28, y: 0.7, upright: true },
  bulky: { width: 0.5, height: 0.44, length: 0.44, y: 0.58, upright: true },
  lithe: { width: 0.26, height: 0.28, length: 0.58, y: 0.56, upright: false },
  serpentine: { width: 0.24, height: 0.24, length: 0.8, y: 0.52, upright: false },
  insectoid: { width: 0.36, height: 0.22, length: 0.5, y: 0.36, upright: false },
  orb: { width: 0.34, height: 0.34, length: 0.34, y: 0.78, upright: true },
};

/** Silhouette multipliers, applied on top of the shape. */
const SILHOUETTE_DIMS: Record<CreatureForm["silhouette"], { w: number; h: number; l: number }> = {
  tall: { w: 0.86, h: 1.24, l: 0.9 },
  squat: { w: 1.16, h: 0.8, l: 1.04 },
  long: { w: 0.94, h: 0.86, l: 1.36 },
  round: { w: 1.14, h: 1.02, l: 1.12 },
};

/** Tail proportions: segment count, length and taper. */
const TAIL_DIMS: Record<CreatureForm["tail"], { segments: number; length: number; girth: number }> = {
  none: { segments: 0, length: 0, girth: 0 },
  long: { segments: 5, length: 0.46, girth: 0.05 },
  thick: { segments: 4, length: 0.38, girth: 0.085 },
  lash: { segments: 6, length: 0.52, girth: 0.032 },
  plume: { segments: 4, length: 0.34, girth: 0.075 },
};

export type Character = {
  group: THREE.Group;
  /** Called every frame with elapsed seconds; drives idle and combat motion. */
  update: (elapsed: number, paused: boolean) => void;
  setHealth: (ratio: number) => void;
  flash: (color: number) => void;
  /** Start a one-shot reaction. Ignored while a higher-priority one runs. */
  play: (state: AnimationState) => void;
  /**
   * A twitch layered over whatever is already playing: the glow pulses, the
   * tail flicks and — on a winged body — the wings snap once. Used for taking
   * a hit, where the reaction has to read even if the body is mid-block and
   * `play` would refuse to interrupt it.
   */
  flinch: () => void;
  /**
   * Take a blow from a given direction.
   *
   * `fromX`/`fromZ` point from this body toward whatever hit it, in this
   * body's own local space, so the reaction is directional: the body reels away
   * from where the blow came from and gives ground along that line instead of
   * recoiling the same way every time. `weight` is the blow's own 0–1 heft, and
   * `blocked` switches the whole layer over to a guard read — a spark and a
   * shove rather than a body folding around an impact.
   */
  reel: (blow: { fromX: number; fromZ: number; weight: number; blocked?: boolean }) => void;
  /**
   * Freeze the animation clock for a moment: hitstop. The curve stops advancing
   * and the body holds the frame it was on, which is what makes an impact land
   * with weight rather than passing through. Wall-clock things — the damage
   * flash, the speech bubble — keep running, because they are not the blow.
   */
  hold: (seconds: number) => void;
  /** How far through its current move this body is, for timing against it. */
  progress: () => { state: AnimationState; elapsed: number; remaining: number };
  /** Show a line in the bubble over the character's head. */
  say: (text: string, ttl?: number) => void;
  /**
   * Apply a booster level without rebuilding the mesh: re-scales reaction
   * intensity and shows the hardware tiers that level has earned.
   */
  setLevel: (level: number) => void;
  /** The form this character was actually built from. */
  form: CreatureForm;
  dispose: () => void;
};

/**
 * Walks a block tail's nested `joint` groups from the root out to the tip, in
 * order, so the whip lag can be written onto them the same way it is written
 * onto the primitive chain.
 */
function collectJoints(root: THREE.Object3D): THREE.Object3D[] {
  const joints: THREE.Object3D[] = [];
  let node: THREE.Object3D | undefined = root.children.find((child) => child.name === "joint");
  while (node) {
    joints.push(node);
    node = node.children.find((child) => child.name === "joint");
  }
  return joints;
}

export function createCharacter(config: CharacterConfig): Character {
  const form = config.form ?? formFromModelId(config.modelId || config.name, config.rarity);
  const accent = RARITY_COLOR[config.rarity] ?? RARITY_COLOR.common!;
  let intensity = intensityForLevel(config.level);
  /** Fixed for the life of the body: agility is anatomy, not a setting. */
  const agility = agilityForForm(form);

  const group = new THREE.Group();
  /**
   * The body hangs off `rig`, not off `group`: animation moves the rig, so the
   * ground ring stays planted and the health bar and speech bubble do not
   * lurch, spin or squash along with the body.
   */
  const rig = new THREE.Group();
  group.add(rig);
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  /* ------------------------------------------------------------- materials */

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(form.palette.base),
    metalness: form.theme === "construct" ? 0.8 : 0.25,
    roughness: form.theme === "construct" ? 0.3 : 0.62,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(form.palette.accent),
    metalness: 0.45,
    roughness: 0.4,
  });
  // Emissive parts. `baseGlow` is the resting intensity the form asked for; the
  // flash and drain channels move around it and it is restored every frame.
  const baseGlow = 0.25 + form.glow * 1.35;
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(form.palette.glowColor),
    emissive: new THREE.Color(form.palette.glowColor),
    emissiveIntensity: baseGlow,
    metalness: 0.2,
    roughness: 0.3,
  });
  const membraneMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(form.palette.accent),
    emissive: new THREE.Color(form.palette.glowColor),
    emissiveIntensity: baseGlow * 0.35,
    metalness: 0.1,
    roughness: 0.55,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });
  /**
   * Surface pass. The colours above stay exactly as the form asked for them;
   * what gets added is relief — scales, fur, carapace, facets, feathers, panel
   * lines — generated in code from the theme and shared between every
   * character wearing it, plus the rim and subsurface terms that stop a body
   * reading as a flat cutout against the camera feed. No files, no downloads.
   */
  const rimColor = new THREE.Color(form.palette.glowColor);
  applySkin(bodyMat, form.theme, { rimColor });
  // Accents are trim, so they take the same surface at a tighter tiling and a
  // lower relief — a small plate should not wear a full-body scale pattern.
  applySkin(accentMat, form.theme, {
    rimColor,
    tiling: 14,
    rim: 0.35,
    subsurface: 0.1,
  });
  // Membranes are thin and lit through, so they lean on subsurface and keep
  // almost no relief of their own.
  applySkin(membraneMat, form.theme, {
    rimColor,
    tiling: 6,
    rim: 0.8,
    subsurface: 0.9,
  });
  membraneMat.metalness = 0.1;
  membraneMat.roughness = 0.55;
  // The base material's own metal/rough answer to the theme, which the recipe
  // has just overwritten with its own — keep the construct's metal read.
  if (form.theme === "construct") bodyMat.metalness = 0.8;

  /**
   * The shell layer. Plates are worn *over* the skin above, not instead of it:
   * the themed surface keeps showing in the seams, at the joints and everywhere
   * a plate does not reach, so a dragon reads as scaled under armour.
   *
   * Plate colour is the character's own body colour pulled a quarter of the way
   * toward its accent, so the armour belongs to the character rather than being
   * a uniform issued to the whole roster — plates in the raw accent read as
   * armour borrowed off somebody else, a green dragon in cyan plate.
   *
   * The mix is then held inside a lightness band. Left alone, a dark-slate
   * construct plates in near-black and disappears into the background, and a
   * pale palette plates in something that reads as unpainted plastic. The band
   * is the range where the panel seams and the trim still have something to be
   * seen against.
   */
  const shellColor = new THREE.Color(form.palette.base).lerp(new THREE.Color(form.palette.accent), 0.25);
  const shellHSL = { h: 0, s: 0, l: 0 };
  shellColor.getHSL(shellHSL);
  shellColor.setHSL(shellHSL.h, shellHSL.s * 0.9, Math.min(0.42, Math.max(0.24, shellHSL.l * 0.8)));
  const shellMat = shellMaterial(shellColor);
  // Plates are moulded panels, so they get the theme's surface at a coarse
  // tiling for a little manufacturing grain, and none of its relief.
  applySkin(shellMat, form.theme, { rimColor, tiling: 3, rim: 0.4, subsurface: 0.0 });
  shellMat.metalness = 0.55;
  shellMat.roughness = 0.24;
  shellMat.normalScale = new THREE.Vector2(0.25, 0.25);
  /**
   * Trim runs off the accent rather than the glow colour.
   *
   * `glowColor` is a near-white tint of the accent — right for a core or an eye
   * the size of a marble, where blowing out to white is the point. Trim is
   * hundreds of centimetres of line drawn over the whole silhouette, and at
   * that length a colour that starts at 90% white tone-maps to plain white on
   * every character, whatever their palette. The accent is the saturated one,
   * so that is what the line is lit in.
   */
  const trimColor = new THREE.Color(form.palette.accent);
  /**
   * Floored and capped. A creature's own glow drives how hot the trim runs, but
   * a low-glow theme — a beast at 0.16 — ended up with lines that read as paint
   * rather than light and vanished into a body of the same hue. The floor is
   * the point where a line still reads as lit against its own plating; the cap
   * is where the strongest channel clips and the hue washes back out to white,
   * which is the problem the accent switch above exists to fix.
   */
  const trimGlow = Math.min(1.0, Math.max(0.5, baseGlow * 1.35));
  const trimMat = trimMaterial(trimColor, trimGlow);

  disposables.push(bodyMat, accentMat, glowMat, membraneMat, shellMat, trimMat);

  /* ---------------------------------------------------------- mesh blocks */

  /**
   * The hybrid half of the body. A form asking for a block set gets a plan
   * naming one mesh block per slot it upgrades; every slot the plan leaves
   * `null`, and every form on `"none"` (which is every creature minted before
   * block sets existed), falls through to the primitive built below exactly as
   * it always was. Blocks hang off the same groups the primitives do, so the
   * animation channels, the placement and the facing logic are untouched.
   */
  const plan = blockPlanFor(form.blockSet);
  const blockCtx: BlockContext = {
    materials: { body: bodyMat, accent: accentMat, glow: glowMat, membrane: membraneMat },
    disposables,
  };

  /**
   * Hang a body part's armour on it.
   *
   * The shell and the trim arrive already merged into one geometry each, so
   * dressing a part costs two meshes however many plates it is wearing. Both
   * are parented to the part itself, which means every animation channel that
   * moves the part — lean, breath, stride, the whole dash — carries its armour
   * with it, and no channel has to know the armour exists.
   */
  const wear = (parent: THREE.Object3D, dressing: Dressing) => {
    if (dressing.shell) {
      const mesh = new THREE.Mesh(dressing.shell, shellMat);
      mesh.castShadow = true;
      parent.add(mesh);
      disposables.push(dressing.shell);
    }
    if (dressing.trim) {
      // Trim does not cast: it is a few millimetres of tube, and the shadow it
      // would throw is noise that costs a pass over the shadow map.
      parent.add(new THREE.Mesh(dressing.trim, trimMat));
      disposables.push(dressing.trim);
    }
  };

  /* ---------------------------------------------------------- proportions */

  const shape = SHAPE_DIMS[form.bodyShape];
  const sil = SILHOUETTE_DIMS[form.silhouette];
  const slimWidth = shape.width * sil.w * form.scale;
  const height = shape.height * sil.h * form.scale * TRUNK_COMPACT;
  const length = shape.length * sil.l * form.scale * (shape.upright ? 0.88 : 1);
  const floats = form.limbCount === 0;

  /**
   * The head, and everything the head decides.
   *
   * A head is sized off the trunk's largest dimension rather than off a fixed
   * radius, so it stays a head-sized head on a brute and on a whippet. The
   * halving is what lands a head roughly as wide as the shoulders — the single
   * proportion that carries the whole look.
   */
  const headR = Math.max(slimWidth, height) * 0.5 * HEAD_RATIO[form.bodyShape];

  /**
   * The trunk can be slim, but not slimmer than the head it carries.
   *
   * A tall narrow silhouette reads fine at realistic proportions and falls
   * apart at chibi ones: the head is half the height, so a trunk built to the
   * silhouette's own width comes out narrower than the skull and the character
   * is a lollipop with the arms and legs stacked up its centre line. Holding
   * the trunk to roughly the skull's own width keeps the shoulders under the
   * head, which is what gives the limbs somewhere to hang from.
   *
   * The floor is `headR * 1.75` rather than the head's full diameter because
   * the plates dressed over the trunk add their own thickness on both sides,
   * which lands the finished shoulders a touch wider than the skull — the
   * proportion the references have.
   */
  const width = floats ? slimWidth : Math.max(slimWidth, headR * 1.75);

  /**
   * Legs, and the trunk height that follows from them.
   *
   * This is built from the floor up, which is the reverse of what it used to
   * do. Before, the trunk sat at a height the shape table named and the legs
   * were however long they had to be to reach the ground — so shortening the
   * legs to stubs would have left the feet dangling. Now the leg length is the
   * proportion being chosen, and the trunk sits wherever a leg that short puts
   * it. Feet land on the floor by construction, at any silhouette or scale.
   */
  const legLength = floats ? 0 : height * (shape.upright ? 0.66 : 0.42);
  // A body on four or six legs carries its weight across all of them, so each
  // one is thinner than the pair a biped stands on. At the quadruped's shorter
  // leg length the biped's girth makes a limb as wide as it is long, and the
  // joint masses inside it swell it into a row of beads.
  const legRadius = Math.min(width, height) * (shape.upright ? 0.27 : 0.17);
  const hipY = legLength + legRadius * 0.24;
  const trunkY = floats
    ? (shape.y + 0.06) * form.scale * (0.85 + sil.h * 0.15)
    : hipY + height * (shape.upright ? 0.3 : 0.17);

  /* ----------------------------------------------------------------- trunk */

  /**
   * The trunk. Long bodies are built as a chain of tapering segments rather
   * than one stretched box, so a serpent bends and undulates instead of
   * sliding around rigid — the segments are what the idle wave and the tail
   * whip actually travel down.
   */
  const segments: Array<{ mesh: THREE.Object3D; offset: number; baseY: number }> = [];
  const segmentCount = form.bodyShape === "serpentine" ? 5 : form.bodyShape === "insectoid" ? 3 : 1;

  if (segmentCount === 1 && plan?.torso) {
    // A block torso is fitted inside a carrier group: the breath pass writes
    // `scale` on the carrier every frame, so the fit has to live one level
    // down or it would be overwritten on the first tick.
    const carrier = new THREE.Group();
    carrier.position.y = trunkY;
    const torso = buildBlock(plan.torso, blockCtx);
    torso.scale.set(width, height, shape.upright ? length * 1.15 : length);
    carrier.add(torso);
    rig.add(carrier);
    segments.push({ mesh: carrier, offset: 0, baseY: trunkY });
    // A block torso wears the same set as a lofted one, but sized 8% past the
    // block's own extents: the plates are patches of an ellipsoid, and an
    // ellipsoid that exactly matches a box's extents is buried inside every
    // face it is supposed to be riding on. Worn on the carrier rather than the
    // block, so it is not stretched by the block's non-uniform fit scale.
    wear(
      carrier,
      dressTorso({
        width: width * 1.08,
        height: height * 1.04,
        length: (shape.upright ? length * 1.15 : length) * 1.08,
        upright: shape.upright,
      }),
    );
  } else if (segmentCount === 1) {
    // An orb is a body with no anatomy by definition, so it keeps its shell.
    // Everything else is lofted: hips, waist, ribcage and chest threaded onto
    // one surface, instead of the box or the stretched capsule that used to
    // stand in for a torso.
    const trunkGeo =
      form.bodyShape === "orb"
        ? new THREE.IcosahedronGeometry(Math.max(width, height) * 0.62, 2)
        : buildTorso({
            width,
            height,
            length,
            upright: shape.upright,
            bulk: form.bodyShape === "bulky" ? 1 : form.bodyShape === "lithe" ? 0.1 : 0.5,
          });
    const trunk = new THREE.Mesh(trunkGeo, bodyMat);
    trunk.position.y = trunkY;
    trunk.castShadow = true;
    rig.add(trunk);
    disposables.push(trunkGeo);
    segments.push({ mesh: trunk, offset: 0, baseY: trunkY });
    // Chest, back and belt plates, parented to the trunk so the breath and
    // lean channels carry them.
    //
    // An orb wears the segment set instead — a cap over the top and one band
    // round the girth. It has no front, so the chest-and-belt set gives it two
    // slabs and a rim with nothing to distinguish them, and the body ends up
    // reading as a burger rather than a floating core.
    wear(
      trunk,
      form.bodyShape === "orb"
        ? dressSegment({ radius: Math.max(width, height) * 0.62, axis: "y" })
        : dressTorso({ width, height, length, upright: shape.upright }),
    );
  } else {
    // A long body used to be a row of separate spheres, which read as beads on
    // a string the moment the travelling wave moved them. It is now one skinned
    // surface over a bone per segment: the animation still writes a position
    // per segment, and the body bends instead of coming apart.
    const offsets: number[] = [];
    for (let index = 0; index < segmentCount; index += 1) {
      offsets.push(length / 2 - (index / (segmentCount - 1)) * length);
    }
    const spine = buildSpine(
      {
        offsets,
        baseY: trunkY,
        girth: Math.min(width, height) * 0.5,
        depth: form.bodyShape === "insectoid" ? 0.92 : 1.05,
        taper: 0.42,
      },
      bodyMat,
    );
    rig.add(spine.mesh);
    disposables.push(spine.geometry);
    const girth = Math.min(width, height) * 0.5;
    for (const [index, bone] of spine.bones.entries()) {
      // The bone already sits at the segment's rest height, so the animation's
      // absolute writes land exactly where they did on the old spheres.
      segments.push({ mesh: bone, offset: offsets[index]!, baseY: bone.position.y });
      // A long body wears banded segment armour rather than the chest-and-belt
      // set, tapering toward the tail the way the body under it does.
      const ring = girth * (1 - (index / segmentCount) * 0.42);
      wear(bone, dressSegment({ radius: ring, axis: "z" }));
    }
  }
  const frontZ = segmentCount === 1 ? (shape.upright ? length * 0.4 : length * 0.5) : length / 2;
  const backZ = -frontZ;
  const spineY = trunkY + height * (shape.upright ? 0.4 : 0.42);

  /* ------------------------------------------------------------------ head */

  const headGroup = new THREE.Group();
  headGroup.name = "headGroup";
  // Upright creatures carry the head above the trunk; everything else carries
  // it out in front, which is what makes a bite read as a bite.
  //
  // A head this size has no neck to stand on — it sits straight down onto the
  // shoulders and overlaps the chest slightly, so there is never a gap between
  // the two and never a stalk holding the skull up. That overlap is why the
  // `buildNeck` the anatomy module offers is deliberately not used here.
  const headBase = shape.upright
    ? new THREE.Vector3(0, trunkY + height / 2 + headR * 0.72, length * 0.06)
    : new THREE.Vector3(0, trunkY + height * 0.28, frontZ + headR * 0.7);
  headGroup.position.copy(headBase);
  rig.add(headGroup);

  // A block head replaces the primitive skull, snout and jaw wedge in one
  // piece. `jaw` keeps pointing at something rotatable either way — the block's
  // own `jaw` child when it has one — so the bite channel needs no branch.
  let head: THREE.Object3D;
  let jaw: THREE.Object3D;
  // A block head is a unit sphere blown up past the primitive head radius, so
  // anything mounted on the skull — ears, a brow gem — has to sit on *this*
  // radius or it ends up buried inside the block.
  const skullR = plan?.head ? headR * 1.2 : headR;
  // The radius the helmet is actually worn on. A primitive skull is built to a
  // known radius; block head art is authored to no fixed size, so its own
  // bounds are measured before the fit scale goes on and the helmet is sized
  // from that. Trusting the fit scale instead puts the crown plate in orbit
  // above any head whose art happens to be smaller than a unit sphere.
  let wornR = headR;
  const wornAt = new THREE.Vector3();
  if (plan?.head) {
    const headBlock = buildBlock(plan.head, blockCtx);
    // A helmet is worn on the cranium, not on the whole head.
    //
    // Measuring the block's full bounds gets this wrong on every snouted head:
    // the muzzle runs a long way forward, so the box's largest axis is depth
    // and a crown sized off it comes out half again as wide as the skull and
    // centred out in the middle of the face. The cranium is instead picked out
    // as the block's bulkiest single piece — a head block is a big ball with
    // smaller features hung off it — and the helmet is sized and placed on
    // that, off width and height only.
    headBlock.updateWorldMatrix(true, true);
    const skull = bulkiestPiece(headBlock) ?? headBlock;
    const box = new THREE.Box3().setFromObject(skull);
    const raw = box.getSize(new THREE.Vector3());
    wornR = (Math.max(raw.x, raw.y) || 1) * 0.5 * skullR;
    box.getCenter(wornAt).multiplyScalar(skullR);
    headBlock.scale.setScalar(skullR);
    headGroup.add(headBlock);
    head = headBlock;
    jaw = headBlock.getObjectByName("jaw") ?? headBlock;
  } else {
    // Every head is now a rounded helmet skull, whatever the theme.
    //
    // It used to be a cone standing in for the whole head on most themes, which
    // worked when the head was a seventh of the body. At chibi scale the head
    // *is* the character, and a cone that big reads as a traffic bollard — so
    // the skull is a sphere, squashed a little taller than wide and swelled at
    // the back the way the references are, and the snout it used to be is now a
    // much smaller feature hung on the front of it.
    const headGeo = new THREE.SphereGeometry(headR, 20, 16);
    headGeo.scale(0.94, 1.04, 1.0);
    const headMesh = new THREE.Mesh(headGeo, bodyMat);
    headMesh.castShadow = true;
    headGroup.add(headMesh);
    disposables.push(headGeo);
    head = headMesh;

    // Muzzle: a short rounded snout on the front of the skull, for the themes
    // that want a face pushed forward. A construct and an insect do not — one
    // wears a flat visor, the other a smooth chitin dome.
    const snouted = form.theme !== "construct" && form.theme !== "insect";
    if (snouted) {
      const muzzleGeo = new THREE.SphereGeometry(headR * 0.46, 14, 10);
      muzzleGeo.scale(1, 0.78, 1.15);
      const muzzle = new THREE.Mesh(muzzleGeo, bodyMat);
      muzzle.position.set(0, -headR * 0.22, headR * 0.78);
      muzzle.castShadow = true;
      headGroup.add(muzzle);
      disposables.push(muzzleGeo);
    }

    // Jaw: hinged at the back of the muzzle so a bite swings it open. The hinge
    // is a plain group, because the bite channel writes `jaw.rotation.x` — so
    // the jaw's own forward offset has to live on the mesh inside it rather
    // than on the pivot, or the animation would overwrite it every frame.
    const jawPivot = new THREE.Group();
    jawPivot.position.set(0, -headR * 0.34, headR * 0.18);
    // Both jaws are spheres now. The faceless one used to be a box, which at
    // this size read as a rectangular sticker slapped on the chin — hard
    // corners and one flat face catching the key dead-on, against a skull that
    // is curved everywhere else. Squashed wide and thin instead, it reads as a
    // rounded chin bar that follows the head.
    const jawGeo = new THREE.SphereGeometry(headR * (snouted ? 0.4 : 0.44), 12, 8);
    jawGeo.scale(snouted ? 1 : 1.16, snouted ? 0.5 : 0.36, snouted ? 1.25 : 0.86);
    const jawMesh = new THREE.Mesh(jawGeo, accentMat);
    jawMesh.position.set(0, 0, headR * (snouted ? 0.58 : 0.5));
    jawMesh.castShadow = true;
    jawPivot.add(jawMesh);
    headGroup.add(jawPivot);
    disposables.push(jawGeo);
    jaw = jawPivot;
  }

  // Helmet: crown over the skull, cheek plates down the sides, brow line across
  // the front. Parented to the head group rather than to the skull mesh, so it
  // rides every head turn and bite without being scaled by the block-head fit.
  //
  // A face block brings its own brow, so the traced one is suppressed there to
  // stop two brows reading across one face.
  const helmet = new THREE.Group();
  helmet.position.copy(wornAt);
  headGroup.add(helmet);
  wear(helmet, dressHead({ radius: wornR, squash: 1.04, brow: !plan?.face }));

  /* ------------------------------------------------------------------ face */

  // A face block carries its own eyes, nose and mouth, so it stands in for the
  // primitive eye pair and the construct visor. It rides the head block rather
  // than the head group, so a head that swings or opens takes the face with it.
  if (plan?.face) {
    const faceBlock = buildBlock(plan.face, blockCtx);
    if (plan.head) {
      // The head block is a unit head, so the face is already in its units.
      head.add(faceBlock);
    } else {
      // No block head under it: scale the face into the primitive skull's size.
      faceBlock.scale.setScalar(skullR);
      headGroup.add(faceBlock);
    }
  } else if (form.theme === "construct") {
    // A visor, curved to sit on the skull rather than a flat slab across it:
    // the head is a sphere now, so a straight box wide enough to read as a
    // visor would have its ends floating clear of the face.
    const visorGeo = new THREE.SphereGeometry(headR * 1.005, 20, 12, Math.PI * 0.72, Math.PI * 0.56, Math.PI * 0.4, Math.PI * 0.2);
    const visor = new THREE.Mesh(visorGeo, glowMat);
    headGroup.add(visor);
    disposables.push(visorGeo);
  } else {
    // Big eyes, set on the surface of the skull.
    //
    // Their z used to be a fixed fraction of the head radius, which on a cone
    // landed on the snout. On a sphere it lands *inside* the head — so the
    // depth is now solved for: given the x and y the eye wants, this is the z
    // at which the sphere's surface actually is, and the eye sits just proud of
    // it however the head is sized or squashed.
    const eyeX = 0.42;
    const eyeY = 0.2;
    const eyeZ = Math.sqrt(Math.max(0.04, 1 - eyeX * eyeX - eyeY * eyeY));
    const eyeGeo = new THREE.SphereGeometry(headR * 0.26, 12, 10);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, glowMat);
      eye.position.set(side * headR * eyeX, headR * eyeY, headR * eyeZ * 0.92);
      headGroup.add(eye);
    }
    disposables.push(eyeGeo);
  }

  /* ---------------------------------------------------------- ears / horns */

  /**
   * Ears are the one slot the primitive body never had, so a block set adds a
   * pair of pivot groups to the head. They stand in for the horn row rather
   * than sitting next to it: a cat ear and a horn fan on the same skull reads
   * as neither, and the dragon set's own ear block *is* the horn. The blocks are
   * authored symmetric across the head's centre line, so a pair is two copies
   * at opposite tilts — mirroring `scale.x` instead would flip the winding and
   * light the ears from inside.
   */
  const earPivots: THREE.Group[] = [];
  if (plan?.ear) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * skullR * 0.44, skullR * 0.62, -skullR * 0.14);
      pivot.rotation.z = side * 0.26;
      pivot.scale.setScalar(skullR * 1.45);
      const ear = buildBlock(plan.ear, blockCtx);
      pivot.add(ear);
      headGroup.add(pivot);
      earPivots.push(pivot);
    }
  } else {
    const hornGeo = new THREE.ConeGeometry(headR * 0.2, headR * 1.25, 7);
    for (let index = 0; index < form.horns; index += 1) {
      const horn = new THREE.Mesh(hornGeo, accentMat);
      // Horns alternate sides and fan backwards as they multiply.
      const side = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 2);
      horn.position.set(side * headR * (0.4 + row * 0.18), headR * 0.7, -headR * (0.1 + row * 0.45));
      horn.rotation.set(-0.5 - row * 0.25, 0, side * (0.3 + row * 0.15));
      headGroup.add(horn);
    }
    if (form.horns > 0) disposables.push(hornGeo);
    else hornGeo.dispose();
  }

  /* ------------------------------------------------------------------ legs */

  /**
   * Legs come in pairs spread along the trunk, so 6 legs read as an insect and
   * 2 as a biped without needing a different body for each. A floating creature
   * gets none and hovers instead.
   */
  const legs: Array<{
    mesh: THREE.Object3D;
    /** Knee. Idles off the hip; a kick drives it directly via `legFold`. */
    knee: THREE.Object3D;
    side: number;
    phase: number;
    baseY: number;
    /**
     * The one leg a kick comes off, decided here rather than per frame.
     *
     * A move that throws a leg has to throw the *same* leg every time, or a
     * combo of two kicks alternates feet for no reason and a repeated move
     * reads as a shuffle. Front-most pair, right side: front because that is
     * the leg a forward-facing body has furthest into the strike, and one
     * fixed side because a fighter has a stance.
     */
    lead: boolean;
  }> = [];
  const pairs = form.limbCount / 2;
  if (pairs > 0) {
    // `hipY`, `legLength` and `legRadius` are decided up in the proportions
    // block, because the trunk's own height is derived from them — the body is
    // built from the floor up so that a stubby leg still plants its foot.
    for (let pair = 0; pair < pairs; pair += 1) {
      // One pair sits under the middle; more pairs spread from front to back.
      const spread = pairs === 1 ? 0 : (pair / (pairs - 1) - 0.5) * length * 0.72;
      for (const side of [-1, 1]) {
        const limb = buildLimb(
          {
            length: legLength,
            rootRadius: legRadius,
            // Barely tapered. A limb this short reads as a bottle when the
            // ankle is two thirds of the hip — the flare at the bottom is the
            // boot's job, not the shin's.
            tipRadius: legRadius * LEG_TAPER,
            // The joint masses are there to keep the surface unbroken through a
            // stride, and on a long leg they can bulge proud of the shaft to do
            // it. On a short one the same bulge is most of the limb, so it is
            // pulled back to barely past the shaft.
            joint: legLength > legRadius * 3.4 ? 1.25 : 1.08,
            // A paw block brings its own foot, so the lofted one would clash.
            foot: !plan?.foot,
          },
          bodyMat,
        );
        limb.pivot.position.set(side * (width * 0.34 + legRadius), hipY, spread);
        // Insect legs splay outward; everything else keeps them under the body.
        if (form.bodyShape === "insectoid") limb.pivot.rotation.z = side * 0.42;
        // Resting flex, so a standing creature is not balanced on two poles.
        limb.joint.rotation.x = LEG_REST_FLEX;
        // A paw block hangs off the knee rather than the hip, so it rides the
        // lower leg the way a real foot does.
        if (plan?.foot) {
          const foot = buildBlock(plan.foot, blockCtx);
          foot.scale.setScalar(0.085 * form.scale);
          foot.position.y = -(legLength * 0.48);
          limb.joint.add(foot);
        }
        // Hip cap over the socket, greave down the shin, glow band at the
        // ankle. The cap goes on the pivot and the rest on the knee, so each
        // piece rides the part of the leg it belongs to through a stride.
        wear(limb.pivot, dressLimb({ length: legLength, rootRadius: legRadius, tipRadius: legRadius * LEG_TAPER, cap: true }));
        rig.add(limb.pivot);
        disposables.push(...limb.geometries);
        legs.push({
          mesh: limb.pivot,
          knee: limb.joint,
          side,
          phase: pair * 1.7 + (side > 0 ? Math.PI : 0),
          baseY: hipY,
          lead: pair === pairs - 1 && side > 0,
        });
      }
    }
  }

  /* ------------------------------------------------------------------ arms */

  const arms: Array<{
    mesh: THREE.Object3D;
    /** Elbow. Idles off the shoulder; a punch drives it via `armFold`. */
    elbow: THREE.Object3D;
    side: number;
    baseY: number;
    /** The hand a punch is thrown with — same reasoning as the lead leg. */
    lead: boolean;
  }> = [];
  if (form.arms) {
    // Chibi arms are short and thick — they read as reaching mid-thigh, not
    // past the knee — and are sized off the body like the legs are, so they
    // stay in proportion at every silhouette rather than at a fixed radius.
    // `armSpan` scales that: 1 is the default reach, and the form's parser
    // pushes it out to ~1.4 for a body the player said has long arms.
    const armLength = height * 0.62 * form.armSpan;
    // Reach and thickness trade off, or a long arm reads as a longer club
    // rather than a longer arm. Partial, not proportional — an arm that thins
    // in step with its length ends up a wire.
    const armRadius = Math.min(width, height) * 0.22 * (1 - (form.armSpan - 1) * 0.3);
    for (const side of [-1, 1]) {
      const limb = buildLimb(
        {
          length: armLength,
          rootRadius: armRadius,
          tipRadius: armRadius * ARM_TAPER,
          joint: armLength > armRadius * 3.4 ? 1.25 : 1.08,
        },
        bodyMat,
      );
      const baseY = trunkY + height * 0.26;
      // Shoulders sit on the chest, not out on stalks: the socket mass at the
      // pivot covers the join, so the arm can start much closer to the body.
      limb.pivot.position.set(
        side * (width * 0.42 + armRadius * 0.6),
        baseY,
        shape.upright ? 0 : frontZ * 0.5,
      );
      limb.pivot.rotation.z = side * 0.14;
      limb.joint.rotation.x = ARM_REST_FLEX;
      // Same trick as the feet: the hand hangs off the forearm, so swipe and
      // flare move the paw without the animation pass knowing it is there.
      if (plan?.hand) {
        const hand = buildBlock(plan.hand, blockCtx);
        hand.scale.setScalar(0.08 * form.scale);
        hand.scale.x *= side;
        hand.position.y = -(armLength * 0.46);
        limb.joint.add(hand);
      }
      // Shoulder cap and bracer, the arm's counterpart to the leg's set.
      wear(limb.pivot, dressLimb({ length: armLength, rootRadius: armRadius, tipRadius: armRadius * ARM_TAPER, cap: true }));
      rig.add(limb.pivot);
      disposables.push(...limb.geometries);
      // Named so an arm is findable in the scene graph from a debug console.
      limb.pivot.name = `arm-${side > 0 ? "r" : "l"}`;
      limb.joint.name = `elbow-${side > 0 ? "r" : "l"}`;
      arms.push({ mesh: limb.pivot, elbow: limb.joint, side, baseY, lead: side > 0 });
    }
  }

  /* ----------------------------------------------------------------- wings */

  /**
   * Wings hang off pivot groups rather than being positioned directly, because
   * every wing channel is a rotation about the shoulder: flap turns the pivot
   * about Z, wrap turns it about Y to fold the wing across the body.
   */
  const wings: Array<{ pivot: THREE.Group; side: number }> = [];
  if (form.wings > 0) {
    const wingPairs = form.wings / 2;
    const span = Math.max(0.3, length * 0.85);
    /**
     * Shape comes from the theme — feathers on a bird, veined panels on an
     * insect, panelled hard surfaces on a construct, a membrane on everything
     * else — and each wing is built as a right wing that the builder reflects
     * for the left side, so a pair is symmetric by construction rather than by
     * two separate placements happening to agree.
     */
    const style = wingStyleFor(form.theme);
    const wingMaterials = { membrane: membraneMat, bone: bodyMat, accent: accentMat };
    for (let pair = 0; pair < wingPairs; pair += 1) {
      const zOffset = wingPairs === 1 ? -length * 0.05 : (pair === 0 ? length * 0.16 : -length * 0.24);
      // A second pair is the hind pair: shorter, so it reads as a pair rather
      // than as one wing doubled.
      const pairSpan = span * (pair === 0 ? 1 : 0.76);
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        // Named so a wing is findable in the scene graph from a debug console.
        pivot.name = `wing-pivot-${pair}-${side > 0 ? "r" : "l"}`;
        pivot.position.set(side * width * 0.42, spineY, zOffset);
        const wing = buildWing({ style, span: pairSpan, side, materials: wingMaterials });
        wing.group.name = `wing-${pair}-${side > 0 ? "r" : "l"}`;
        pivot.add(wing.group);
        rig.add(pivot);
        disposables.push(...wing.geometries);
        wings.push({ pivot, side });
      }
    }
  }

  /* ---------------------------------------------------------------- spikes */

  /** Spikes run along the spine from front to back and stand up when flared. */
  const spikes: Array<{
    mesh: THREE.Mesh;
    baseY: number;
    baseScale: number;
    baseTilt: number;
  }> = [];
  if (form.spikes > 0) {
    const spikeGeo = new THREE.ConeGeometry(0.03 * form.scale, 0.13 * form.scale, 6);
    // A round trunk has no ridge to stand a spike on: laying them along a flat
    // spine line buries every cone inside the sphere, so an orb rides its own
    // surface instead and each spike leans along the outward normal.
    const orbR = Math.max(width, height) * 0.62;
    const round = form.bodyShape === "orb";
    const spread = round ? orbR * 1.5 : length * 0.95;
    const start = round ? orbR * 0.72 : frontZ * 0.65;
    for (let index = 0; index < form.spikes; index += 1) {
      const ratio = form.spikes === 1 ? 0.5 : index / (form.spikes - 1);
      const spike = new THREE.Mesh(spikeGeo, accentMat);
      const z = start - ratio * spread;
      // Tallest over the shoulders, tapering toward the tail.
      const taper = 0.7 + Math.sin((1 - ratio) * Math.PI * 0.8) * 0.5;
      let y = spineY + 0.04 * form.scale;
      let tilt = -0.25 - ratio * 0.35;
      if (round) {
        const rise = Math.sqrt(Math.max(0.0001, orbR * orbR - z * z));
        y = trunkY + rise;
        tilt = Math.atan2(z, rise);
      }
      spike.position.set(0, y, z);
      spike.scale.setScalar(taper);
      spike.rotation.x = tilt;
      rig.add(spike);
      spikes.push({ mesh: spike, baseY: y, baseScale: taper, baseTilt: tilt });
    }
    disposables.push(spikeGeo);
  }

  /* ------------------------------------------------------------------ tail */

  /**
   * The tail is a chain of shrinking segments on one pivot. Swing rotates the
   * pivot; the segments each lag a little further behind it, which is what
   * makes a whip crack travel out to the tip instead of the whole tail moving
   * as one rigid arm.
   */
  const tailPivot = new THREE.Group();
  /**
   * What the whip travels down. `lag` is how far behind the pivot each link
   * sits: the primitive spheres are siblings, so their lags grow along the
   * chain, while a block tail's joints are nested, so each one carries the
   * same small delta and the nesting adds them up on its own.
   */
  const tailSegments: Array<{ object: THREE.Object3D; lag: number }> = [];
  const tailDims = TAIL_DIMS[form.tail];
  if (tailDims.segments > 0 && plan?.tail) {
    tailPivot.position.set(0, trunkY + height * 0.1, backZ);
    rig.add(tailPivot);
    const tailBlock = buildBlock(plan.tail, blockCtx);
    // Authored over unit length running to -Z, which is the direction the
    // primitive chain already grew in — so scale is all it takes to fit.
    tailBlock.scale.setScalar(tailDims.length * form.scale);
    tailPivot.add(tailBlock);
    for (const joint of collectJoints(tailBlock)) tailSegments.push({ object: joint, lag: 0.09 });
  } else if (tailDims.segments > 0) {
    tailPivot.position.set(0, trunkY + height * 0.1, backZ);
    rig.add(tailPivot);
    const step = (tailDims.length * form.scale) / tailDims.segments;
    for (let index = 0; index < tailDims.segments; index += 1) {
      const ratio = index / tailDims.segments;
      const radius = tailDims.girth * form.scale * (1 - ratio * 0.65);
      const segGeo = new THREE.SphereGeometry(Math.max(0.012, radius), 10, 8);
      const segment = new THREE.Mesh(segGeo, index === tailDims.segments - 1 && form.glow > 0.4 ? glowMat : bodyMat);
      segment.position.z = -step * (index + 1);
      segment.position.y = -step * index * 0.28;
      tailPivot.add(segment);
      tailSegments.push({ object: segment, lag: (index + 1) * 0.12 });
      disposables.push(segGeo);
    }
    // A plume tail ends in a fan; a lash ends in a lit barb.
    if (form.tail === "plume") {
      const fanGeo = new THREE.ConeGeometry(0.1 * form.scale, 0.2 * form.scale, 6);
      const fan = new THREE.Mesh(fanGeo, membraneMat);
      fan.rotation.x = -Math.PI / 2;
      fan.position.z = -step * (tailDims.segments + 0.6);
      fan.position.y = -step * tailDims.segments * 0.28;
      tailPivot.add(fan);
      disposables.push(fanGeo);
    } else if (form.tail === "lash") {
      const barbGeo = new THREE.ConeGeometry(0.035 * form.scale, 0.12 * form.scale, 6);
      const barb = new THREE.Mesh(barbGeo, glowMat);
      barb.rotation.x = -Math.PI / 2;
      barb.position.z = -step * (tailDims.segments + 0.5);
      barb.position.y = -step * tailDims.segments * 0.28;
      tailPivot.add(barb);
      disposables.push(barbGeo);
    }
  }

  /* ------------------------------------------------------------------ core */

  // The lit core every creature carries, sitting in the chest. This is the part
  // the glow channels drive hardest, so a burst reads even on a matte body.
  const coreGeo = new THREE.IcosahedronGeometry(0.06 * form.scale * (1 + form.glow * 0.5), 1);
  const core = new THREE.Mesh(coreGeo, glowMat);
  const coreBaseY = trunkY + height * 0.08;
  core.position.set(0, coreBaseY, shape.upright ? length * 0.34 : frontZ * 0.45);
  rig.add(core);
  disposables.push(coreGeo);

  /* ------------------------------------------------------------ level tiers */

  /**
   * Level tiers. A levelled loadout should be readable across a park, not just
   * in a stats panel — so each tier grows more of the creature's own vocabulary
   * onto the same body: plating, crests, extra spines, then a crest halo. Built
   * once and toggled by `applyForm`, so a booster levelling mid-session changes
   * the silhouette immediately without rebuilding the mesh or leaking geometry.
   */
  const formTiers: Array<{ minLevel: number; parts: THREE.Object3D[] }> = [];
  const tierParts: Array<{ object: THREE.Object3D; baseY: number }> = [];

  /* ------------------------------------------------------------- accessory */

  /**
   * The block set's one piece of jewellery, mounted where the plan asks for it.
   * A head mount rides the head group and so inherits the bob for free; a neck
   * or back mount sits on the rig and is registered as a bob-riding part, the
   * same way the level tiers are, so it never floats away from the body. It is
   * not level-gated — nothing is pushed into `formTiers` — so it is always on.
   */
  if (plan?.accessory) {
    const accessory = buildBlock(plan.accessory, blockCtx);
    if (plan.accessoryMount === "head") {
      // Sat on the brow of the head block, tilted back to follow the skull's
      // curve so the stone lies against it instead of standing off the front.
      accessory.scale.setScalar(skullR * 0.34);
      accessory.position.set(0, skullR * 0.6, skullR * 0.68);
      accessory.rotation.x = -0.7;
      headGroup.add(accessory);
    } else if (plan.accessoryMount === "neck") {
      accessory.scale.setScalar(Math.max(width, headR * 2) * 0.62);
      const y = shape.upright ? trunkY + height * 0.42 : trunkY + height * 0.3;
      accessory.position.set(0, y, shape.upright ? length * 0.12 : frontZ * 0.72);
      rig.add(accessory);
      tierParts.push({ object: accessory, baseY: y });
    } else {
      accessory.scale.setScalar(Math.max(width, height) * 0.55);
      accessory.position.set(0, spineY + 0.02 * form.scale, shape.upright ? -length * 0.18 : backZ * 0.35);
      rig.add(accessory);
      tierParts.push({ object: accessory, baseY: accessory.position.y });
    }
  }

  // Level 2 — flank plating over the trunk.
  const plateGeo = new THREE.BoxGeometry(width * 0.3, height * 0.42, 0.028 * form.scale);
  const plates = [-1, 1].map((side) => {
    const plate = new THREE.Mesh(plateGeo, accentMat);
    plate.position.set(side * width * 0.42, trunkY + height * 0.05, shape.upright ? length * 0.3 : frontZ * 0.3);
    plate.rotation.y = side * 0.35;
    rig.add(plate);
    tierParts.push({ object: plate, baseY: plate.position.y });
    return plate;
  });
  formTiers.push({ minLevel: 2, parts: plates });
  disposables.push(plateGeo);

  // Level 3 — shoulder crests.
  const crestGeo = new THREE.SphereGeometry(0.075 * form.scale, 12, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  const crests = [-1, 1].map((side) => {
    const crest = new THREE.Mesh(crestGeo, bodyMat);
    crest.position.set(side * (width * 0.5 + 0.02), spineY, shape.upright ? 0 : frontZ * 0.4);
    crest.rotation.z = side * 0.3;
    rig.add(crest);
    tierParts.push({ object: crest, baseY: crest.position.y });
    return crest;
  });
  formTiers.push({ minLevel: 3, parts: crests });
  disposables.push(crestGeo);

  // Level 4 — a second row of spines down the back.
  const finGeo = new THREE.ConeGeometry(0.03 * form.scale, 0.15 * form.scale, 5);
  const fins = [-1, 0, 1].map((slot) => {
    const fin = new THREE.Mesh(finGeo, glowMat);
    fin.position.set(slot * width * 0.3, spineY + 0.02 * form.scale, backZ * 0.45);
    fin.rotation.x = 0.5;
    rig.add(fin);
    tierParts.push({ object: fin, baseY: fin.position.y });
    return fin;
  });
  formTiers.push({ minLevel: 4, parts: fins });
  disposables.push(finGeo);

  // Level 5 — a crest halo that keeps turning above the head.
  const haloGeo = new THREE.TorusGeometry(0.11 * form.scale, 0.012 * form.scale, 8, 24);
  const halo = new THREE.Mesh(haloGeo, glowMat);
  halo.rotation.x = Math.PI / 2;
  const haloOffsetY = 0.18 * form.scale;
  halo.position.set(headBase.x, headBase.y + haloOffsetY, headBase.z);
  rig.add(halo);
  formTiers.push({ minLevel: 5, parts: [halo] });
  disposables.push(haloGeo);

  /** Show the hardware this level has earned, and nothing above it. */
  let glowBoost = 0;
  function applyForm(level: number) {
    const clamped = Math.max(1, Math.min(5, Math.round(level)));
    for (const tier of formTiers) {
      for (const part of tier.parts) part.visible = clamped >= tier.minLevel;
    }
    // The creature runs hotter as the loadout does.
    glowBoost = clamped >= 5 ? 0.5 : clamped >= 3 ? 0.22 : 0;
  }
  applyForm(config.level ?? 1);

  /* ---------------------------------------------------- ring and shockwave */

  // Ground ring: sells the placement more than any amount of mesh detail.
  const ringRadius = Math.max(0.24, length * 0.5 + 0.06);
  const ringGeo = new THREE.RingGeometry(ringRadius * 0.85, ringRadius, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(form.palette.glowColor),
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  group.add(ring);
  disposables.push(ringGeo, ringMat);

  // Shockwave: a second ring that only exists while a slam or a burst is
  // running, expanding outward and fading as it goes.
  const shockGeo = new THREE.RingGeometry(ringRadius * 0.9, ringRadius, 40);
  const shockMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(form.palette.glowColor),
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  });
  const shockRing = new THREE.Mesh(shockGeo, shockMat);
  shockRing.rotation.x = -Math.PI / 2;
  shockRing.position.y = 0.015;
  shockRing.visible = false;
  group.add(shockRing);
  disposables.push(shockGeo, shockMat);

  // Ground scuff: a soft disc at the feet that a dash, a landing or a tail tip
  // dragging through the dirt kicks up. Neutral in colour, because it is floor
  // rather than creature, and flat enough to read on any surface in AR.
  // Sized against the ground ring deliberately: a scuff hugs the footprint, so
  // it sits just inside and just outside that ring. Reaching much past it turns
  // the effect into a dinner plate spilling out of frame.
  const dustGeo = new THREE.RingGeometry(ringRadius * 0.72, ringRadius * 1.18, 32);
  const dustMat = new THREE.MeshBasicMaterial({
    color: 0xd8cfc0,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const dustRing = new THREE.Mesh(dustGeo, dustMat);
  dustRing.rotation.x = -Math.PI / 2;
  dustRing.position.y = 0.008;
  dustRing.visible = false;
  group.add(dustRing);
  disposables.push(dustGeo, dustMat);

  // Aura shell: a sphere of the creature's own glow that expands through the
  // body and fades, for the moves that release something rather than swing it.
  const auraGeo = new THREE.SphereGeometry(Math.max(0.16, length * 0.3), 18, 12);
  const auraMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(form.palette.glowColor),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const auraShell = new THREE.Mesh(auraGeo, auraMat);
  auraShell.visible = false;
  group.add(auraShell);
  disposables.push(auraGeo, auraMat);

  /* ------------------------------------------------------ health and bubble */

  const barY = Math.max(headBase.y, spineY) + 0.26 * form.scale;
  const healthBar = new THREE.Group();
  const barBackGeo = new THREE.PlaneGeometry(0.42, 0.045);
  const barBackMat = new THREE.MeshBasicMaterial({ color: 0x10151d, transparent: true, opacity: 0.8 });
  healthBar.add(new THREE.Mesh(barBackGeo, barBackMat));
  const barFillGeo = new THREE.PlaneGeometry(0.4, 0.028);
  const barFillMat = new THREE.MeshBasicMaterial({ color: 0xb6f03c });
  const barFill = new THREE.Mesh(barFillGeo, barFillMat);
  barFill.position.z = 0.001;
  healthBar.add(barFill);
  healthBar.position.y = barY;
  group.add(healthBar);
  disposables.push(barBackGeo, barBackMat, barFillGeo, barFillMat);

  const bubble = createSpeechBubble(accent);
  group.add(bubble.sprite);

  /* ----------------------------------------------------------------- state */

  const flashColor = new THREE.Color(0xff3b30);
  const glowColor = new THREE.Color(form.palette.glowColor);
  const whiteHot = new THREE.Color(0xffffff);
  let flashUntil = 0;
  let health = 1;
  let state: AnimationState = "idle";
  let stateStartedAt = 0;
  let lastElapsed = 0;
  const channels = blankChannels();
  /** When the current flinch layer started, or -1 for "not flinching". */
  let flinchStartedAt = -1;

  /**
   * Seconds of animation time swallowed by hitstop so far.
   *
   * The stage hands out absolute elapsed seconds, so a freeze cannot simply
   * stop calling update — the body still has to render, and the bubble and the
   * damage flash still have to run. Instead the *animation* clock is held back:
   * every frozen frame's delta accumulates here and is subtracted from elapsed
   * before the curves see it, so the move holds the exact frame it was on and
   * resumes from there rather than jumping to where it would have got to.
   */
  let clockHeld = 0;
  /**
   * Seconds of freeze still owed, counted down on wall time.
   *
   * It has to be wall time. This used to be a deadline on the animation clock
   * — and that clock is exactly the thing a freeze stops, so the deadline it
   * was waiting for could never arrive: the first hitstop of a fight froze the
   * body permanently. The body still walked, because the stage moves the group
   * and the stage's clock kept running, but every curve, spring and breath
   * below held one frame forever and no move ever looked like anything again.
   */
  let holdRemaining = 0;

  /**
   * The blow this body is currently reeling from: which way it came from, how
   * heavy it was, whether it was caught on a guard, and when it landed.
   *
   * Direction is stored as a unit vector in this body's own local space, which
   * is what makes the reaction directional — the curves write along local axes
   * (`push` is +Z, `sway` is +X), so a blow arriving from the left shoves the
   * body right along exactly the axis the animation already speaks in.
   */
  let blowStartedAt = -1;
  let blowX = 0;
  let blowZ = 1;
  let blowWeight = 0;
  let blowBlocked = false;
  /**
   * How long a reel runs. Longer than a flinch — a flinch is a twitch, this is
   * the body's weight actually moving and coming back — but still shorter than
   * the shortest move, so it accents rather than replaces whatever is playing.
   */
  const REEL_SECONDS = 0.46;

  /**
   * The pose the body was holding when the move it is playing now took over,
   * and when that happened.
   *
   * Every curve starts at t = 0 with every channel at zero, which is only the
   * right place to start from if the body was already at rest. It usually is
   * not: a block interrupts a half-finished swing, a second hit re-triggers a
   * flinch that is still running. Without this the body teleports to neutral on
   * the frame the new move starts — the single most visible stiffness in the
   * old system, and the one no amount of curve tuning could reach.
   *
   * So the outgoing pose is kept and decayed out underneath the incoming curve,
   * which is ramping up from nothing over the same moment. The sum leaves the
   * old pose smoothly and arrives in the new one.
   */
  const residual = blankChannels();
  let residualStartedAt = -1;
  const RESIDUAL_SECONDS = 0.2;
  /**
   * The pose actually rendered last frame, kept so a switch has something to
   * carry. The live `channels` is wiped to neutral at the top of every update
   * before the curves rewrite it, so by the time a state change is noticed the
   * outgoing pose is already gone from it — this is the copy that survives.
   *
   * Taken after the springs, so it is the pose that was on screen rather than
   * the one the curves asked for.
   */
  const prevPose = blankChannels();
  /** Hand the last rendered pose to the decay layer, starting from now. */
  const carryPose = () => {
    for (const key of POSE_KEYS) residual[key] = prevPose[key];
    residualStartedAt = lastElapsed;
  };

  /**
   * Secondary motion, as one spring per limb group.
   *
   * The curves say where a part is being driven to; this decides how it gets
   * there. Everything used to read its channel on the frame it was written, so
   * the torso, the arms, the wings and the tail all hit their extremes on the
   * same frame — which is exactly what reads as one carved piece being posed
   * rather than a body with weight hanging off it.
   *
   * Each group instead chases its channel on its own spring, deliberately
   * under-damped so it overshoots and comes back: that overshoot *is* the
   * follow-through, the arm carrying past the end of the swing. Heavier and
   * looser things are tuned lower, so a tail whips long after the hips have
   * stopped, while the head tracks tight because a bite has to land on its
   * frame.
   *
   * `hz` is the spring's frequency and `zeta` its damping ratio: 1 arrives and
   * stops, and below 1 overshoots by more the lower it goes.
   */
  const TRAIL_TUNING: ReadonlyArray<{ key: keyof Channels; hz: number; zeta: number }> = [
    { key: "armSwing", hz: 6.5, zeta: 0.52 },
    { key: "armFlare", hz: 7.5, zeta: 0.62 },
    { key: "headPush", hz: 11, zeta: 0.75 },
    { key: "wingFlap", hz: 4.6, zeta: 0.48 },
    { key: "wingWrap", hz: 6, zeta: 0.85 },
    { key: "tailSwing", hz: 3.6, zeta: 0.42 },
    { key: "spikeFlare", hz: 9, zeta: 0.7 },
  ];
  const trail = TRAIL_TUNING.map((tune) => ({
    ...tune,
    stiffness: (2 * Math.PI * tune.hz) ** 2,
    damping: 2 * tune.zeta * (2 * Math.PI * tune.hz),
    value: 0,
    velocity: 0,
  }));
  /**
   * The head's own lag behind the torso's lean, on the same idea: a body tips
   * and the head follows a beat later, which is most of what separates a look
   * that is alive from a mannequin on a turntable.
   */
  let headLean = 0;
  let headLeanVelocity = 0;
  const HEAD_LEAN_STIFFNESS = (2 * Math.PI * 7) ** 2;
  const HEAD_LEAN_DAMPING = 2 * 0.65 * (2 * Math.PI * 7);
  /**
   * Springs are integrated at a fixed step regardless of the frame rate: at
   * these stiffnesses a 60ms frame integrated in one go is unstable and the
   * limb flies off, and a phone dropping frames must not be able to explode a
   * character. 240Hz, capped, so a long frame costs a bounded number of steps.
   */
  const SPRING_STEP = 1 / 240;
  const SPRING_MAX_STEPS = 24;
  /**
   * The longest any one blow may freeze the body for, in seconds. A backstop:
   * hitstop is scaled from a blow's weight upstream, and this only exists so a
   * junk or runaway value cannot park the animation clock.
   */
  const HOLD_MAX_SECONDS = 0.4;

  return {
    group,
    form,
    update(wallElapsed, paused) {
      // The stage hands out elapsed seconds, not a delta; the bubble fades on
      // wall-clock time, so derive one here and clamp it — a backgrounded tab
      // resumes with a multi-second jump that would otherwise skip the fade.
      const wallDt = Math.min(0.1, Math.max(0, wallElapsed - clockHeld - lastElapsed));
      // Hitstop: while the freeze is live the animation clock stops advancing,
      // so every curve, spring and layer below holds the frame it was on. The
      // delta the freeze ate is banked in `clockHeld` and stays subtracted
      // forever after, which is what makes the move resume from where it was
      // frozen instead of snapping ahead to catch up with wall time.
      let frozen = false;
      if (holdRemaining > 0) {
        // Spend the freeze against the wall delta, not against the clock it is
        // holding — the held clock does not advance, so it can never pay this
        // down. Whatever is left over rolls into the next frame.
        holdRemaining = Math.max(0, holdRemaining - wallDt);
        clockHeld += wallDt;
        frozen = true;
      }
      const elapsed = wallElapsed - clockHeld;
      lastElapsed = elapsed;
      // Springs integrate on the animation clock, so they hold too — a limb
      // caught mid-overshoot must stop there, not keep travelling through a
      // freeze that is supposed to be a still frame.
      const dt = frozen ? 0 : wallDt;

      /* ------------------------------------------------------------- idle */

      // Idle is breathing plus sway: a slow vertical bob with a matching
      // chest expansion on the same phase, and a lateral drift on a longer,
      // unrelated period so the two never lock into a mechanical loop.
      const breathPhase = elapsed * 2.2;
      const bob = paused ? 0 : Math.sin(breathPhase) * 0.02 * form.scale;
      const breath = paused ? 0 : Math.sin(breathPhase) * 0.035;
      const idleSway = paused ? 0 : Math.sin(elapsed * 0.9) * 0.014;
      const idleTilt = paused ? 0 : Math.sin(elapsed * 0.9 + 0.5) * 0.03;
      // A floating creature has no legs to stand on, so it bobs further and
      // keeps moving even when combat is paused.
      const hover = floats ? Math.sin(elapsed * 1.3) * 0.035 * form.scale : 0;

      /* -------------------------------------------------------- reactions */

      const c = channels;
      Object.assign(c, blankChannels());
      c.sway = idleSway;
      c.roll = idleTilt;

      const duration = DURATION[state];
      if (state !== "idle" && duration > 0) {
        // Clamped low: a clock that jumps backwards (a resumed tab, a stage
        // that restarts its timer) would otherwise feed negative t into the
        // curves, where the decaying exponentials blow up to Infinity.
        const t = Math.max(0, (elapsed - stateStartedAt) / duration);
        if (t >= 1) {
          state = "idle";
          // A curve ends at rest, but the springs behind it do not: the arms
          // and tail are still travelling on the frame the move expires. Carry
          // the pose out so idle picks it up mid-flight instead of the body
          // arriving at neutral the instant the clock runs out.
          carryPose();
        } else {
          const curve = CURVES[state as Exclude<AnimationState, "idle">];
          const before = { sway: c.sway, roll: c.roll };
          curve(t, c, intensity, agility);
          // Moves that do not touch sway or roll keep the idle's own drift,
          // rather than snapping the body to dead centre for the duration.
          if (c.sway === 0) c.sway = before.sway;
          if (c.roll === 0) c.roll = before.roll;
        }
      }

      // The pose the last move was holding, decaying out from under whatever
      // took over from it. Pose channels only: carrying an expanding ring's
      // progress across a switch would restart the ring.
      if (residualStartedAt >= 0) {
        const age = (elapsed - residualStartedAt) / RESIDUAL_SECONDS;
        if (age >= 1) residualStartedAt = -1;
        else {
          // Full weight at the switch, easing to nothing — and to zero slope,
          // so the hand-over does not end in a twitch of its own.
          const w = 1 - age * age * (3 - 2 * age);
          for (const key of POSE_KEYS) c[key] += residual[key] * w;
        }
      }

      // A flinch is a layer, not a state: it adds onto whatever curve is
      // already running, so a body that is mid-block still visibly registers
      // the hit it just took instead of swallowing it. Additive and short, and
      // every term rides a `beat`, so it starts and ends at rest.
      if (flinchStartedAt >= 0) {
        const f = (elapsed - flinchStartedAt) / FLINCH_SECONDS;
        if (f >= 1) flinchStartedAt = -1;
        else {
          const kick = beat(f, 0, 1, 0.45) * intensity;
          c.glowFlash += kick * 0.45;
          c.lean += kick * 0.05;
          // The flick travels out along the tail and the wings snap once —
          // both only on a body that has them, so a legless orb just pulses.
          if (tailSegments.length > 0) c.tailSwing += Math.sin(f * Math.PI * 2) * kick * 0.4;
          if (wings.length > 0) c.wingFlap += kick * 0.35;
        }
      }

      /**
       * Reeling from a blow: a directional layer on top of everything else.
       *
       * The old reaction recoiled along the same local axes no matter where the
       * hit came from, so every blow looked like the same blow. This one is
       * driven by the direction the hit arrived from, and it separates the two
       * halves of what taking a hit looks like:
       *
       * - the *shove*, a hard displacement away from the blow that arrives
       *   almost instantly and decays — the body giving ground;
       * - the *fold*, the body bending around the impact and coming back,
       *   which runs slower and settles.
       *
       * A blocked hit is not a smaller version of a clean one, it is a
       * different shape: the guard holds, so the body barely folds and instead
       * gets pushed bodily backwards with a spark where the blow met it. That
       * read is the only thing that told the player "that was blocked" and it
       * previously existed in sound alone.
       */
      if (blowStartedAt >= 0) {
        const b = (elapsed - blowStartedAt) / REEL_SECONDS;
        if (b >= 1) blowStartedAt = -1;
        else {
          const w = blowWeight * intensity;
          // Fast in, slow out: an impact has no wind-up. `impulse` is the
          // decaying spike the hit reaction already uses, so a reel and a
          // `hit_react` curve agree about the shape of a blow arriving.
          const shove = impulse(b, blowBlocked ? 5 : 3.4) * w;
          const fold = beat(b, 0, 1, 0.5) * w;

          // Away from the blow, which is why the direction is negated: the
          // vector points at the attacker, the body goes the other way. Both
          // axes, so a hit taken off the shoulder shoves diagonally instead of
          // resolving to straight back.
          const give = shove * (blowBlocked ? 0.1 : 0.14);
          c.push -= blowZ * give;
          c.sway -= blowX * give;

          if (blowBlocked) {
            // The guard catching it: a hard bright spark at the point of
            // contact, the body squaring up rather than crumpling, and the
            // feet scuffing as they are pushed back.
            c.glowFlash += Math.min(1, shove * 1.5);
            c.spikeFlare += fold * 0.3;
            c.squash += shove * 0.05;
            c.dust += shove * 0.5;
            // A guard flexes against the blow instead of turning away from it.
            c.lean -= blowZ * fold * 0.06;
            if (wings.length > 0) c.wingWrap += fold * 0.25;
          } else {
            // A clean hit folds the body around where it landed and rattles it
            // — the torso pitches away, the weight rolls off the struck side,
            // and the limbs are thrown along the same line.
            c.lean -= blowZ * fold * 0.3;
            c.roll += blowX * fold * 0.26;
            c.spin -= blowX * fold * 0.2;
            c.squash += fold * 0.12;
            c.armSwing += fold * 0.5;
            c.headPush -= blowZ * fold * 0.1;
            c.glowFlash += fold * 0.3;
            if (tailSegments.length > 0) c.tailSwing -= blowX * fold * 0.7;
            // Heavy blows drive the body down into the floor and kick up what
            // it was standing on; light ones do not, so a claw swipe does not
            // raise the same cloud as a slam.
            if (blowWeight > 0.5) c.dust += (blowWeight - 0.5) * 2 * shove * 0.8;
          }
        }
      }

      /* -------------------------------------------------- secondary motion */

      // Limbs chase what the curves asked for instead of snapping to it, each
      // on its own spring, so the torso leads and the extremities trail and
      // overshoot. Channels are overwritten with the sprung value, which means
      // every part of the body downstream — including the armour dressing that
      // rides each limb — inherits the follow-through for free.
      const steps = Math.max(1, Math.min(SPRING_MAX_STEPS, Math.ceil(dt / SPRING_STEP)));
      const step = dt > 0 ? dt / steps : 0;
      for (const part of trail) {
        const target = c[part.key];
        for (let n = 0; n < steps; n += 1) {
          part.velocity += ((target - part.value) * part.stiffness - part.damping * part.velocity) * step;
          part.value += part.velocity * step;
        }
        if (!Number.isFinite(part.value) || !Number.isFinite(part.velocity)) {
          part.value = target;
          part.velocity = 0;
        }
        c[part.key] = part.value;
      }
      const leanTarget = c.lean;
      for (let n = 0; n < steps; n += 1) {
        headLeanVelocity +=
          ((leanTarget - headLean) * HEAD_LEAN_STIFFNESS - HEAD_LEAN_DAMPING * headLeanVelocity) * step;
        headLean += headLeanVelocity * step;
      }
      if (!Number.isFinite(headLean) || !Number.isFinite(headLeanVelocity)) {
        headLean = leanTarget;
        headLeanVelocity = 0;
      }

      // The pose as it is about to be rendered, banked for whatever interrupts
      // it. Pose channels only — an effect channel's value is progress through
      // an expanding ring, and decaying that out would run the ring backwards.
      for (const key of POSE_KEYS) prevPose[key] = c[key];

      /**
       * How far off the ground the body is, 0–1, scaled against a jump that
       * clears its own standing height. Read by the parts that only make sense
       * with the floor underneath them: legs tuck, the ground ring shrinks
       * back like a shadow, and scuffed dust stops arriving.
       */
      const airborne = Math.min(1, Math.max(0, c.lift) / Math.max(0.08, 0.22 * form.scale));

      /* ------------------------------------------------------------- body */

      // Body segments ride the bob, and long bodies carry a travelling wave so
      // a serpent undulates rather than sliding along as one piece.
      for (const segment of segments) {
        const lag = segment.offset * 2.4;
        const wave = segments.length > 1 && !paused ? Math.sin(breathPhase - lag) * 0.012 * form.scale : 0;
        segment.mesh.position.y = segment.baseY + bob + hover + wave;
        segment.mesh.position.x = segments.length > 1 && !paused ? Math.sin(elapsed * 1.6 - lag) * 0.02 : 0;
        if (segment === segments[0]) {
          segment.mesh.scale.set(1 + breath * 0.5, 1 - breath * 0.3, (segment.mesh.scale.z || 1));
        }
      }
      if (segments.length === 1 && segments[0]) {
        segments[0].mesh.scale.set(1 + breath * 0.5, 1 - breath * 0.3, 1 + breath * 0.5);
      }

      headGroup.position.set(
        headBase.x,
        headBase.y + bob + hover,
        headBase.z + c.headPush,
      );
      // The head aims where the body is going: a lunge points it forward, a
      // lean-back stance lifts the chin.
      // The head rides the *trailing* lean, not the current one, so it is
      // still coming forward when the torso has already stopped.
      headGroup.rotation.x = -headLean * 0.4 + (paused ? 0 : Math.sin(elapsed * 1.1) * 0.02);
      headGroup.rotation.y = c.spin * 0.25;
      // The jaw opens on anything that thrusts the head.
      jaw.rotation.x = Math.min(0.7, Math.max(0, c.headPush * 3.2 + c.glowFlash * 0.25));

      // Ears run off channels that already exist: they pin back when the head
      // thrusts and twitch on the idle breath, which is enough to stop a block
      // head reading as a static prop between moves.
      for (const [index, pivot] of earPivots.entries()) {
        const side = index === 0 ? -1 : 1;
        const twitch = paused ? 0 : Math.sin(elapsed * 1.7 + index * 2.1) * 0.05;
        pivot.rotation.x = twitch - Math.min(0.5, Math.max(0, c.headPush * 2.4));
        pivot.rotation.z = side * (0.22 + c.spikeFlare * 0.2) + c.sway * 0.4;
      }

      core.position.y = coreBaseY + bob + hover;
      core.rotation.y = elapsed * 1.4;

      /**
       * How one-legged the frame is, read off the thrust itself.
       *
       * A crouch folds every knee and a kick folds one, and rather than add a
       * second channel to say which, the answer is already in `legThrust`: a
       * move that is throwing a leg is by definition doing it with one leg, and
       * a move that is only loading the legs is not throwing anything. So the
       * fold spreads evenly while nothing is thrusting and concentrates onto
       * the lead leg as the thrust comes in — which makes `grapple`'s load,
       * `piston_slam`'s brace and `kick`'s chamber all correct off one rule,
       * and keeps every move written before this channel existed untouched.
       */
      const leadShare = Math.min(1, Math.abs(c.legThrust) * 1.4);

      for (const leg of legs) {
        leg.mesh.position.y = leg.baseY + bob * 0.4;
        // Legs keep a slow alternating idle; a dodge or a charge swings them.
        // Off the ground they fold up under the body — legs left hanging
        // straight down through a jump is the pose that reads as a doll being
        // lifted rather than a creature leaving the floor — and the idle stride
        // fades out, because there is nothing to stride against.
        const grounded = 1 - airborne;
        // The lead leg takes the thrust; the others brace back against it at a
        // third of it, because a body that swings every leg forward at once is
        // a body on the floor. Negative, because positive X on a limb hanging
        // downward swings the foot *behind* the body — the same sign `push`
        // already relies on to make legs trail the torso.
        const thrust = leg.lead ? -c.legThrust : c.legThrust * 0.34;
        leg.mesh.rotation.x =
          (paused ? 0 : Math.sin(breathPhase + leg.phase) * 0.1 * grounded) +
          c.push * 0.9 +
          airborne * 0.55 +
          thrust * 0.95;
        if (form.bodyShape !== "insectoid") leg.mesh.rotation.z = c.sway * 1.2;
        // Knee, on top of the rest flex it has held since the body was built.
        // Floored at straight so a kick can extend fully and never snap the
        // joint the wrong way, and capped so a deep chamber cannot fold the
        // shin back through the thigh.
        const fold = c.legFold * (leg.lead ? 1 : 1 - leadShare);
        leg.knee.rotation.x = Math.max(0, Math.min(1.5, LEG_REST_FLEX + fold));
      }

      for (const [index, arm] of arms.entries()) {
        // The two arms breathe in antiphase, so at any instant one of them is
        // being carried backward by the idle alone. At rest that is the small
        // alternating sway it is meant to be; running at full amplitude
        // *underneath* a strike it is 0.16rad of the wrong direction on the
        // off arm, which is enough to read as that arm swinging back on its
        // own. So the sway yields to whatever the move is driving: a creature
        // throwing a punch is not also idling.
        const driven = Math.min(1, (Math.abs(c.armSwing) * 1.6 + Math.abs(c.armFold)) * 0.9);
        const idle = paused ? 0 : Math.sin(breathPhase + index * Math.PI) * 0.16 * (1 - driven);
        // `armAlternate` blends between both arms taking the swing together
        // (0, which is every move written before categories existed) and the
        // lead arm taking all of it while the off arm counters (1). A blend,
        // so a combo can cross from a two-handed move into a one-sided one
        // without the arms snapping across the body.
        //
        // The off arm counters at a *fraction*, exactly as the off legs brace
        // against the lead leg's thrust at `0.34` above. Mirroring it at full
        // amplitude is what made a punch read as one fist going out and the
        // other being thrown just as hard out the back of the creature: the
        // rear hand travelled as far backward as the lead hand travelled
        // forward, which is not a counter, it is a second punch aimed behind.
        // A third of the swing is a shoulder rolling back under the drive.
        const sided = arm.lead ? 1 : 1 - c.armAlternate * (1 + OFF_ARM_COUNTER);
        // Negative, for the same reason the leg thrust above is: positive X on
        // a limb hanging downward swings the hand *behind* the body, and
        // `armSwing` is written the way every other forward channel here is,
        // with positive meaning forward. Without this a punch chambers and
        // then drives the fist out backwards.
        arm.mesh.rotation.x = idle - c.armSwing * sided;
        arm.mesh.rotation.z = arm.side * -c.armFlare;
        arm.mesh.position.y = arm.baseY + bob + hover;
        // Elbow. Same clamp logic as the knee: it can reach straight but not
        // hyperextend, and the off arm keeps its guard when the move is
        // one-sided instead of mirroring the chamber.
        const fold = c.armFold * (arm.lead ? 1 : 1 - c.armAlternate);
        arm.elbow.rotation.x = Math.max(0, Math.min(1.8, ARM_REST_FLEX + fold));
      }

      for (const wing of wings) {
        // Wings idle with a slow beat, flap on command, and fold across the
        // body when wrapped — all three are rotations on the same pivot.
        const idleBeat = paused ? 0 : Math.sin(elapsed * 1.5) * 0.12;
        const flap = idleBeat + c.wingFlap * 0.9;
        wing.pivot.rotation.z = wing.side * (0.35 + flap) * (1 - c.wingWrap * 0.7);
        wing.pivot.rotation.y = wing.side * c.wingWrap * -1.25;
        wing.pivot.position.y = spineY + bob + hover;
      }

      for (const spike of spikes) {
        // Flaring stands the spikes up and lengthens them.
        spike.mesh.position.y = spike.baseY + bob + hover + c.spikeFlare * 0.03 * form.scale;
        spike.mesh.scale.setScalar(spike.baseScale * (1 + c.spikeFlare * 0.55));
        spike.mesh.rotation.x = spike.baseTilt + c.spikeFlare * 0.55;
      }

      if (tailSegments.length > 0) {
        tailPivot.position.y = trunkY + height * 0.1 + bob + hover;
        const idleWag = paused ? 0 : Math.sin(elapsed * 1.1) * 0.12;
        tailPivot.rotation.y = idleWag + c.tailSwing * 0.55;
        tailPivot.rotation.x = -c.lean * 0.3 + c.squash * 0.2;
        for (const [index, segment] of tailSegments.entries()) {
          // Each link lags further behind the pivot, so a flick travels.
          const { object, lag } = segment;
          object.rotation.y = c.tailSwing * lag;
          object.position.x = Math.sin(elapsed * 1.1 - index * 0.5) * 0.008 * index + c.tailSwing * lag * 0.05;
        }
      }

      for (const part of tierParts) {
        part.object.position.y = part.baseY + bob + hover;
      }
      halo.position.y = headBase.y + haloOffsetY + bob + hover;
      halo.rotation.z = elapsed * 0.9;

      /* --------------------------------------------------- rig transform */

      rig.position.set(c.sway, c.lift + hover * 0.3, c.push);
      // Lean and tumble are the same axis: a few degrees of weight shift and a
      // whole flip, added rather than one overriding the other, so a body can
      // still be leaning into its landing while it comes out of the rotation.
      rig.rotation.set(c.lean + c.tumble, c.spin, c.roll);
      rig.scale.set(
        (1 + c.squash * 0.5) * (1 + c.pulse),
        (1 - c.squash) * (1 + c.pulse),
        (1 + c.squash * 0.5) * (1 + c.pulse + c.stretch),
      );

      healthBar.position.y = barY + bob * 0.3;

      /* ----------------------------------------------------- glow and ring */

      // Emissive parts are driven back to the form's resting glow every frame,
      // then pushed by whatever the current move asked for: flashes drive the
      // colour toward white-hot, drains pull it down toward matte.
      const flare = Math.max(0, Math.min(1.6, c.glowFlash));
      const drain = Math.max(0, Math.min(1, c.glowDrain));
      glowMat.emissiveIntensity = Math.max(0.05, (baseGlow + glowBoost) * (1 - drain * 0.85) + flare * 2.2);
      glowMat.emissive.copy(glowColor).lerp(whiteHot, Math.min(0.85, flare * 0.7));
      membraneMat.emissiveIntensity = (baseGlow + glowBoost) * 0.35 * (1 - drain * 0.8) + flare * 0.9;
      membraneMat.opacity = 0.88 - c.wingWrap * 0.1;
      // The armour's trim runs off the same channel, so a hit or a charge lights
      // the whole silhouette rather than just the handful of glow parts. It is
      // driven a little harder than the body glow because the trim is what
      // reads at distance once the plates have gone dark.
      trimMat.emissiveIntensity = Math.max(
        0.08,
        Math.min(1.0, (trimGlow + glowBoost) * (1 - drain * 0.9)) + flare * 2.6,
      );
      trimMat.emissive.copy(trimColor).lerp(whiteHot, Math.min(0.9, flare * 0.8));

      // Paused combat reads as a locked stance: ring pulses amber instead of
      // the creature's own colour, so "you are moving" is visible in the world.
      if (paused) ringMat.color.setHex(0xf0a63c);
      else ringMat.color.copy(glowColor);
      // The ring is planted on the floor, so it doubles as the body's shadow:
      // it draws in and fades as the creature leaves the ground, which is what
      // tells the eye the jump has height rather than just being drawn higher.
      ringMat.opacity = (0.35 + Math.sin(elapsed * (paused ? 6 : 2)) * 0.15) * (1 - airborne * 0.5);
      ring.scale.setScalar((paused ? 1.1 : 1) * (1 - airborne * 0.28));

      if (c.shock > 0 && c.shock < 1) {
        shockRing.visible = true;
        shockRing.scale.setScalar(1 + c.shock * 3.4);
        shockMat.opacity = (1 - c.shock) * 0.7;
      } else if (shockRing.visible) {
        shockRing.visible = false;
        shockMat.opacity = 0;
      }

      // Dust is an intensity, not a progress: it puffs out and fades with the
      // beat that kicked it up, rather than running a life of its own.
      const dust = Math.max(0, Math.min(1.4, c.dust));
      if (dust > 0.01) {
        dustRing.visible = true;
        dustRing.scale.setScalar(1 + dust * 0.22);
        dustMat.opacity = Math.min(0.42, dust * 0.34);
      } else if (dustRing.visible) {
        dustRing.visible = false;
        dustMat.opacity = 0;
      }

      // Aura runs on progress like the shockwave — it expands through the body
      // and is gone by the end of the move that spent it.
      if (c.aura > 0 && c.aura < 1) {
        auraShell.visible = true;
        auraShell.position.y = trunkY + height * 0.35 + bob + hover;
        // Ends a shade wider than the body, not swallowing the whole scene.
        auraShell.scale.setScalar(0.5 + c.aura * 0.95);
        auraMat.opacity = (1 - c.aura) * 0.34;
      } else if (auraShell.visible) {
        auraShell.visible = false;
        auraMat.opacity = 0;
      }

      if (flashUntil > performance.now()) {
        bodyMat.emissive = flashColor;
        bodyMat.emissiveIntensity = 0.9;
      } else {
        bodyMat.emissiveIntensity = 0;
      }

      // Rides above the health bar, on the group rather than the rig, so a
      // spin or a flinch never drags the text out of the player's reading line.
      // On wall time, not the animation clock: a line of dialogue is not part
      // of the blow, and hitstop must not stall the player's reading.
      bubble.update(wallDt, barY + 0.19 * form.scale);
    },
    setHealth(ratio) {
      health = Math.max(0, Math.min(1, ratio));
      barFill.scale.x = Math.max(0.001, health);
      barFill.position.x = -(0.4 * (1 - health)) / 2;
      barFillMat.color.setHex(health > 0.5 ? 0xb6f03c : health > 0.2 ? 0xf0a63c : 0xff3b30);
    },
    flash() {
      flashUntil = performance.now() + 220;
    },
    flinch() {
      flinchStartedAt = lastElapsed;
    },
    reel(blow) {
      const length = Math.hypot(blow.fromX, blow.fromZ);
      // A blow with no direction is still a blow — default to straight ahead,
      // which is where the opponent stands, rather than dropping the reaction.
      blowX = length > 1e-4 ? blow.fromX / length : 0;
      blowZ = length > 1e-4 ? blow.fromZ / length : 1;
      blowWeight = Math.max(0, Math.min(1, blow.weight));
      blowBlocked = blow.blocked === true;
      blowStartedAt = lastElapsed;
    },
    hold(seconds) {
      // Extends rather than replaces: two blows landing together should freeze
      // for the longer of the two, and a second hit inside a freeze must not
      // cut the first one short. Clamped, because a freeze is a beat of
      // punctuation — no single blow gets to stop the body for longer than the
      // shortest move takes, whatever it was handed.
      const want = Number.isFinite(seconds) ? Math.max(0, Math.min(HOLD_MAX_SECONDS, seconds)) : 0;
      holdRemaining = Math.max(holdRemaining, want);
    },
    progress() {
      const duration = DURATION[state];
      if (state === "idle" || duration <= 0) {
        return { state, elapsed: 0, remaining: 0 };
      }
      const into = Math.max(0, lastElapsed - stateStartedAt);
      return { state, elapsed: into, remaining: Math.max(0, duration - into) };
    },
    play(next) {
      if (next === "idle") {
        if (state !== "idle") carryPose();
        state = "idle";
        return;
      }
      if (!(next in DURATION)) return;
      // Re-triggering the same state restarts it (repeated hits should keep
      // flinching); a weaker one waits for the current reaction to finish.
      if (state !== "idle" && next !== state && PRIORITY[next] < PRIORITY[state]) return;
      // The incoming curve begins at t = 0 with every channel at zero, so
      // without this the body would snap to neutral on the frame it takes
      // over — a block cutting into a half-finished swing being the common
      // case. Hand the pose it is interrupting to the decay layer, which bleeds
      // it out underneath the new curve as that ramps up from nothing.
      carryPose();
      state = next;
      stateStartedAt = lastElapsed;
    },
    say(text, ttl) {
      bubble.say(text, ttl);
    },
    setLevel(level) {
      intensity = intensityForLevel(level);
      // Levelling up mid-session should also grow the body, not just the
      // animation curves — otherwise new tiers only appear after a rebuild.
      applyForm(level);
    },
    dispose() {
      bubble.dispose();
      for (const item of disposables) item.dispose();
    },
  };
}
