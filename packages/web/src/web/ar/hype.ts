/**
 * The arena's voice: the announcer, and the crowd.
 *
 * Both are recordings in `public/hype`, pre-rendered rather than spoken at
 * runtime. A shout has to land on the frame the blow lands — a model asked for
 * "Critical hit!" mid-exchange would answer a second and a half late, cost a
 * call per hit, and say it differently every time, which is the opposite of
 * what an arcade announcer is. Fourteen calls and four crowd beds together are
 * about 270 KB, fetched once and decoded into memory.
 *
 * The mix is three layers on the fight's own audio graph (see `sfxGraph`):
 *
 *   1. the crowd bed — a twelve-second loop, running for the whole fight, its
 *      gain following the fight's heat, so the room swells when blows are
 *      landing and settles to a murmur when nothing is;
 *   2. the crowd's reactions — a cheer, a gasp, a roar on a knockout, one-shot
 *      over the bed;
 *   3. the announcer, on top of everything, and ducking the two below him by
 *      about half for as long as he is talking, which is the whole reason this
 *      shares a context with `sfx.ts` instead of opening its own.
 *
 * One announcer at a time, always. Two calls in the same exchange would be two
 * voices talking over each other, so a queue of one is all there is: a call
 * arriving under a call either waits its turn (if it can still be timely), cuts
 * the current one off (a knockout does not wait), or is dropped.
 */

import type { HypeCall } from "../lib/hype";
import { interrupts } from "../lib/hype";
import { sfxGraph, sfxMuted } from "./sfx";

/** The crowd's one-shot reactions. */
export type CrowdHit = "cheer" | "gasp" | "roar";

/**
 * Bumped whenever the recordings change.
 *
 * `public/` is copied through unhashed, so `/hype/ko.mp3` is that URL forever
 * and an installed client would keep answering from its own cache. The same
 * trick `SFX_REV` plays, for the same reason.
 */
const HYPE_REV = 1;

/**
 * Per-file level.
 *
 * The announcer is mixed to sit over a loud exchange without clipping into it;
 * the two bookend calls (a knockout, a result) are the loudest thing in the
 * app on purpose. The crowd is deliberately well under both — a crowd that
 * competes with the fight stops reading as a room and starts reading as noise.
 */
const CALL_GAIN: Record<HypeCall, number> = {
  here_we_go: 0.9,
  fight: 1,
  first_blood: 0.95,
  great: 0.75,
  critical: 0.9,
  counter: 0.85,
  combo: 0.85,
  combo_big: 0.95,
  danger: 0.9,
  finish: 0.95,
  ko: 1,
  perfect: 1,
  win: 1,
  lose: 0.95,
};

const CROWD_GAIN: Record<CrowdHit, number> = {
  cheer: 0.5,
  gasp: 0.45,
  roar: 0.7,
};

/** The bed's gain at zero heat and at full heat. A room is never silent. */
const BED_MIN = 0.1;
const BED_MAX = 0.42;
/**
 * Seconds the bed takes to follow a change in heat.
 *
 * Long on purpose. Heat jumps the instant a blow lands, and a crowd that
 * tracked it exactly would pump on every hit; a real room takes a moment to
 * get going and longer to settle.
 */
const BED_GLIDE_S = 0.9;

/** How far the crowd drops while the announcer is talking, and how fast. */
const DUCK = 0.45;
const DUCK_S = 0.08;
const UNDUCK_S = 0.35;

/**
 * How long a queued call stays worth playing.
 *
 * A shout is about the blow that just landed. If it has been waiting longer
 * than this, the fight has moved on and playing it would describe the wrong
 * moment — better to say nothing.
 */
const QUEUE_TTL_MS = 900;

/* ------------------------------------------------------------------ loading */

const buffers = new Map<string, AudioBuffer>();
const fetching = new Map<string, Promise<void>>();

const ALL_FILES: readonly string[] = [
  ...(Object.keys(CALL_GAIN) as HypeCall[]),
  "crowd_cheer",
  "crowd_gasp",
  "crowd_roar",
  "crowd_bed",
];

/**
 * How long a call that arrived before its own bytes did may wait for them.
 *
 * Only ever hit on a cold cache — the first shout of the first fight of a
 * session, where the alternative is the match opening in silence. Kept just
 * over a queued call's life, because a shout that lands a second late is worth
 * less than the moment it was about.
 */
const COLD_GRACE_MS = 1_200;

function load(ctx: AudioContext, file: string): Promise<void> {
  const pending = fetching.get(file);
  if (pending) return pending;
  if (buffers.has(file)) return Promise.resolve();
  const run = (async () => {
    try {
      const res = await fetch(`/hype/${file}.mp3?v=${HYPE_REV}`);
      if (!res.ok) return;
      buffers.set(file, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch {
      // Stays out of `buffers`, so this call is simply silent for the session.
      // A missing shout must never cost a frame of the fight, and there is no
      // synthesised fallback for a human voice worth having.
    }
  })();
  fetching.set(file, run);
  return run;
}

function warm(ctx: AudioContext): void {
  for (const file of ALL_FILES) void load(ctx, file);
}

/* -------------------------------------------------------------------- graph */

type Rig = {
  ctx: AudioContext;
  /** The announcer, straight to the output. */
  voice: GainNode;
  /** The crowd — bed and one-shots — which the announcer ducks. */
  crowd: GainNode;
  /** The bed's own gain, driven by heat, under `crowd`. */
  bed: GainNode;
  bedSource: AudioBufferSourceNode | null;
};

let rig: Rig | null = null;
let muted = false;

/** The announcer currently talking, if any. */
let speaking: { call: HypeCall; source: AudioBufferSourceNode } | null = null;
/** At most one call waiting, with the moment it stops being timely. */
let queued: { call: HypeCall; at: number } | null = null;

function graph(): Rig | null {
  if (rig) return rig;
  const shared = sfxGraph();
  if (!shared) return null;
  const { ctx, out } = shared;
  try {
    const voice = ctx.createGain();
    voice.gain.value = 1;
    voice.connect(out);

    const crowd = ctx.createGain();
    crowd.gain.value = 1;
    crowd.connect(out);

    const bed = ctx.createGain();
    bed.gain.value = BED_MIN;
    bed.connect(crowd);

    rig = { ctx, voice, crowd, bed, bedSource: null };
    warm(ctx);
    return rig;
  } catch {
    return null;
  }
}

/**
 * Open the graph and fetch the whole set.
 *
 * Worth calling on the tap that enters the arena: the first call of a match is
 * "Fight!", and a cold cache would swallow it.
 */
export function primeHype(): void {
  graph();
}

/** Silence the announcer and the crowd, independently of the fight foley. */
export function setHypeMuted(next: boolean): void {
  muted = next;
  if (!next) return;
  stopCrowdBed();
  if (speaking) {
    try {
      speaking.source.stop();
    } catch {
      /* already ended */
    }
    speaking = null;
  }
  queued = null;
}

export function hypeMuted(): boolean {
  return muted;
}

function silent(): boolean {
  // The fight's own mute covers the arena too: a player who muted the game
  // meant all of it, not just the punches.
  return muted || sfxMuted();
}

/* ---------------------------------------------------------------- announcer */

function duck(rig: Rig, on: boolean): void {
  const now = rig.ctx.currentTime;
  const target = on ? DUCK : 1;
  try {
    rig.crowd.gain.cancelScheduledValues(now);
    rig.crowd.gain.setTargetAtTime(target, now, on ? DUCK_S : UNDUCK_S);
  } catch {
    rig.crowd.gain.value = target;
  }
}

function speak(rig: Rig, call: HypeCall): boolean {
  const buffer = buffers.get(call);
  if (!buffer) {
    // Not decoded yet. Fetch it, and take it the moment it lands so long as
    // the fight has not moved on and nobody else has started talking — a cold
    // cache should cost the shout a beat, not the whole moment.
    const asked = Date.now();
    void load(rig.ctx, call).then(() => {
      if (speaking || silent()) return;
      if (Date.now() - asked > COLD_GRACE_MS) return;
      if (!buffers.has(call)) return;
      speak(rig, call);
    });
    return false;
  }
  try {
    const source = rig.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = rig.ctx.createGain();
    gain.gain.value = CALL_GAIN[call];
    source.connect(gain);
    gain.connect(rig.voice);

    speaking = { call, source };
    duck(rig, true);

    source.onended = () => {
      if (speaking?.source !== source) return;
      speaking = null;
      duck(rig, false);
      // Whatever was waiting on him gets its turn now, if it is still about
      // something the player can remember.
      const next = queued;
      queued = null;
      if (next && Date.now() - next.at <= QUEUE_TTL_MS) speak(rig, next.call);
    };
    source.start();

    if (import.meta.env.DEV) {
      const log = window as unknown as { __hype?: string[] };
      (log.__hype ??= []).push(call);
    }
    return true;
  } catch {
    speaking = null;
    return false;
  }
}

/**
 * Shout one call.
 *
 * Safe to call on every exchange. What it does about a call arriving while the
 * announcer is already talking depends on which call it is: a knockout, a
 * result or a first blood cuts him off mid-word, because those are the moments
 * the match turns on; anything else waits for a gap and is dropped if the gap
 * comes too late.
 */
export function playHypeCall(call: HypeCall): void {
  if (silent()) return;
  const rig = graph();
  if (!rig) return;

  if (!speaking) {
    speak(rig, call);
    return;
  }
  if (interrupts(call)) {
    try {
      speaking.source.onended = null;
      speaking.source.stop();
    } catch {
      /* already ended */
    }
    speaking = null;
    queued = null;
    speak(rig, call);
    return;
  }
  // The queue is one deep and the newest call takes the slot — a shout is
  // about the blow that just landed, so the later one is the truer one.
  queued = { call, at: Date.now() };
}

/* -------------------------------------------------------------------- crowd */

/** A one-shot reaction over the bed. */
export function playCrowd(hit: CrowdHit): void {
  if (silent()) return;
  const rig = graph();
  if (!rig) return;
  const file = `crowd_${hit}`;
  const buffer = buffers.get(file);
  if (!buffer) {
    load(rig.ctx, file);
    return;
  }
  try {
    const source = rig.ctx.createBufferSource();
    source.buffer = buffer;
    // A crowd is many people, so the same take twice in a row is more obvious
    // here than anywhere else in the app — nudge the rate each time.
    source.playbackRate.value = 0.96 + Math.random() * 0.08;
    const gain = rig.ctx.createGain();
    gain.gain.value = CROWD_GAIN[hit];
    source.connect(gain);
    gain.connect(rig.crowd);
    source.start();
  } catch {
    /* a missing reaction is not worth a thrown error */
  }
}

/**
 * Start the crowd bed, if it is not already running.
 *
 * Idempotent: call it on every state change that means "a fight is happening"
 * without tracking whether it took.
 */
export function startCrowdBed(): void {
  if (silent()) return;
  const rig = graph();
  if (!rig || rig.bedSource) return;
  const buffer = buffers.get("crowd_bed");
  if (!buffer) {
    load(rig.ctx, "crowd_bed");
    return;
  }
  try {
    const source = rig.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(rig.bed);
    source.start();
    rig.bedSource = source;
  } catch {
    /* no room tone this session */
  }
}

export function stopCrowdBed(): void {
  if (!rig?.bedSource) return;
  try {
    rig.bedSource.stop();
  } catch {
    /* already stopped */
  }
  rig.bedSource = null;
}

/**
 * Point the bed at a heat, 0..1.
 *
 * Cheap enough to call every frame — it sets a glide target rather than a
 * value, so the room follows the fight over about a second instead of jumping
 * with it. Starts the bed if the fight has heat and it is not running yet.
 */
export function setCrowdHeat(heat: number): void {
  if (silent()) return;
  const rig = graph();
  if (!rig) return;
  if (!rig.bedSource) startCrowdBed();
  const clamped = Math.max(0, Math.min(1, heat));
  const target = BED_MIN + (BED_MAX - BED_MIN) * clamped;
  try {
    rig.bed.gain.setTargetAtTime(target, rig.ctx.currentTime, BED_GLIDE_S);
  } catch {
    rig.bed.gain.value = target;
  }
}
