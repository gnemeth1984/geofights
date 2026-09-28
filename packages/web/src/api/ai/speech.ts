import { generateText } from "ai";
import dedent from "dedent";
import { z } from "zod";
import type { Personality } from "../database/schema";
import { pick } from "../lib/rng";
import { FAST_MODEL, aiConfigured, gateway } from "./gateway";

/**
 * Avatar voice lines.
 *
 * Speech is the most frequently generated content in the game — a player in a
 * park can trip a dozen contexts a minute — so this module is built around
 * never being on the critical path:
 *
 *   • every personality × context pair has a hand-written fallback bank, so a
 *     missing API key, a rate limit or a cold gateway still produces a line;
 *   • lines are capped hard at `MAX_CHARS`, because the bubble is rendered into
 *     a fixed canvas texture in the AR scene and a runaway model response would
 *     simply not fit;
 *   • the caller (services/avatars.ts) decides whether a context is worth an
 *     LLM round trip at all. This module only knows how to produce one line.
 */

export const SPEECH_CONTEXTS = [
  "booster_found",
  "booster_pickup",
  "battle_start",
  "victory",
  "hazard_warning",
  "idle",
] as const;
export type SpeechContext = (typeof SPEECH_CONTEXTS)[number];

export const speechContextSchema = z.enum(SPEECH_CONTEXTS);

/** The bubble is a fixed-width canvas texture — anything longer is unreadable. */
export const MAX_CHARS = 90;

const VOICE: Record<Personality, string> = {
  brash: "cocky, loud, spoiling for a fight. Talks trash and means it.",
  stoic: "clipped and calm. Says the minimum. Never rattled, never boasts.",
  manic: "fast, twitchy, over-caffeinated. Jumps between thoughts mid-sentence.",
  cold: "analytical and detached. Reports odds and facts like a targeting computer.",
  loyal: "warm and protective of its pilot. Speaks like a partner, not a weapon.",
  feral: "barely contained. Fragmented, hungry, more growl than grammar.",
};

const SITUATION: Record<SpeechContext, string> = {
  booster_found: "it has just spotted a booster module somewhere nearby, not yet picked up",
  booster_pickup: "its pilot just picked up and installed a booster module",
  battle_start: "a match against another player's character is starting right now",
  victory: "it just won the match",
  hazard_warning: "the area it is standing in has been flagged unsafe to play in",
  idle: "nothing is happening — it is standing on the pavement waiting for its pilot",
};

/**
 * How a levelled-up loadout reads in the voice lines. Booster instances level
 * from 1 to 5 by battling and exploring, and the character it is bolted to
 * should sound like it: level 1 is stock hardware, level 5 is overcharged.
 */
const POWER_TONE: Record<number, string> = {
  1: "its boosters are stock — it sounds untested, still finding its footing",
  2: "its boosters are worn in — it sounds competent",
  3: "its boosters are well levelled — it sounds confident, it has done this before",
  4: "its boosters are heavily levelled — it sounds dangerous and knows it",
  5: "its boosters are maxed and overcharged — it sounds unstoppable, humming with surplus power",
};

export function powerTone(loadoutLevel?: number | null) {
  const level = Math.min(5, Math.max(1, Math.round(loadoutLevel ?? 1)));
  return POWER_TONE[level]!;
}

/* ---------------------------------------------------------------- Generator */

export async function generateAvatarSpeech(input: {
  personality: Personality;
  context: SpeechContext;
  avatarName: string;
  /** Free-text scrap of detail: booster name, opponent name, hazard kind. */
  detail?: string | null;
  /** Highest equipped booster level, 1..5 — flavours how charged it sounds. */
  loadoutLevel?: number | null;
}): Promise<{ line: string; source: "ai" | "fallback" }> {
  const fallback = fallbackSpeech(input.personality, input.context, input.detail, input.loadoutLevel);
  if (!aiConfigured) return { line: fallback, source: "fallback" };
  try {
    const { text } = await generateText({
      model: gateway(FAST_MODEL),
      prompt: dedent`
        You write single spoken lines for characters in a competitive AR battle game
        played outdoors on phones. Sharp, punchy, sci-fi industrial. No emoji, no
        markdown, no stage directions, no surrounding quotation marks.

        The character is called ${input.avatarName}.
        Its personality: ${VOICE[input.personality]}
        Its hardware right now: ${powerTone(input.loadoutLevel)}.
        Situation: ${SITUATION[input.context]}.
        ${input.detail ? `Relevant detail: ${input.detail}.` : ""}

        Write exactly one line it says out loud, in character, at most 14 words.
        It speaks to its own pilot, not to the camera. Plain text only.
      `,
    });
    const line = clean(text);
    return line ? { line, source: "ai" } : { line: fallback, source: "fallback" };
  } catch {
    return { line: fallback, source: "fallback" };
  }
}

/** Strip the things models add around a one-liner, then hard-cap the length. */
function clean(raw: string): string {
  let line = raw.trim().split("\n")[0]?.trim() ?? "";
  line = line.replace(/^["'`*\-\s]+|["'`*\s]+$/g, "");
  // A model that ignored "one line" gets truncated at a sentence boundary.
  if (line.length > MAX_CHARS) {
    const cut = line.slice(0, MAX_CHARS);
    const stop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    line = stop > 30 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
  }
  return line;
}

/* ---------------------------------------------------------------- Fallbacks */

type Bank = Record<SpeechContext, readonly string[]>;

const BANKS: Record<Personality, Bank> = {
  brash: {
    booster_found: ["That one's mine. Go get it.", "Free parts. Move."],
    booster_pickup: ["Now we're talking.", "Bolt it on. I'll break something with it."],
    battle_start: ["Finally. Point me at it.", "This ends fast."],
    victory: ["Was that it? Next.", "Told you. Not close."],
    hazard_warning: ["Bad ground. I don't like it either.", "Not here. Back up."],
    idle: ["Standing around isn't winning.", "Any day now, pilot."],
  },
  stoic: {
    booster_found: ["Module. Nearby.", "Something's out there. Worth a look."],
    booster_pickup: ["Installed.", "Good. That will hold."],
    battle_start: ["Contact. Ready.", "Standing by."],
    victory: ["Done.", "Match closed. No damage worth logging."],
    hazard_warning: ["This spot is unsafe. Moving is better.", "Not here."],
    idle: ["Holding position.", "Still here."],
  },
  manic: {
    booster_found: ["Ooh — parts, parts, parts! Left? It's left!", "I smell upgrades. Go go go."],
    booster_pickup: ["Bolted! Wired! Humming! Love it!", "Yes! What else have you got?"],
    battle_start: ["Fight fight fight — oh this is going to be great.", "Here we go! Don't blink!"],
    victory: ["Did you see that? Did you SEE that?", "Again! Let's do it again!"],
    hazard_warning: ["Nope nope nope. Wrong ground. Out.", "Bad spot! Bad spot! Move!"],
    idle: ["Are we going? We going? Let's go.", "I could be doing something right now."],
  },
  cold: {
    booster_found: ["Module detected within range.", "Signal reads as a pickup. Recommend collection."],
    booster_pickup: ["Integrated. Output up.", "Modifiers applied. Margin improved."],
    battle_start: ["Opponent acquired. Odds acceptable.", "Engagement window open."],
    victory: ["Objective complete. Efficiency noted.", "Opponent disabled. Logging result."],
    hazard_warning: ["Location flagged unsafe. Withdraw.", "Risk exceeds tolerance. Relocate."],
    idle: ["Systems nominal. Awaiting input.", "Idle. Power draw minimal."],
  },
  loyal: {
    booster_found: ["Something good out there. Want me to wait?", "There's a module close. Your call."],
    booster_pickup: ["Thanks — I feel that already.", "Good find. We're stronger for it."],
    battle_start: ["Stay where you are. I've got this.", "Right behind you. Let's go carefully."],
    victory: ["We did that together.", "You picked the right fight."],
    hazard_warning: ["I don't like this spot. Please step back.", "Your safety first. Let's move."],
    idle: ["Take your time. I'm not going anywhere.", "Whenever you're ready."],
  },
  feral: {
    booster_found: ["Something close. Want.", "Scrap. Near. Take it."],
    booster_pickup: ["Mine now. Good.", "More. Bolt it on."],
    battle_start: ["Prey.", "Let me off the chain."],
    victory: ["Down. Stay down.", "Broke it. Find another."],
    hazard_warning: ["Wrong ground. Hurts.", "No. Not here."],
    idle: ["Restless.", "Too quiet. Hunt soon."],
  },
};

/**
 * Level-flavoured fallbacks. Only the two contexts where surplus power is
 * actually felt get their own bank; everything else reads fine at any level.
 */
const CHARGED: Record<Personality, Partial<Bank>> = {
  brash: {
    battle_start: ["Overcharged and bored. Point me at it.", "I'm running hot. This won't be fair."],
    victory: ["Barely warmed up. Line up the next one.", "That's what maxed hardware does."],
  },
  stoic: {
    battle_start: ["Boosters at peak. Ready.", "Surplus power. Contact."],
    victory: ["Clean. Hardware held.", "Done, and nothing strained."],
  },
  manic: {
    battle_start: ["Everything's at FIVE — do you feel that? Go!", "Maxed! Humming! Let me off!"],
    victory: ["MAXED and MOVING — again, again!", "Power to spare! Who's next?"],
  },
  cold: {
    battle_start: ["Loadout at maximum. Odds strongly favourable.", "Peak output. Engagement trivial."],
    victory: ["Overpowered as expected. Logged.", "Margin was never in question."],
  },
  loyal: {
    battle_start: ["We've levelled into this. I'm ready.", "Everything you fed me is in here. Let's go."],
    victory: ["All that training paid off.", "We grew into that one together."],
  },
  feral: {
    battle_start: ["Too much power. Let go.", "Full. Hungry. Release."],
    victory: ["Broke it easy. More.", "Still full. Find another."],
  },
};

export function fallbackSpeech(
  personality: Personality,
  context: SpeechContext,
  detail?: string | null,
  loadoutLevel?: number | null,
): string {
  const charged = (loadoutLevel ?? 1) >= 4 ? CHARGED[personality][context] : undefined;
  const line = pick(charged ?? BANKS[personality][context]);
  // Booster pickups read flat without the thing that was picked up, and that
  // is the one context where the detail is always known.
  if (context === "booster_pickup" && detail) {
    const withDetail = `${detail}. ${line}`;
    if (withDetail.length <= MAX_CHARS) return withDetail;
  }
  return line;
}
