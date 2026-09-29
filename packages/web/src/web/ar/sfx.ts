/**
 * Combat sound.
 *
 * Two layers, in this order:
 *
 *   1. Recorded cues in `public/sfx` — dry, close-miked fight foley. Impacts
 *      are built the way a film builds them, a crack over a body thud over a
 *      short low end, and the creature vocals are real predator throat rather
 *      than a synthesised growl. Almost no tail on any of them: the transient
 *      is the sound, and a decaying room would turn an exchange thrown every
 *      second and a half into mud. All twenty-two together are about 175 KB,
 *      mono, peak-normalised to -1 dBFS, none longer than a second and a half,
 *      so they cost roughly one photo to download and are decoded once into
 *      memory rather than per press.
 *   2. The synthesised cues below, kept as a fallback. A phone that loses the
 *      network mid-match, a decode a browser refuses, a cue that has no file —
 *      all of them still make a noise instead of a silent swing.
 *
 * Two rules the browsers impose, honoured here:
 *   - the context cannot start until the player has touched the screen, so it
 *     is created lazily on the first triggered cue and resumed if suspended;
 *   - nothing may block. Every cue is fire-and-forget and a failure is
 *     swallowed, because a missing sound must never cost a frame of the fight.
 */

export type Cue =
  /* --------------------------------------------------------------- generic */
  /**
   * The generic cues. Still here, and still used: the server names the move in
   * a real match, and a move this build does not recognise has to sound like
   * *something*. Every per-move cue below falls back to one of these.
   */
  /** The player's own swing leaving the body. */
  | "attack"
  /** Something landing on a body that can feel it. */
  | "hit"
  /** A chained move — two hits and a tail. */
  | "combo"
  /** A hit in the training area: the number is real, the damage is not. */
  | "training"
  /** A defence answering a swing. */
  | "guard"
  /** The character's personality reacting — a short two-note chirp. */
  | "reaction"
  /* -------------------------------------------------------------- per move */
  /** A claw going through the air. */
  | "swipe"
  /** Jaws closing — a snap with a clack on the end of it. */
  | "bite"
  /** A tail travelling, then arriving. */
  | "tail_whip"
  /** Weight hitting the ground: a slam or a charge ending. */
  | "slam"
  /** Wings moving air rather than hitting anything. */
  | "gust"
  /** Spines going up, bright and spiky. */
  | "spike_burst"
  /** The landing at the end of a combination, heavier than a single hit. */
  | "combo_impact"
  /** Getting out of the way. */
  | "dodge"
  /** A block turned around into an answer. */
  | "counter"
  /** A training-area hit: counted, not taken. */
  | "training_hit"
  /** The sparring partner committing to something. */
  | "bot_growl"
  /** Energy released rather than swung — a burst or an absorb. */
  | "aura_pulse"
  /**
   * A body covering ground and arriving with a claw on the end of it.
   *
   * One cue rather than two, because a cue is one press: the whoosh is the
   * dash, and the crack at the end of it is the strike landing. Splitting them
   * would mean timing a second press against an animation window, which is
   * exactly the kind of thing that drifts.
   */
  | "dash_whoosh"
  /** A fist arriving: knuckle, then the body behind it. */
  | "punch"
  /** A leg arriving — the punch's weight, lower and with the thigh in it. */
  | "kick"
  /** Flame leaving a throat: sustained, no transient, all noise. */
  | "flame"
  /** Chitin: two dry clacks, no meat in them. */
  | "pincer"
  /** Machinery committing — a ram firing, then the frame ringing. */
  | "servo_slam";

type Voice = {
  /** Oscillator type and the frequency it sweeps between, in hertz. */
  wave: OscillatorType;
  from: number;
  to: number;
  /** Seconds. */
  attack: number;
  decay: number;
  gain: number;
  /** Low-pass corner, to keep the square waves from sounding like a modem. */
  cutoff: number;
  /** Seconds to wait before this voice starts, for multi-hit cues. */
  delay?: number;
};

/**
 * What each cue actually plays: a file in `public/sfx`, and how loud.
 *
 * Levels are set by what the sound is doing rather than by its waveform. A
 * slam and a combo finisher are the two moments in an exchange that should
 * make a player flinch, so they sit on top; a guard and a training thud are
 * bookkeeping and sit under everything. The files are already peak-normalised,
 * which is why the mix lives here and not in the audio.
 *
 * Several files to a cue means one is picked at random per press. Only the two
 * cues that repeat without a move behind them need it — a victory roar and the
 * partner growling — because everything else is already varied by which move
 * the engine chose.
 */
const SAMPLES: Record<Cue, { files: string[]; gain: number }> = {
  /* Generic fallbacks reuse the nearest recorded cue: an unclassified swing is
   * air moving, an unclassified chain ends like a chain ends. */
  attack: { files: ["swipe"], gain: 0.7 },
  hit: { files: ["hit"], gain: 0.95 },
  combo: { files: ["combo_impact"], gain: 1 },
  training: { files: ["training_hit"], gain: 0.5 },
  guard: { files: ["guard"], gain: 0.55 },
  // A win is the one place a full roar belongs; the snort is the smaller
  // version of the same brag, so the celebration is not the same take twice.
  reaction: { files: ["roar", "reaction"], gain: 0.9 },

  swipe: { files: ["swipe"], gain: 0.7 },
  bite: { files: ["bite"], gain: 0.85 },
  tail_whip: { files: ["tail_whip"], gain: 0.85 },
  slam: { files: ["slam"], gain: 1 },
  gust: { files: ["gust"], gain: 0.75 },
  spike_burst: { files: ["spike_burst"], gain: 0.8 },
  combo_impact: { files: ["combo_impact"], gain: 1 },
  dodge: { files: ["dodge"], gain: 0.6 },
  counter: { files: ["counter"], gain: 0.8 },
  // Counted, not taken — so it is deliberately the quietest impact in the set.
  training_hit: { files: ["training_hit"], gain: 0.5 },
  bot_growl: { files: ["bot_growl", "reaction"], gain: 0.7 },
  aura_pulse: { files: ["aura_pulse"], gain: 0.85 },
  // One recording that carries the whole move: the gritty scrape of the
  // approach, then the strike arriving on the end of it.
  dash_whoosh: { files: ["dash_whoosh"], gain: 0.75 },

  /* The category strikes. A fist and a boot are the two cues in the set that
   * fire most often — every humanoid throws them and the combos throw them in
   * pairs — so they sit deliberately under the slam: a sound heard six times a
   * round has to stay out of the way in a manner a finisher does not. */
  punch: { files: ["punch"], gain: 0.8 },
  kick: { files: ["kick"], gain: 0.85 },
  // The only sustained cue in the table, and the one that needs no accent on
  // the end — the stream is the sound, so it carries the whole move.
  flame: { files: ["flame"], gain: 0.8 },
  // Chitin: short, bright and dry. Quiet, because what sells a snap is the
  // suddenness of it and not the size.
  pincer: { files: ["pincer"], gain: 0.7 },
  // A construct's slam, and the heaviest of the five, so it sits with the
  // slam it is the mechanical version of.
  servo_slam: { files: ["servo_slam"], gain: 1 },
};

/**
 * The synthesised fallbacks. Deliberately terse — a fight throws a move every
 * second and a half and anything with a tail longer than a quarter second
 * turns the exchange into mud.
 */
const CUES: Record<Cue, Voice[]> = {
  // A downward saw sweep: weight leaving the body.
  attack: [{ wave: "sawtooth", from: 320, to: 90, attack: 0.004, decay: 0.16, gain: 0.22, cutoff: 1_800 }],
  // Impact: a hard low thud with a noisy square edge over the top.
  hit: [
    { wave: "square", from: 180, to: 46, attack: 0.002, decay: 0.2, gain: 0.26, cutoff: 900 },
    { wave: "triangle", from: 900, to: 220, attack: 0.002, decay: 0.08, gain: 0.12, cutoff: 3_000 },
  ],
  // Three ascending strikes: the chain reads as more than one move landing.
  combo: [
    { wave: "square", from: 260, to: 120, attack: 0.002, decay: 0.1, gain: 0.2, cutoff: 1_400 },
    { wave: "square", from: 330, to: 150, attack: 0.002, decay: 0.1, gain: 0.2, cutoff: 1_600, delay: 0.09 },
    { wave: "sawtooth", from: 620, to: 180, attack: 0.003, decay: 0.26, gain: 0.22, cutoff: 2_600, delay: 0.19 },
  ],
  // Training: the same shape as a hit, an octave up and softer. It has to read
  // as "counted, not taken" without the player being told twice.
  training: [
    { wave: "triangle", from: 520, to: 300, attack: 0.003, decay: 0.12, gain: 0.16, cutoff: 2_400 },
    { wave: "sine", from: 780, to: 640, attack: 0.004, decay: 0.16, gain: 0.1, cutoff: 3_200, delay: 0.06 },
  ],
  // A guard: short, dull, no pitch movement to speak of.
  guard: [{ wave: "sine", from: 150, to: 110, attack: 0.004, decay: 0.14, gain: 0.18, cutoff: 700 }],
  // The personality line: two clean notes, nothing percussive.
  reaction: [
    { wave: "sine", from: 660, to: 660, attack: 0.008, decay: 0.1, gain: 0.1, cutoff: 4_000 },
    { wave: "sine", from: 880, to: 880, attack: 0.008, decay: 0.14, gain: 0.09, cutoff: 4_000, delay: 0.1 },
  ],

  /* ------------------------------------------------------------- per move */

  // Each of these is the same one-or-two-oscillator trick as the generics.
  // What separates them is where the energy sits: a claw is air and treble, a
  // slam is weight and no treble at all, and a burst is a swell rather than a
  // strike. Tails stay under a third of a second — the bot now throws every
  // two seconds, and anything longer stacks into mud.

  // Claw through air: bright, dry, gone before the hand lands.
  swipe: [{ wave: "sawtooth", from: 760, to: 190, attack: 0.003, decay: 0.12, gain: 0.18, cutoff: 2_600 }],
  // Jaws: a short snap with the clack of them meeting on the end.
  bite: [
    { wave: "square", from: 420, to: 110, attack: 0.002, decay: 0.07, gain: 0.22, cutoff: 1_200 },
    { wave: "triangle", from: 1_500, to: 520, attack: 0.001, decay: 0.05, gain: 0.14, cutoff: 4_000, delay: 0.05 },
  ],
  // A tail is travel then arrival: the sweep rises as it comes round, and the
  // second voice is the tip landing.
  tail_whip: [
    { wave: "sawtooth", from: 170, to: 880, attack: 0.02, decay: 0.16, gain: 0.14, cutoff: 3_000 },
    { wave: "square", from: 300, to: 90, attack: 0.002, decay: 0.12, gain: 0.2, cutoff: 900, delay: 0.15 },
  ],
  // Weight arriving. Almost no treble, and the longest tail of any cue here,
  // because the ground keeps it for a moment.
  slam: [
    { wave: "sine", from: 130, to: 36, attack: 0.002, decay: 0.3, gain: 0.3, cutoff: 420 },
    { wave: "square", from: 96, to: 30, attack: 0.002, decay: 0.22, gain: 0.18, cutoff: 300 },
    { wave: "triangle", from: 640, to: 140, attack: 0.001, decay: 0.07, gain: 0.12, cutoff: 2_200 },
  ],
  // Moved air, not an impact: no attack transient, and the filter kept low so
  // it reads as a gust rather than a whistle.
  gust: [
    { wave: "triangle", from: 280, to: 940, attack: 0.04, decay: 0.26, gain: 0.14, cutoff: 1_300 },
    { wave: "sine", from: 220, to: 660, attack: 0.05, decay: 0.22, gain: 0.09, cutoff: 1_800, delay: 0.07 },
  ],
  // Spines standing up: two bright stabs, wide open filter.
  spike_burst: [
    { wave: "sawtooth", from: 900, to: 300, attack: 0.002, decay: 0.1, gain: 0.17, cutoff: 5_000 },
    { wave: "square", from: 1_340, to: 430, attack: 0.002, decay: 0.08, gain: 0.12, cutoff: 5_000, delay: 0.06 },
  ],
  // The end of a chain: the ascending pair of the combo cue, then a low thud
  // under it so the last beat of a combination lands heavier than a single hit.
  combo_impact: [
    { wave: "square", from: 300, to: 130, attack: 0.002, decay: 0.09, gain: 0.2, cutoff: 1_500 },
    { wave: "square", from: 400, to: 170, attack: 0.002, decay: 0.09, gain: 0.2, cutoff: 1_700, delay: 0.08 },
    { wave: "sine", from: 150, to: 40, attack: 0.002, decay: 0.28, gain: 0.28, cutoff: 500, delay: 0.17 },
  ],
  // Getting out of the way: one quick rising breath, no body to it.
  dodge: [{ wave: "sine", from: 380, to: 1_180, attack: 0.012, decay: 0.09, gain: 0.11, cutoff: 3_000 }],
  // A block turned around: metallic, two notes, the second one higher because
  // a counter is an answer rather than an absorption.
  counter: [
    { wave: "triangle", from: 1_200, to: 900, attack: 0.002, decay: 0.08, gain: 0.15, cutoff: 5_000 },
    { wave: "square", from: 1_760, to: 1_320, attack: 0.003, decay: 0.12, gain: 0.1, cutoff: 6_000, delay: 0.07 },
  ],
  // The training area's own hit: the impact shape, an octave up and softened,
  // with a tick on the end that reads as a number being written down.
  training_hit: [
    { wave: "triangle", from: 560, to: 320, attack: 0.003, decay: 0.11, gain: 0.16, cutoff: 2_600 },
    { wave: "sine", from: 1_040, to: 880, attack: 0.004, decay: 0.09, gain: 0.09, cutoff: 3_400, delay: 0.07 },
  ],
  // The partner committing: low, throaty, nothing above the mud line.
  bot_growl: [
    { wave: "sawtooth", from: 92, to: 58, attack: 0.03, decay: 0.3, gain: 0.2, cutoff: 280 },
    { wave: "square", from: 74, to: 48, attack: 0.04, decay: 0.24, gain: 0.1, cutoff: 220, delay: 0.06 },
  ],
  // Energy let go of: a swell rather than a strike, so it rises into the room
  // instead of hitting it.
  // The dash: air first, then arrival. The opening voice is a low sweep with a
  // slow attack, which is a body accelerating rather than a hand swinging; the
  // claw lands on top of it a fifth of a second later, and a short dry thud
  // underneath is the feet stopping. Kept inside a third of a second like
  // everything else here, so a dash into a combo does not smear.
  dash_whoosh: [
    { wave: "triangle", from: 160, to: 620, attack: 0.03, decay: 0.19, gain: 0.16, cutoff: 1_500 },
    { wave: "sawtooth", from: 820, to: 240, attack: 0.002, decay: 0.1, gain: 0.17, cutoff: 3_000, delay: 0.19 },
    { wave: "sine", from: 120, to: 44, attack: 0.002, decay: 0.14, gain: 0.2, cutoff: 480, delay: 0.2 },
  ],
  aura_pulse: [
    { wave: "sine", from: 190, to: 740, attack: 0.06, decay: 0.28, gain: 0.15, cutoff: 2_200 },
    { wave: "sine", from: 380, to: 1_480, attack: 0.07, decay: 0.24, gain: 0.08, cutoff: 3_000, delay: 0.09 },
  ],

  /* ------------------------------------------------------ category strikes */

  // The category moves. A punch and a kick are the only things in the game
  // that are neither a claw (air and treble) nor a slam (floor and no treble):
  // they are a limb arriving on a body, so the energy sits in the middle where
  // nothing else here does. The other three are materials — fire, chitin,
  // metal — and each is the thing the material sounds like.

  // Knuckle first, then the shoulder behind it. Shortest tail of any impact
  // cue: a jab is over before the arm is back, and this fires twice in a
  // punch-kick.
  punch: [
    { wave: "square", from: 300, to: 96, attack: 0.002, decay: 0.09, gain: 0.22, cutoff: 1_100 },
    { wave: "triangle", from: 1_100, to: 340, attack: 0.001, decay: 0.04, gain: 0.1, cutoff: 3_400 },
  ],
  // The punch a fifth lower with a longer body on it: a leg is heavier and the
  // hip is in the swing, so the low voice carries and the tick on top goes.
  kick: [
    { wave: "square", from: 210, to: 62, attack: 0.002, decay: 0.16, gain: 0.26, cutoff: 800 },
    { wave: "sine", from: 140, to: 44, attack: 0.003, decay: 0.2, gain: 0.18, cutoff: 420, delay: 0.03 },
    { wave: "triangle", from: 820, to: 260, attack: 0.001, decay: 0.05, gain: 0.09, cutoff: 2_800 },
  ],
  // No transient at all — flame does not start, it arrives and keeps going.
  // Two detuned saws through a low filter is the closest this synth gets to
  // noise, and the longest tail here because the breath outlasts the frame
  // that throws it.
  flame: [
    { wave: "sawtooth", from: 120, to: 300, attack: 0.07, decay: 0.32, gain: 0.2, cutoff: 900 },
    { wave: "sawtooth", from: 186, to: 430, attack: 0.09, decay: 0.3, gain: 0.12, cutoff: 1_400, delay: 0.02 },
    { wave: "triangle", from: 640, to: 1_900, attack: 0.1, decay: 0.26, gain: 0.07, cutoff: 3_200, delay: 0.05 },
  ],
  // Two clacks, because the animation snaps twice. Dry, high and bodiless —
  // the difference between a pincer and a jaw is that nothing behind a pincer
  // has any give in it.
  pincer: [
    { wave: "square", from: 1_600, to: 700, attack: 0.001, decay: 0.035, gain: 0.16, cutoff: 6_000 },
    { wave: "square", from: 1_900, to: 840, attack: 0.001, decay: 0.035, gain: 0.14, cutoff: 6_000, delay: 0.07 },
    { wave: "triangle", from: 420, to: 180, attack: 0.002, decay: 0.07, gain: 0.08, cutoff: 1_800, delay: 0.07 },
  ],
  // The heaviest blow in the game, so it gets the slam's low end — and then
  // the part a slam does not have: the frame ringing afterwards, which is the
  // only way a machine reads as a machine rather than as a heavy animal.
  servo_slam: [
    { wave: "square", from: 150, to: 40, attack: 0.002, decay: 0.26, gain: 0.3, cutoff: 380 },
    { wave: "sawtooth", from: 240, to: 70, attack: 0.002, decay: 0.12, gain: 0.16, cutoff: 900, delay: 0.01 },
    { wave: "triangle", from: 2_200, to: 1_500, attack: 0.004, decay: 0.24, gain: 0.08, cutoff: 7_000, delay: 0.06 },
  ],
};

let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context) return context;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.85;
    master.connect(context.destination);
    // The context only exists because a cue just fired, which means a fight is
    // already happening — fetch the rest of the set now so the second swing
    // does not fall back to a tone.
    warm(context);
    return context;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- the samples */

/** Decoded and ready. Keyed by file stem, so a file shared by two cues loads once. */
const buffers = new Map<string, AudioBuffer>();
/** In flight or given up on, so a 404 is not retried on every press. */
const fetching = new Set<string>();

function load(ctx: AudioContext, file: string) {
  if (buffers.has(file) || fetching.has(file)) return;
  fetching.add(file);
  void (async () => {
    try {
      const res = await fetch(`/sfx/${file}.mp3`);
      if (!res.ok) return;
      const bytes = await res.arrayBuffer();
      buffers.set(file, await ctx.decodeAudioData(bytes));
    } catch {
      // Left out of `buffers`, so this cue keeps using its synthesised
      // fallback for the rest of the session. Never a thrown error.
    }
  })();
}

function warm(ctx: AudioContext) {
  for (const file of new Set(Object.values(SAMPLES).flatMap((s) => s.files))) load(ctx, file);
}

/**
 * Play the recorded cue, if it is decoded yet.
 *
 * Returns false when there is nothing to play, which is the caller's signal to
 * fall through to the oscillators.
 */
function playSample(ctx: AudioContext, out: GainNode, cue: Cue): boolean {
  const sample = SAMPLES[cue];
  if (!sample) return false;
  const ready = sample.files.filter((file) => buffers.has(file));
  if (ready.length === 0) {
    warm(ctx);
    return false;
  }
  const file = ready[(Math.random() * ready.length) | 0];
  const buffer = buffers.get(file);
  if (!buffer) return false;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // A fight repeats the same move often enough that an identical take starts
    // to sound like a loop, so each press is nudged a semitone or so either
    // way — the same trick a game engine's sound bank uses.
    src.playbackRate.value = 0.94 + Math.random() * 0.12;

    const gain = ctx.createGain();
    gain.gain.value = sample.gain;
    src.connect(gain);
    gain.connect(out);
    src.start();
    // Dev only: which recording a cue reached for, so a browser check can tell
    // "the roar played" from "the fallback tone played" — the whole point of
    // this layer is invisible otherwise.
    if (import.meta.env.DEV) {
      const log = window as unknown as { __sfx?: string[] };
      (log.__sfx ??= []).push(`${cue}:${file}`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the audio graph and fetch the cue set early.
 *
 * Worth calling on a tap that happens before the fighting starts — entering
 * the arena, placing the character — because a cue triggered on a cold graph
 * has to fall back to a tone while the files are still in the air, and the
 * first swing of a match is the worst one to get wrong.
 */
export function primeSfx() {
  audio();
}

/** Silence every cue, or let them through again. Survives across modes. */
export function setSfxMuted(next: boolean) {
  muted = next;
}

export function sfxMuted(): boolean {
  return muted;
}

/**
 * Play one cue. Safe to call from a render effect, from a timer, or thirty
 * times in a row — an overlapping cue simply layers.
 */
export function playCue(cue: Cue) {
  if (muted) return;
  const ctx = audio();
  const out = master;
  if (!ctx || !out) return;
  // A context created before the first gesture starts suspended; resuming it
  // on a real cue is the only chance we get.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  // The recording is the cue. The oscillators below only run when there is no
  // file for it yet — first press of a cold session, or a fetch that failed.
  const played = playSample(ctx, out, cue);

  const now = ctx.currentTime;
  for (const voice of played ? [] : CUES[cue]) {
    try {
      const start = now + (voice.delay ?? 0);
      const osc = ctx.createOscillator();
      osc.type = voice.wave;
      osc.frequency.setValueAtTime(voice.from, start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, voice.to), start + voice.decay);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = voice.cutoff;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(voice.gain, start + voice.attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + voice.attack + voice.decay);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + voice.attack + voice.decay + 0.02);
    } catch {
      // A cue is never worth an exception reaching the render loop.
      return;
    }
  }
  // Dev only: sound is the one part of a fight a browser check cannot hear, so
  // the cues that actually reached the audio graph are recorded where a check
  // can read them back.
  if (import.meta.env.DEV) {
    const log = (window as unknown as { __cues?: Cue[] });
    (log.__cues ??= []).push(cue);
  }
}

/**
 * What each named move sounds like.
 *
 * Keyed by the shared move ids, so this table and the animation curves are
 * naming the same moves — a claw sounds like a claw and a slam sounds like the
 * floor. Anything absent falls through to the generic classification below,
 * which is the case that matters in a real match: the server picks the move,
 * and a build that has not heard of it still has to make a noise.
 */
const MOVE_CUES: Record<string, Cue> = {
  // Attacks.
  swipe: "swipe",
  bite: "bite",
  tail_whip: "tail_whip",
  wing_gust: "gust",
  spike_burst: "spike_burst",
  // A charge ends in a body hitting a body, which is the same weight as a slam.
  charge: "slam",
  dash_strike: "dash_whoosh",
  ground_slam: "slam",
  elemental_burst: "aura_pulse",
  // Defences. A shell and a wing are both something coming up in the way, so
  // they keep the dull generic guard; a dodge and a parry are not.
  shell_guard: "guard",
  wing_shield: "guard",
  dodge: "dodge",
  parry: "counter",
  absorb: "aura_pulse",
  counter_stance: "counter",
  // Combinations end on their last beat, so they sound like that beat landing.
  swipe_bite: "combo_impact",
  charge_slam: "combo_impact",
  gust_spike: "combo_impact",
  // The dash chains end on a bite, a tail or the floor — all of them an impact,
  // so they get the heavier chain finisher rather than the dash's own whoosh.
  dash_bite: "combo_impact",
  dash_whip: "combo_impact",
  dash_slam: "combo_impact",
  dodge_counter: "counter",
  absorb_burst: "aura_pulse",
  // Category moves. Three get a voice of their own; the other three borrow,
  // because what they sound like already exists:
  punch: "punch",
  kick: "kick",
  // A grapple is two bodies arriving on each other and one of them going
  // down, which is the slam with no floor involved.
  grapple: "slam",
  // A pounce and a dive are both "cover ground, land on something", which is
  // exactly what the dash cue was built to be — air, then arrival.
  pounce: "dash_whoosh",
  dive_bomb: "dash_whoosh",
  fire_breath: "flame",
  pincer_snap: "pincer",
  piston_slam: "servo_slam",
  // The category combos end on a beat like every other combo does.
  punch_kick: "combo_impact",
  dash_punch: "combo_impact",
  pounce_bite: "combo_impact",
};

/**
 * The cue a named move should make.
 *
 * The per-move table first, then the fallback that has always been here:
 * combos get the chain, defences get the guard, everything else is a swing —
 * so the caller can hand over whatever the engine or the pad chose without
 * classifying it first.
 */
export function cueForMove(move: string, combos: readonly string[], defenses: readonly string[]): Cue {
  const named = MOVE_CUES[move];
  if (named) return named;
  if (combos.includes(move)) return "combo";
  if (defenses.includes(move)) return "guard";
  return "attack";
}
