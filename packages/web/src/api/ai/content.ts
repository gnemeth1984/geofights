import { generateObject, generateText } from "ai";
import dedent from "dedent";
import { z } from "zod";
import type { Rarity } from "../database/schema";
import { pick, randomInt, RARITY_POWER } from "../lib/rng";
import { FAST_MODEL, SMART_MODEL, aiConfigured, gateway } from "./gateway";

/**
 * AI content engine.
 *
 * Every generator returns a fully valid object even when the model is
 * unreachable: `fallback*` builders produce deterministic content from word
 * banks so the game (and the cron jobs) never block on the LLM.
 */

export const avatarContentSchema = z.object({
  name: z.string().min(2).max(28),
  specialAbility: z.string().min(2).max(32),
  abilityDescription: z.string().min(10).max(220),
  ability: z.object({
    damage: z.number().min(0).max(120),
    cooldownSeconds: z.number().min(3).max(90),
    effect: z.enum(["burst", "beam", "shield", "heal", "slow", "stun", "drain", "summon"]),
    radiusM: z.number().min(0).max(60),
  }),
  lore: z.string().min(20).max(320),
  modelHint: z.string().min(2).max(40),
});
export type AvatarContent = z.infer<typeof avatarContentSchema>;

export const boosterContentSchema = z.object({
  name: z.string().min(2).max(30),
  description: z.string().min(10).max(220),
  unlocksAbility: z.string().max(32).nullable(),
  abilityDescription: z.string().max(200).nullable(),
});
export type BoosterContent = z.infer<typeof boosterContentSchema>;

const STYLE = dedent`
  You write content for a competitive multiplayer AR battle game played outdoors
  on phones. Characters fight in real-world locations. Tone: sharp, punchy,
  sci-fi industrial. No emoji, no markdown, no quotation marks around names.
`;

/* ------------------------------------------------------------------ Avatars */

export async function generateAvatarContent(input: {
  rarity: Rarity;
  playerName: string;
  theme?: string;
}): Promise<AvatarContent> {
  if (!aiConfigured) return fallbackAvatar(input.rarity);
  try {
    const { object } = await generateObject({
      model: gateway(input.rarity === "legendary" ? SMART_MODEL : FAST_MODEL),
      schema: avatarContentSchema,
      prompt: dedent`
        ${STYLE}

        Design a battle character avatar. A character is a procedural creature —
        it can take any form or shape (beast, insectoid, drifting mass, quadruped
        strider). Do not default to a humanoid robot.
        Rarity: ${input.rarity} (higher rarity = more distinctive and intimidating).
        Owner callsign: ${input.playerName}.
        ${input.theme ? `Theme request: ${input.theme}.` : ""}

        Ability power must match the rarity: common ability damage 10-20,
        uncommon 18-28, rare 26-40, epic 38-60, legendary 55-90.
        modelHint is a short slug the 3D client maps to a mesh, e.g. "quad-strider-heavy".
      `,
    });
    return object;
  } catch {
    return fallbackAvatar(input.rarity);
  }
}

/* ----------------------------------------------------------------- Boosters */

export async function generateBoosterContent(input: {
  rarity: Rarity;
  statModifiers: Record<string, number>;
  origin: "shop" | "nature" | "battle" | "any";
  tier: number;
}): Promise<BoosterContent> {
  if (!aiConfigured) return fallbackBooster(input.rarity, input.statModifiers);
  try {
    const { object } = await generateObject({
      model: gateway(FAST_MODEL),
      schema: boosterContentSchema,
      prompt: dedent`
        ${STYLE}

        Name and describe a booster module that bolts onto a battle character.
        Rarity: ${input.rarity}. Tier: ${input.tier}. Found via: ${input.origin}.
        Stat modifiers it grants: ${JSON.stringify(input.statModifiers)}.

        The description must mention what it feels like in combat, in one or two sentences.
        Only rare or better boosters unlock an ability — otherwise set
        unlocksAbility and abilityDescription to null.
      `,
    });
    return object;
  } catch {
    return fallbackBooster(input.rarity, input.statModifiers);
  }
}

/* ------------------------------------------------------------ Nature spawns */

export async function generateSpawnDescription(input: {
  boosterName: string;
  rarity: Rarity;
  zoneName: string;
  terrain?: string | null;
}): Promise<string> {
  if (!aiConfigured) return fallbackSpawnDescription(input);
  try {
    const { text } = await generateText({
      model: gateway(FAST_MODEL),
      prompt: dedent`
        ${STYLE}

        One sentence (max 22 words) telling a player what they see when they walk
        up to a ${input.rarity} booster called "${input.boosterName}" hidden in
        ${input.zoneName}${input.terrain ? ` (${input.terrain})` : ""}.
        Plain text only.
      `,
    });
    return text.trim().slice(0, 220) || fallbackSpawnDescription(input);
  } catch {
    return fallbackSpawnDescription(input);
  }
}

/* ----------------------------------------------- Battle lines and summaries */

export async function generateBattleMessage(input: {
  kind: "hit" | "miss" | "ability" | "death" | "start";
  actor: string;
  target?: string;
  damage?: number;
  ability?: string;
  /** Guard grade label for hits and misses — "Parried", "Blocked", "Whiffed". */
  grade?: string;
}): Promise<string> {
  const fallback = fallbackBattleMessage(input);
  if (!aiConfigured) return fallback;
  try {
    const { text } = await generateText({
      model: gateway(FAST_MODEL),
      prompt: dedent`
        ${STYLE}

        Write one commentary line (max 16 words, plain text) for this combat event:
        ${JSON.stringify(input)}
      `,
    });
    return text.trim().slice(0, 160) || fallback;
  } catch {
    return fallback;
  }
}

export async function generateMatchSummary(input: {
  zoneName: string;
  winner: string | null;
  scoreboard: { username: string; avatar: string; kills: number; damageDealt: number; alive: boolean }[];
}): Promise<string> {
  const fallback = fallbackMatchSummary(input);
  if (!aiConfigured) return fallback;
  try {
    const { text } = await generateText({
      model: gateway(FAST_MODEL),
      prompt: dedent`
        ${STYLE}

        Write a 2-3 sentence recap of this AR battle in ${input.zoneName}.
        Winner: ${input.winner ?? "nobody — draw"}.
        Scoreboard: ${JSON.stringify(input.scoreboard)}.
        Name the standout performance. Plain text.
      `,
    });
    return text.trim().slice(0, 600) || fallback;
  } catch {
    return fallback;
  }
}

/* ---------------------------------------------------------------- Fallbacks */

const PREFIX = ["Iron", "Vex", "Null", "Cobalt", "Ash", "Hex", "Rift", "Sable", "Volt", "Kilo"];
const SUFFIX = ["strider", "maw", "vane", "husk", "fang", "sentinel", "crawler", "reaver", "sigil", "warden"];
const ABILITIES = ["Overload Pulse", "Phase Dash", "Rail Lance", "Static Bloom", "Kinetic Ward", "Scrap Storm"];
const EFFECTS = ["burst", "beam", "shield", "heal", "slow", "stun", "drain", "summon"] as const;
const MODULES = ["Servo", "Coolant", "Plating", "Gyro", "Capacitor", "Lattice", "Driver", "Shroud"];

export function fallbackAvatar(rarity: Rarity): AvatarContent {
  const power = RARITY_POWER[rarity];
  const name = `${pick(PREFIX)} ${pick(SUFFIX)}`;
  const ability = pick(ABILITIES);
  return {
    name,
    specialAbility: ability,
    abilityDescription: `${ability} discharges stored energy at everything locked in front of ${name}.`,
    ability: {
      damage: Math.round(16 * power),
      cooldownSeconds: randomInt(8, 20),
      effect: pick(EFFECTS),
      radiusM: randomInt(4, 18),
    },
    lore: `${name} was pulled out of a scrap convoy and rebuilt for street-level combat. It has never powered down willingly.`,
    modelHint: `${pick(SUFFIX)}-${rarity}`,
  };
}

export function fallbackBooster(rarity: Rarity, mods: Record<string, number>): BoosterContent {
  const name = `${pick(MODULES)} ${pick(["Mk I", "Mk II", "Core", "Relay", "Array"])}`;
  const top = Object.entries(mods).sort((a, b) => b[1] - a[1])[0];
  const unlocks = rarity === "rare" || rarity === "epic" || rarity === "legendary";
  const ability = pick(ABILITIES);
  return {
    name,
    description: `A ${rarity} module that pushes ${top?.[0] ?? "output"} by ${top?.[1] ?? 1}. You feel the chassis hum when it engages.`,
    unlocksAbility: unlocks ? ability : null,
    abilityDescription: unlocks ? `${ability} comes online while this module is bolted on.` : null,
  };
}

export function fallbackSpawnDescription(input: { boosterName: string; rarity: Rarity; zoneName: string }) {
  return `A ${input.rarity} crate marked ${input.boosterName} sits half-buried where the path bends through ${input.zoneName}.`;
}

export function fallbackBattleMessage(input: {
  kind: "hit" | "miss" | "ability" | "death" | "start";
  actor: string;
  target?: string;
  damage?: number;
  ability?: string;
  /** Guard grade label for hits and misses — "Parried", "Blocked", "Whiffed". */
  grade?: string;
}) {
  switch (input.kind) {
    case "hit":
      return input.grade && input.grade !== "Clean hit"
        ? `${input.actor} gets through ${input.target}'s ${input.grade.toLowerCase()} for ${input.damage}.`
        : `${input.actor} lands a clean hit on ${input.target} for ${input.damage} damage.`;
    case "miss":
      return input.grade === "Whiffed"
        ? `${input.actor} swings through empty air — ${input.target} was never in range.`
        : `${input.target} reads it perfectly. ${input.actor} hits nothing.`;
    case "ability":
      return `${input.actor} triggers ${input.ability ?? "an ability"} — ${input.target ?? "the area"} takes ${input.damage ?? 0}.`;
    case "death":
      return `${input.target} goes down. ${input.actor} moves on.`;
    default:
      return `${input.actor} enters the arena.`;
  }
}

export function fallbackMatchSummary(input: {
  zoneName: string;
  winner: string | null;
  scoreboard: { username: string; kills: number; damageDealt: number }[];
}) {
  const top = [...input.scoreboard].sort((a, b) => b.damageDealt - a.damageDealt)[0];
  return `${input.winner ? `${input.winner} took the zone` : "Nobody held the zone"} in ${input.zoneName}. ${
    top ? `${top.username} pushed the most damage (${top.damageDealt}) with ${top.kills} knockouts.` : ""
  }`.trim();
}
