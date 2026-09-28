import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { PERSONALITIES, type Personality, type Rarity } from "../database/schema";
import { generateAvatarContent } from "../ai/content";
import {
  fallbackSpeech as fallbackSpeechFor,
  generateAvatarSpeech,
  type SpeechContext,
} from "../ai/speech";
import { ids } from "../lib/ids";
import {
  applyCategory,
  CATEGORY_LABELS,
  CREATURE_CATEGORIES,
  formFromJson,
  grandnessOf,
  modelIdForForm,
  movesForForm,
  nameForForm,
  parseCreatureDescription,
  statWeightsForForm,
  type CreatureCategory,
  type CreatureForm,
} from "../lib/creature-form";
import { RARITY_POWER, randomInt, rollRarity } from "../lib/rng";
import { MAX_AVATARS_PER_PLAYER } from "./players";
import { effectiveStats } from "../battle/stats";

/** Base stat spread before rarity scaling. */
function rollBaseStats(rarity: Rarity) {
  const power = RARITY_POWER[rarity];
  return {
    attack: Math.round(randomInt(10, 16) * power),
    defense: Math.round(randomInt(8, 15) * power),
    speed: Math.round(randomInt(8, 15) * power),
    health: Math.round(randomInt(90, 120) * power),
  };
}

/**
 * Pick a voice from the stat spread, so the personality is a readable
 * consequence of the character rather than a random label: the thing that hits
 * hardest talks the hardest. `feral` and `loyal` are the flavour outliers —
 * legendaries get feral, low-power builds get loyal — which keeps all six in
 * circulation without rolling a personality that contradicts the stats.
 */
export function personalityFor(input: {
  attack: number;
  defense: number;
  speed: number;
  rarity: Rarity;
}): Personality {
  if (input.rarity === "legendary") return "feral";
  const { attack, defense, speed } = input;
  const top = Math.max(attack, defense, speed);
  if (input.rarity === "common" && top === defense) return "loyal";
  if (top === attack) return "brash";
  if (top === speed) return attack >= defense ? "manic" : "cold";
  return "stoic";
}

export async function listAvatars(ownerId: string) {
  const avatars = await db
    .select()
    .from(schema.avatar)
    .where(eq(schema.avatar.ownerId, ownerId))
    .orderBy(desc(schema.avatar.createdAt));
  return Promise.all(
    avatars.map(async (avatar) => {
      const stats = await effectiveStats(avatar.id);
      return { ...avatar, effective: stats.effective, bonus: stats.bonus, boosters: stats.boosters, abilities: stats.abilities };
    }),
  );
}

export async function getAvatarOwned(avatarId: string, ownerId: string) {
  const [avatar] = await db
    .select()
    .from(schema.avatar)
    .where(and(eq(schema.avatar.id, avatarId), eq(schema.avatar.ownerId, ownerId)));
  if (!avatar) throw new ORPCError("NOT_FOUND", { message: "Avatar not found" });
  return avatar;
}

/** AI-generate an avatar for a player, enforcing the 3-avatar cap. */
export async function generateAvatar(input: {
  ownerId: string;
  playerName: string;
  theme?: string;
  rarity?: Rarity;
}) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.avatar)
    .where(eq(schema.avatar.ownerId, input.ownerId));
  if (Number(row?.count ?? 0) >= MAX_AVATARS_PER_PLAYER) {
    throw new ORPCError("BAD_REQUEST", {
      message: `You can hold ${MAX_AVATARS_PER_PLAYER} avatars — release one first`,
    });
  }

  const rarity = input.rarity ?? rollRarity();
  const stats = rollBaseStats(rarity);
  const content = await generateAvatarContent({
    rarity,
    playerName: input.playerName,
    theme: input.theme,
  });

  const [avatar] = await db
    .insert(schema.avatar)
    .values({
      id: ids.avatar(),
      ownerId: input.ownerId,
      name: content.name,
      modelId: content.modelHint,
      attack: stats.attack,
      defense: stats.defense,
      speed: stats.speed,
      health: stats.health,
      rarity,
      personality: personalityFor({ ...stats, rarity }),
      specialAbility: content.specialAbility,
      abilityDescription: content.abilityDescription,
      abilityConfig: JSON.stringify(content.ability),
      lore: content.lore,
    })
    .returning();
  return avatar!;
}

/* ------------------------------------------------- generate from description */

/**
 * Ability lifted from the strongest move the body can actually perform, so the
 * special matches the creature the player described. Deterministic on purpose:
 * the preview a player accepts is exactly the row that gets written.
 */
const ABILITY_FOR_MOVE: Record<string, { name: string; effect: string; damage: number; cooldownSeconds: number; radiusM?: number; description: string }> = {
  elemental_burst: { name: "Elemental Burst", effect: "aoe", damage: 26, cooldownSeconds: 22, radiusM: 12, description: "Releases its stored energy in a ring, hitting everything close by." },
  ground_slam: { name: "Ground Slam", effect: "aoe", damage: 24, cooldownSeconds: 20, radiusM: 10, description: "Drops its full weight into the ground and shakes everyone standing on it." },
  spike_burst: { name: "Spike Burst", effect: "aoe", damage: 20, cooldownSeconds: 16, radiusM: 8, description: "Flares every spike outward at once." },
  wing_gust: { name: "Wing Gust", effect: "knockback", damage: 18, cooldownSeconds: 15, radiusM: 9, description: "One hard downbeat that shoves the target off its footing." },
  tail_whip: { name: "Tail Whip", effect: "damage", damage: 19, cooldownSeconds: 12, description: "Pivots and lands the length of its tail across the target." },
  charge: { name: "Charge", effect: "damage", damage: 22, cooldownSeconds: 14, description: "Closes the gap far faster than it should be able to." },
  swipe: { name: "Rending Swipe", effect: "damage", damage: 17, cooldownSeconds: 10, description: "A wide arcing strike that opens up armour." },
  bite: { name: "Crushing Bite", effect: "damage", damage: 20, cooldownSeconds: 12, description: "Commits its whole body weight to one snap." },
  // The category moves. Damage tracks each move's combat power and cooldown
  // tracks its commitment, so the special is recognisably the same blow the
  // creature already throws — just the big version of it.
  fire_breath: { name: "Dragon Breath", effect: "burn", damage: 25, cooldownSeconds: 20, radiusM: 10, description: "Opens its throat and holds the fire on the target." },
  piston_slam: { name: "Piston Slam", effect: "damage", damage: 26, cooldownSeconds: 18, description: "Drives its whole frame forward on one stroke, with nothing held back." },
  dive_bomb: { name: "Dive Bomb", effect: "knockback", damage: 24, cooldownSeconds: 16, radiusM: 6, description: "Climbs, turns over and comes down talons-first." },
  grapple: { name: "Grapple Throw", effect: "knockback", damage: 23, cooldownSeconds: 15, radiusM: 4, description: "Takes hold, turns its hips, and puts the target on the ground." },
  pounce: { name: "Pounce", effect: "damage", damage: 21, cooldownSeconds: 13, description: "Covers the gap in one bound and lands on top of the target." },
  pincer_snap: { name: "Pincer Snap", effect: "damage", damage: 16, cooldownSeconds: 9, description: "Two closes of the claw, faster than either of them can be read." },
  kick: { name: "Heavy Kick", effect: "damage", damage: 18, cooldownSeconds: 11, description: "Chambers the knee and puts a leg through the target's guard." },
  punch: { name: "Straight Punch", effect: "damage", damage: 15, cooldownSeconds: 8, description: "The shortest, cheapest, most repeatable thing it knows." },
};

/**
 * Best ability the described body can justify, in descending order of drama.
 *
 * The category moves are placed so each category's special is the thing that
 * category *is* — breath for a dragon, the piston for a machine, the throw for
 * a human-like body — rather than whatever generic move its parts happened to
 * also allow. Before categories existed this list ended at `bite`, which is
 * why a human-like creature used to end up with a Crushing Bite as its
 * signature.
 */
function abilityForForm(form: CreatureForm) {
  const { attacks } = movesForForm(form, 1);
  const order = [
    "elemental_burst",
    "fire_breath",
    "piston_slam",
    "dive_bomb",
    "grapple",
    "ground_slam",
    "pounce",
    "spike_burst",
    "wing_gust",
    "pincer_snap",
    "tail_whip",
    "kick",
    "charge",
    "swipe",
    "punch",
    "bite",
  ];
  const chosen = order.find((move) => attacks.includes(move as never)) ?? "bite";
  return ABILITY_FOR_MOVE[chosen]!;
}

/** Lore written from the form, so it describes the creature actually rendered. */
function loreForForm(form: CreatureForm, description: string, name: string) {
  const parts: string[] = [];
  const bodyWord: Record<string, string> = {
    serpentine: "a long coiling body",
    bulky: "a heavy slab of a body",
    lithe: "a lean, quick frame",
    orb: "no body to speak of — it simply floats",
    insectoid: "a low segmented shell",
    upright: "an upright frame",
  };
  // The category leads the lore, because it is the thing a player picked and
  // the thing that decides how the creature fights. The body shape follows it.
  const categoryLead: Record<string, string> = {
    humanoid: "stands and fights like a person",
    beastly: "moves like an animal",
    draconic: "carries itself like something much older",
    insectoid: "runs low and fast and close to the ground",
    mechanical: "was built rather than born",
    avian: "would rather be in the air than on the floor",
    ethereal: "never quite touches the ground",
  };
  const lead = categoryLead[form.category];
  parts.push(
    lead
      ? `${name} ${lead}, and has ${bodyWord[form.bodyShape] ?? "an odd frame"}`
      : `${name} has ${bodyWord[form.bodyShape] ?? "an odd frame"}`,
  );
  if (form.limbCount > 0) parts.push(`${form.limbCount} legs`);
  if (form.wings > 0) parts.push(`${form.wings} wings`);
  if (form.horns > 0) parts.push(`${form.horns} horns`);
  if (form.spikes > 0) parts.push(`${form.spikes} spikes down its back`);
  if (form.tail !== "none") parts.push(`a ${form.tail} tail`);
  const glowLine =
    form.glow >= 0.7
      ? " It is lit from the inside and hard to look away from."
      : form.glow <= 0.2
        ? " Nothing about it catches the light."
        : " Faint light moves under its skin.";
  return `${parts.join(", ")}.${glowLine} Summoned from: "${description.trim()}".`;
}

/**
 * Build a creature from a player's sentence.
 *
 * Two modes, one code path. `persist: false` (the default) returns the creature
 * without writing anything — that is what "Generate" and "Regenerate" call, so
 * a player can roll through bodies without burning avatar slots or hitting the
 * cap. `persist: true` writes exactly the same object to the avatar row, so
 * what was previewed is what gets saved.
 *
 * Generation is entirely local and deterministic: no model call, so a creature
 * appears the frame the request returns, works with no AI budget, and the same
 * description plus the same seed rebuilds the identical creature forever.
 */
export async function generateAvatarFromDescription(input: {
  ownerId: string;
  description: string;
  /** Changes every roll from the same words. "Regenerate" just bumps it. */
  seed?: number;
  /**
   * The category the player picked in the lab, when they picked one. Omitted,
   * the description decides it (`detectCategory`) — so typing "a boxer" still
   * gets a human-like body without touching the picker.
   */
  category?: CreatureCategory;
  persist?: boolean;
}) {
  const description = input.description.trim();
  if (description.length < 3) {
    throw new ORPCError("BAD_REQUEST", { message: "Describe the creature in a few words" });
  }

  // The seed is now the only source of variation for traits the sentence left
  // unsaid, so an omitted one has to be rolled here — a fixed default would
  // hand every player who typed the same words the identical creature.
  const seed = Math.round(input.seed ?? Math.floor(Math.random() * 1_000_000));
  const form = parseCreatureDescription(description, seed, input.category);
  const name = nameForForm(form, seed);
  const modelId = modelIdForForm(form);

  // Grand words in the description ("ancient", "mythic") buy extra rolls at a
  // better rarity rather than granting one outright — describing a legendary
  // does not make it one, it only improves the odds.
  const grand = Math.min(3, grandnessOf(description));
  let rarity = rollRarity();
  for (let i = 0; i < grand; i += 1) {
    const candidate = rollRarity();
    if (RARITY_POWER[candidate] > RARITY_POWER[rarity]) rarity = candidate;
  }

  // The body decides the stat spread: mass defends, wings and lean frames are
  // fast, spikes and horns hit harder (see `statWeightsForForm`).
  const weights = statWeightsForForm(form);
  const base = rollBaseStats(rarity);
  const stats = {
    attack: Math.max(1, Math.round(base.attack * weights.attack)),
    defense: Math.max(1, Math.round(base.defense * weights.defense)),
    speed: Math.max(1, Math.round(base.speed * weights.speed)),
    health: Math.max(10, Math.round(base.health * weights.health)),
  };

  const ability = abilityForForm(form);
  const personality = personalityFor({ ...stats, rarity });
  const moves = movesForForm(form, 1);

  const draft = {
    id: ids.avatar(),
    ownerId: input.ownerId,
    name,
    modelId,
    ...stats,
    rarity,
    personality,
    form: JSON.stringify(form),
    formDescription: description,
    specialAbility: ability.name,
    abilityDescription: ability.description,
    abilityConfig: JSON.stringify({
      damage: ability.damage,
      cooldownSeconds: ability.cooldownSeconds,
      effect: ability.effect,
      radiusM: ability.radiusM ?? null,
    }),
    lore: loreForForm(form, description, name),
  };

  // A preview costs nothing and writes nothing, so the cap is only enforced on
  // the way in — otherwise a player at the cap could not even look.
  if (!input.persist) {
    return { saved: false as const, avatar: draft, form, seed, moves };
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.avatar)
    .where(eq(schema.avatar.ownerId, input.ownerId));
  if (Number(row?.count ?? 0) >= MAX_AVATARS_PER_PLAYER) {
    throw new ORPCError("BAD_REQUEST", {
      message: `You can hold ${MAX_AVATARS_PER_PLAYER} avatars — release one first`,
    });
  }

  const [saved] = await db.insert(schema.avatar).values(draft).returning();
  return { saved: true as const, avatar: saved!, form, seed, moves };
}

export async function renameAvatar(input: { avatarId: string; ownerId: string; name: string }) {
  await getAvatarOwned(input.avatarId, input.ownerId);
  const [updated] = await db
    .update(schema.avatar)
    .set({ name: input.name, updatedAt: new Date() })
    .where(eq(schema.avatar.id, input.avatarId))
    .returning();
  return updated!;
}

/**
 * Re-train a saved character into another creature category.
 *
 * Categories are deliberately not locked at creation: a player who built a
 * beast and then wanted to see it throw hands should not have to release it
 * and roll the description again. The body is re-planned onto the new category
 * (`applyCategory`), and everything downstream of the body is re-derived from
 * it — model id, stats, special ability, lore and moveset — so the character
 * stays internally consistent instead of being a beast wearing humanoid moves.
 *
 * What is deliberately *kept*: the name the player chose, the rarity they
 * rolled, the personality, the original description, and every equipped
 * booster. None of those are consequences of the body, and re-rolling them here
 * would turn a re-train into a re-roll — which is the thing this exists to
 * avoid, and which would also hand players a way to re-roll rarity for free.
 */
export async function setAvatarCategory(input: {
  avatarId: string;
  ownerId: string;
  category: CreatureCategory;
}) {
  if (!CREATURE_CATEGORIES.includes(input.category)) {
    throw new ORPCError("BAD_REQUEST", { message: "Unknown creature category" });
  }
  const avatar = await getAvatarOwned(input.avatarId, input.ownerId);

  // A category swap mid-fight would change the moveset and the stats of a
  // character the engine is already resolving hits against.
  const [activeMatch] = await db
    .select({ id: schema.battleState.id })
    .from(schema.battleState)
    .innerJoin(schema.match, eq(schema.match.id, schema.battleState.matchId))
    .where(and(eq(schema.battleState.avatarId, avatar.id), eq(schema.match.status, "active")));
  if (activeMatch) throw new ORPCError("BAD_REQUEST", { message: "Avatar is in an active match" });

  const current = formFromJson(avatar.form, { modelId: avatar.modelId, rarity: avatar.rarity });
  if (current.category === input.category) {
    const moves = movesForForm(current, 1);
    return { avatar, form: current, moves, changed: false as const };
  }
  const form = applyCategory(current, input.category);

  // Stats are stored already-weighted, and the base roll is not kept, so the
  // old category's weighting has to be divided back out before the new one is
  // applied. Rounding costs at most a point per stat, which is the price of
  // not storing a second copy of every stat forever — and far better than the
  // alternatives of re-rolling the base (a free rarity re-roll) or compounding
  // the new weights onto the old (a character that gains stats every swap).
  const before = statWeightsForForm(current);
  const after = statWeightsForForm(form);
  const rescale = (value: number, floor: number, key: keyof typeof before) =>
    Math.max(floor, Math.round((value / before[key]) * after[key]));
  const stats = {
    attack: rescale(avatar.attack, 1, "attack"),
    defense: rescale(avatar.defense, 1, "defense"),
    speed: rescale(avatar.speed, 1, "speed"),
    health: rescale(avatar.health, 10, "health"),
  };

  const ability = abilityForForm(form);
  const description = avatar.formDescription ?? avatar.name;
  const [updated] = await db
    .update(schema.avatar)
    .set({
      ...stats,
      modelId: modelIdForForm(form),
      form: JSON.stringify(form),
      specialAbility: ability.name,
      abilityDescription: ability.description,
      abilityConfig: JSON.stringify({
        damage: ability.damage,
        cooldownSeconds: ability.cooldownSeconds,
        effect: ability.effect,
        radiusM: ability.radiusM ?? null,
      }),
      lore: loreForForm(form, description, avatar.name),
      updatedAt: new Date(),
    })
    .where(eq(schema.avatar.id, avatar.id))
    .returning();

  return {
    avatar: updated!,
    form,
    moves: movesForForm(form, 1),
    changed: true as const,
    label: CATEGORY_LABELS[input.category].label,
  };
}

/** Release an avatar, freeing a slot. Equipped boosters return to the inventory. */
export async function releaseAvatar(avatarId: string, ownerId: string) {
  await getAvatarOwned(avatarId, ownerId);
  const [activeMatch] = await db
    .select({ id: schema.battleState.id })
    .from(schema.battleState)
    .innerJoin(schema.match, eq(schema.match.id, schema.battleState.matchId))
    .where(and(eq(schema.battleState.avatarId, avatarId), eq(schema.match.status, "active")));
  if (activeMatch) throw new ORPCError("BAD_REQUEST", { message: "Avatar is in an active match" });

  await db
    .update(schema.boosterInstance)
    .set({ equippedAvatarId: null })
    .where(eq(schema.boosterInstance.equippedAvatarId, avatarId));
  await db.delete(schema.avatar).where(eq(schema.avatar.id, avatarId));
  return { released: avatarId };
}

/* ------------------------------------------------------------------ Speech */

/**
 * Minimum gap between *model-generated* lines for one avatar. Under it the
 * avatar still speaks — it just speaks from the fallback bank. A player walking
 * a park trips speech contexts constantly and every one of them would otherwise
 * be a paid round trip.
 */
const SPEECH_AI_COOLDOWN_MS = 15_000;
/** Same context twice inside this window returns the line already said. */
const SPEECH_REPEAT_MS = 6_000;

type SpeechMemo = { context: SpeechContext; line: string; at: number; aiAt: number };
const lastSpoken = new Map<string, SpeechMemo>();

/**
 * One spoken line for an avatar, in its own voice, for a game context.
 *
 * Ownership is checked because the line is about the player's own character, and
 * the avatar's name and personality come from the row rather than the client —
 * the client cannot ask for a different character's voice or spoof a personality.
 */
export async function speakAsAvatar(input: {
  avatarId: string;
  ownerId: string;
  context: SpeechContext;
  detail?: string | null;
}) {
  const avatar = await getAvatarOwned(input.avatarId, input.ownerId);
  const now = Date.now();
  const memo = lastSpoken.get(avatar.id);
  const loadoutLevel = await loadoutLevelFor(avatar.id);

  // Two events for the same context in quick succession (a spawn flickering in
  // and out of range, a burst of damage) should not restart the bubble with a
  // new line — replay the current one.
  if (memo && memo.context === input.context && now - memo.at < SPEECH_REPEAT_MS) {
    return {
      avatarId: avatar.id,
      personality: avatar.personality,
      context: input.context,
      line: memo.line,
      source: "repeat" as const,
      loadoutLevel,
    };
  }

  const aiAllowed = !memo || now - memo.aiAt >= SPEECH_AI_COOLDOWN_MS;
  const spoken = aiAllowed
    ? await generateAvatarSpeech({
        personality: avatar.personality,
        context: input.context,
        avatarName: avatar.name,
        detail: input.detail ?? null,
        loadoutLevel,
      })
    : {
        line: fallbackSpeechFor(avatar.personality, input.context, input.detail ?? null, loadoutLevel),
        source: "fallback" as const,
      };

  lastSpoken.set(avatar.id, {
    context: input.context,
    line: spoken.line,
    at: now,
    aiAt: spoken.source === "ai" ? now : (memo?.aiAt ?? 0),
  });
  if (lastSpoken.size > 5_000) {
    // Bounded: this is a convenience cache, not state anything depends on.
    for (const [key, value] of lastSpoken) {
      if (now - value.at > 10 * 60_000) lastSpoken.delete(key);
    }
  }

  return {
    avatarId: avatar.id,
    personality: avatar.personality,
    context: input.context,
    line: spoken.line,
    source: spoken.source,
    loadoutLevel,
  };
}

/**
 * Highest level among the boosters bolted to this character. Booster instances
 * level from battling and exploring, and that level drives both how charged the
 * character sounds and how hard its animations hit.
 */
export async function loadoutLevelFor(avatarId: string) {
  const [row] = await db
    .select({ level: sql<number>`coalesce(max(${schema.boosterInstance.level}), 1)` })
    .from(schema.boosterInstance)
    .where(
      and(
        eq(schema.boosterInstance.equippedAvatarId, avatarId),
        isNull(schema.boosterInstance.supersededAt),
      ),
    );
  return Math.min(5, Math.max(1, Number(row?.level ?? 1)));
}

/**
 * The body and the booster level a character fights with. The battle engine
 * needs both to choose which attack or defence a hit is animated as: the body
 * decides which moves are physically possible (no wing gust without wings), the
 * level decides whether a combo is allowed to come out.
 *
 * Characters generated before the `form` column existed fall back to a form
 * derived from their stable `modelId`, so they still get a consistent body and
 * a consistent move set rather than a random one per request.
 */
export async function combatFormFor(
  avatarId: string,
): Promise<{ form: CreatureForm; level: number } | null> {
  const [row] = await db
    .select({ form: schema.avatar.form, modelId: schema.avatar.modelId, rarity: schema.avatar.rarity })
    .from(schema.avatar)
    .where(eq(schema.avatar.id, avatarId))
    .limit(1);
  if (!row) return null;
  // The fallback is the *seed* for a derived body, not a body: `formFromJson`
  // builds one from the modelId itself when the row carries no stored form.
  const form = formFromJson(row.form, { modelId: row.modelId, rarity: row.rarity });
  return { form, level: await loadoutLevelFor(avatarId) };
}

/** Re-assign a voice. Used by the admin console and by tests. */
export async function setAvatarPersonality(input: {
  avatarId: string;
  ownerId: string;
  personality: Personality;
}) {
  await getAvatarOwned(input.avatarId, input.ownerId);
  if (!PERSONALITIES.includes(input.personality)) {
    throw new ORPCError("BAD_REQUEST", { message: "Unknown personality" });
  }
  const [updated] = await db
    .update(schema.avatar)
    .set({ personality: input.personality, updatedAt: new Date() })
    .where(eq(schema.avatar.id, input.avatarId))
    .returning();
  lastSpoken.delete(input.avatarId);
  return updated!;
}

/** Avatars that are not listed on the marketplace — valid for matchmaking. */
export async function selectableAvatars(ownerId: string) {
  return db
    .select()
    .from(schema.avatar)
    .where(and(eq(schema.avatar.ownerId, ownerId), isNull(schema.avatar.skinItemId)))
    .orderBy(desc(schema.avatar.createdAt));
}
