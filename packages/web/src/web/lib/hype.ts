/**
 * Fight hype: what the crowd and the announcer make of an exchange.
 *
 * Pure. No timers, no audio, no React, no imports — one function turns the
 * numbers the server already sent into the things a fighting game puts on top
 * of them: a shout, a banner, a crowd that gets louder. The playback side
 * (`ar/hype.ts`) and the UI (`components/play/hype-banner.tsx`) both read this
 * module, and the training area feeds it the same shape a real match does, so
 * a sparring hit and a ranked hit are hyped by identical rules.
 *
 * Why a reducer rather than a class with state inside: the same exchange
 * replayed twice (an SSE reconnect handing back the log) must produce the same
 * calls, and a streak counter hidden in a module would quietly drift between
 * the two. The caller owns the state and can throw it away when the match does.
 */

/* ------------------------------------------------------------------- calls */

/**
 * The announcer's vocabulary. Each one is a pre-rendered file in
 * `public/hype` — recorded rather than spoken at runtime, because a call that
 * arrives half a second after the hit it is about is worse than no call, and a
 * model round trip cannot beat a decoded buffer.
 */
export const HYPE_CALLS = [
  "here_we_go",
  "fight",
  "first_blood",
  "great",
  "critical",
  "counter",
  "combo",
  "combo_big",
  "danger",
  "finish",
  "ko",
  "perfect",
  "win",
  "lose",
] as const;
export type HypeCall = (typeof HYPE_CALLS)[number];

/**
 * Which shout wins when an exchange earns several.
 *
 * One call per exchange, always — two announcer lines over each other is the
 * single fastest way to make a fight sound cheap. A knockout outranks
 * everything, then the once-a-match moments, then the per-hit flavour.
 */
const RANK: Record<HypeCall, number> = {
  ko: 100,
  perfect: 95,
  win: 94,
  lose: 93,
  first_blood: 80,
  combo_big: 70,
  critical: 62,
  counter: 58,
  finish: 54,
  danger: 50,
  combo: 40,
  great: 20,
  fight: 10,
  here_we_go: 9,
};

/** Calls loud enough to be worth interrupting whatever is already playing. */
const INTERRUPTS: ReadonlySet<HypeCall> = new Set(["ko", "win", "lose", "perfect", "first_blood"]);

export function interrupts(call: HypeCall): boolean {
  return INTERRUPTS.has(call);
}

/** How long the same shout has to sit out before it may fire again. */
const CALL_COOLDOWN_MS: Record<HypeCall, number> = {
  here_we_go: 30_000,
  fight: 30_000,
  first_blood: 600_000,
  great: 9_000,
  critical: 5_000,
  counter: 6_000,
  combo: 5_000,
  combo_big: 8_000,
  danger: 20_000,
  finish: 15_000,
  ko: 2_000,
  perfect: 2_000,
  win: 2_000,
  lose: 2_000,
};

/* ------------------------------------------------------------------ banner */

export type HypeTone = "good" | "bad" | "hot";

/** The arcade callout drawn over the fight. */
export type HypeBanner = {
  /** Changes on every fired banner, so the UI can re-run its own animation. */
  id: number;
  call: HypeCall;
  headline: string;
  sub: string | null;
  tone: HypeTone;
  /** Seconds the banner should stay up. */
  ttl: number;
};

/* ------------------------------------------------------------------- input */

/**
 * One exchange, flattened.
 *
 * Every field is something the server already decided (or, in the training
 * area, something `computeDamage` decided locally) — this module invents no
 * numbers and never overrules one. `mine` is the only client-side fact in here.
 */
export type HypeExchange = {
  /** Did my character throw this blow. */
  mine: boolean;
  /** Stable key for whoever threw it, so a streak can tell the sides apart. */
  actor: string;
  damage: number;
  crit: boolean;
  whiff: boolean;
  /** The move was one of the body's chained combinations. */
  combo: boolean;
  /** The server's guard grade: clean, block, parry… */
  grade: string | null;
  /** Damage the defender turned back around. */
  riposte: number;
  killed: boolean;
  /** The receiver's health after the blow, 0..1. Null when it is not known. */
  healthLeft: number | null;
  /** The receiver had not taken a scratch before this. */
  untouched: boolean;
};

export type HypeState = {
  /** Who is currently chaining, and how many blows deep. */
  streakBy: string | null;
  streak: number;
  /** Has anything landed in this fight yet. */
  bloodDrawn: boolean;
  /** When each call last fired, so a shout is not worn out. */
  firedAt: Partial<Record<HypeCall, number>>;
  /**
   * How frantic this fight is, 0..1 — drives the crowd bed's volume. Rises
   * with every blow that lands and decays in real time, so a fight that goes
   * quiet takes the room down with it instead of staying at a roar.
   */
  heat: number;
  heatAt: number;
};

export function freshHypeState(): HypeState {
  return { streakBy: null, streak: 0, bloodDrawn: false, firedAt: {}, heat: 0, heatAt: 0 };
}

/** Heat lost per second of nothing happening. */
const HEAT_DECAY = 0.22;

function decayHeat(state: HypeState, now: number): number {
  if (state.heatAt === 0) return state.heat;
  const elapsed = Math.max(0, (now - state.heatAt) / 1000);
  return Math.max(0, state.heat - elapsed * HEAT_DECAY);
}

/** Heat right now, without an exchange to advance it — for the audio loop. */
export function heatNow(state: HypeState, now: number): number {
  return decayHeat(state, now);
}

/** A streak only counts as a combo when the blows arrive close together. */
export const COMBO_WINDOW_MS = 4_500;

export type HypeResult = {
  state: HypeState;
  /** The one call to shout, or null when this exchange is not worth one. */
  call: HypeCall | null;
  banner: HypeBanner | null;
  /** The crowd's reaction, layered under the call. */
  crowd: "cheer" | "gasp" | "roar" | null;
  /** 0..1, for the crowd bed. */
  heat: number;
  /** Blows deep the current chain is, after this exchange. */
  streak: number;
};

/**
 * Read an exchange and decide what the arena does about it.
 *
 * `now` is passed in rather than read, so a replayed log and a live frame
 * behave identically and a test does not need a clock.
 */
export function hypeExchange(
  state: HypeState,
  exchange: HypeExchange,
  now: number,
  /** Bumped into the banner id, so React sees a new banner every time. */
  seed = now,
): HypeResult {
  const landed = !exchange.whiff && exchange.damage > 0;

  /* -------------------------------------------------------------- streaks */

  // A chain is one side landing blow after blow without the other answering.
  // A whiff does not break it — missing is part of pressure — but the other
  // body landing anything does, and so does letting the window lapse.
  let streakBy = state.streakBy;
  let streak = state.streak;
  if (landed) {
    const continuing = streakBy === exchange.actor && now - state.heatAt <= COMBO_WINDOW_MS;
    streakBy = exchange.actor;
    streak = continuing ? streak + 1 : 1;
  }
  // The blow that turns the exchange around counts for the defender, so a
  // parry that hurts is the moment the attacker's chain ends.
  if (exchange.riposte > 0) {
    streakBy = null;
    streak = 0;
  }

  /* ----------------------------------------------------------------- heat */

  let heat = decayHeat(state, now);
  if (landed) {
    heat += exchange.crit ? 0.3 : exchange.combo ? 0.24 : 0.16;
    if (exchange.killed) heat += 0.4;
  } else {
    // A whiff is still a swing: it keeps the room from cooling all the way off.
    heat += 0.04;
  }
  heat = Math.min(1, heat);

  /* ---------------------------------------------------------------- calls */

  const candidates: HypeCall[] = [];
  if (exchange.killed) candidates.push("ko");
  if (landed && !state.bloodDrawn) candidates.push("first_blood");
  if (landed && exchange.crit) candidates.push("critical");
  if (exchange.riposte > 0 || exchange.grade === "parry") candidates.push("counter");
  if (landed && streak >= 5) candidates.push("combo_big");
  else if (landed && (streak >= 3 || (exchange.combo && streak >= 2))) candidates.push("combo");
  // Nearly down, and not already down: the call that tells a player to press.
  if (landed && !exchange.killed && exchange.healthLeft != null && exchange.healthLeft <= 0.2) {
    candidates.push(exchange.mine ? "finish" : "danger");
  }
  // A big clean blow with nothing else special about it still deserves a nod.
  if (landed && candidates.length === 0 && exchange.damage >= 14) candidates.push("great");

  const call = pickCall(candidates, state.firedAt, now);
  const firedAt = call ? { ...state.firedAt, [call]: now } : state.firedAt;

  /* --------------------------------------------------------------- output */

  const banner = call ? bannerFor(call, exchange, streak, seed) : null;
  const crowd = crowdFor(call, exchange, landed);

  return {
    state: {
      streakBy,
      streak,
      bloodDrawn: state.bloodDrawn || landed,
      firedAt,
      heat,
      // Anchored to this exchange whether it landed or not: the decay clock and
      // the combo window are both "time since something happened".
      heatAt: now,
    },
    call,
    banner,
    crowd,
    heat,
    streak,
  };
}

function pickCall(
  candidates: readonly HypeCall[],
  firedAt: Partial<Record<HypeCall, number>>,
  now: number,
): HypeCall | null {
  // A call that has never fired is always ready. Written as an explicit
  // "never" rather than a zero default so the gate stays a real elapsed-time
  // check and does not quietly depend on `now` being a wall clock.
  const ready = candidates.filter((call) => {
    const last = firedAt[call];
    return last === undefined || now - last >= CALL_COOLDOWN_MS[call];
  });
  if (ready.length === 0) return null;
  return ready.reduce((best, call) => (RANK[call] > RANK[best] ? call : best));
}

function bannerFor(
  call: HypeCall,
  exchange: HypeExchange,
  streak: number,
  seed: number,
): HypeBanner {
  const mine = exchange.mine;
  switch (call) {
    case "ko":
      return {
        id: seed,
        call,
        headline: "K.O.",
        sub: mine ? "they are down" : "you are down",
        tone: mine ? "good" : "bad",
        ttl: 2.6,
      };
    case "first_blood":
      return {
        id: seed,
        call,
        headline: "FIRST BLOOD",
        sub: mine ? `${exchange.damage} damage` : "they drew it",
        tone: mine ? "good" : "bad",
        ttl: 1.8,
      };
    case "critical":
      return {
        id: seed,
        call,
        headline: "CRITICAL",
        sub: `${exchange.damage} damage`,
        tone: mine ? "hot" : "bad",
        ttl: 1.6,
      };
    case "counter":
      return {
        id: seed,
        call,
        headline: "COUNTER",
        sub: exchange.riposte > 0 ? `${exchange.riposte} back` : "read it",
        tone: mine ? "bad" : "good",
        ttl: 1.6,
      };
    case "combo":
      return { id: seed, call, headline: `COMBO ×${streak}`, sub: null, tone: mine ? "good" : "bad", ttl: 1.4 };
    case "combo_big":
      return {
        id: seed,
        call,
        headline: `COMBO ×${streak}`,
        sub: mine ? "relentless" : "get out of there",
        tone: mine ? "hot" : "bad",
        ttl: 2,
      };
    case "finish":
      return { id: seed, call, headline: "FINISH IT", sub: "they are one hit away", tone: "hot", ttl: 2 };
    case "danger":
      return { id: seed, call, headline: "DANGER", sub: "one hit from down", tone: "bad", ttl: 2 };
    case "great":
      return {
        id: seed,
        call,
        headline: mine ? "NICE HIT" : "THEY CONNECT",
        sub: `${exchange.damage} damage`,
        tone: mine ? "good" : "bad",
        ttl: 1.2,
      };
    case "perfect":
      return { id: seed, call, headline: "PERFECT", sub: "not a scratch on you", tone: "hot", ttl: 2.6 };
    case "win":
      return { id: seed, call, headline: "YOU WIN", sub: null, tone: "good", ttl: 3 };
    case "lose":
      return { id: seed, call, headline: "YOU LOSE", sub: null, tone: "bad", ttl: 3 };
    case "fight":
      return { id: seed, call, headline: "FIGHT", sub: null, tone: "hot", ttl: 1.4 };
    case "here_we_go":
      return { id: seed, call, headline: "HERE WE GO", sub: null, tone: "hot", ttl: 1.6 };
  }
}

function crowdFor(
  call: HypeCall | null,
  exchange: HypeExchange,
  landed: boolean,
): "cheer" | "gasp" | "roar" | null {
  if (exchange.killed) return "roar";
  if (!landed) return null;
  // The room reacts to who it just watched get hit, not to who threw it: a
  // crowd cheers a blow going out and gasps at one coming back.
  if (call === "critical" || call === "combo_big") return exchange.mine ? "cheer" : "gasp";
  if (call === "counter") return exchange.mine ? "gasp" : "cheer";
  if (call === "first_blood" || call === "combo") return exchange.mine ? "cheer" : "gasp";
  return null;
}

/* ---------------------------------------------------------- match bookends */

/** The call that opens a match, and the banner over it. */
export function openingHype(seed: number): { call: HypeCall; banner: HypeBanner } {
  return { call: "fight", banner: bannerFor("fight", blankExchange(), 0, seed) };
}

/**
 * The call that closes one.
 *
 * `perfect` beats `win` when the winner was never hit, which is the one piece
 * of fighting-game grammar a player notices the absence of.
 */
export function closingHype(
  outcome: { won: boolean; untouched: boolean },
  seed: number,
): { call: HypeCall; banner: HypeBanner } {
  const call: HypeCall = outcome.won ? (outcome.untouched ? "perfect" : "win") : "lose";
  return { call, banner: bannerFor(call, { ...blankExchange(), mine: outcome.won }, 0, seed) };
}

function blankExchange(): HypeExchange {
  return {
    mine: true,
    actor: "",
    damage: 0,
    crit: false,
    whiff: false,
    combo: false,
    grade: null,
    riposte: 0,
    killed: false,
    healthLeft: null,
    untouched: false,
  };
}

/* ------------------------------------------------------------- trash talk */

/**
 * What the other body says.
 *
 * The player's own character speaks through `avatars.speak`, which knows its
 * personality and can reach a model. The opponent cannot — a sparring partner
 * has no row to own, and a real opponent's character is not mine to ask on
 * behalf of — so its trash talk is written here and picked locally. Heel
 * energy on purpose: it is the voice you want to shut up.
 */
const TAUNTS = {
  /** It just hurt me. */
  landed: [
    "Felt that one, did you?",
    "Stay down. Easier for both of us.",
    "That is the level you are at.",
    "I have not started yet.",
    "Again? Same spot?",
    "You are making this boring.",
  ],
  /** I just hurt it. */
  hurt: [
    "Lucky. Do it twice.",
    "Nothing. Keep swinging.",
    "That all the hardware you brought?",
    "Tickles.",
    "You will tire before I do.",
  ],
  /** It is nearly down. */
  cornered: [
    "Fine. Now I am annoyed.",
    "You do not get to win this.",
    "One good hit. That is all I need.",
    "Come on then.",
  ],
  /** It won. */
  won: ["Told you.", "Not close.", "Bring a better one next time."],
} as const;

export type TauntKind = keyof typeof TAUNTS;

/**
 * A line for the opponent's bubble.
 *
 * Deterministic in `seed` so the same exchange replayed does not produce a
 * different taunt — the log is replayed on every reconnect, and a bubble that
 * rewrites itself reads as a glitch.
 */
export function taunt(kind: TauntKind, seed: number): string {
  const bank = TAUNTS[kind];
  const index = Math.abs(Math.trunc(seed)) % bank.length;
  return bank[index]!;
}

/** Which taunt an exchange earns the opponent, if any. */
export function tauntFor(exchange: HypeExchange, streak: number): TauntKind | null {
  if (exchange.killed) return exchange.mine ? null : "won";
  if (exchange.whiff || exchange.damage <= 0) return null;
  if (!exchange.mine && (exchange.crit || streak >= 3)) return "landed";
  if (exchange.mine && exchange.healthLeft != null && exchange.healthLeft <= 0.25) return "cornered";
  if (exchange.mine && exchange.damage >= 12) return "hurt";
  return null;
}

/* ------------------------------------------------------- the numbers, in words */

/**
 * One exchange, in one line.
 *
 * Every number in here was already computed and sent by the engine — the
 * grade it graded the guard at, the roll it rolled, the crit chance that roll
 * was against, how much breath the swing was thrown on. None of it was ever
 * visible, so a player who threw the same move twice for 19 and then 31 had no
 * way to tell variance from a mechanic they had failed to learn. This does not
 * decide anything; it reads the payload back.
 *
 * The dry counterpart to the callout above: this is the fight's arithmetic, the
 * banner is its theatre, and a player who wants to learn the system reads this
 * one.
 */
export function exchangeLine(payload: Record<string, unknown>, mine: boolean): string {
  const number = (key: string): number | null =>
    typeof payload[key] === "number" ? (payload[key] as number) : null;

  const parts: string[] = [mine ? "You" : "Them"];
  const label = typeof payload.gradeLabel === "string" ? payload.gradeLabel : null;
  if (label) parts.push(label);

  const damage = number("damage");
  if (payload.whiff === true) parts.push("no contact");
  else if (damage != null) parts.push(`${damage} dmg`);

  if (payload.crit === true) parts.push("CRIT");
  else {
    const chance = number("critChance");
    if (chance != null) parts.push(`crit ${Math.round(chance * 100)}%`);
  }

  // Variance comes back as a multiplier around 1 — shown as the swing it was
  // against the average, which is the form the question was asked in.
  const variance = number("variance");
  if (variance != null && Math.abs(variance - 1) >= 0.01) {
    const swing = Math.round((variance - 1) * 100);
    parts.push(`roll ${swing > 0 ? "+" : ""}${swing}%`);
  }

  const staminaScale = number("staminaScale");
  if (staminaScale != null && staminaScale < 1) {
    parts.push(`winded ×${staminaScale.toFixed(2)}`);
  }
  if (payload.cornered === true) parts.push("cornered");
  if (payload.riposte) parts.push("riposte");
  // The cancel, named. A window the player cannot see is a window they will
  // never press into, and "chain open" is the shortest way to say that the
  // hit they just landed bought them the next one.
  if (mine && payload.cancelled === true) parts.push("chain open");

  return parts.join(" · ");
}
