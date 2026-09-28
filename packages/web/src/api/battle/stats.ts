import { and, eq, isNull } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { levelScale, xpToNextLevel } from "../services/boosters";

export interface StatBlock {
  attack: number;
  defense: number;
  speed: number;
  health: number;
}

export interface EffectiveAvatar {
  avatar: typeof schema.avatar.$inferSelect;
  base: StatBlock;
  bonus: StatBlock;
  effective: StatBlock;
  abilities: AbilityDef[];
  boosters: {
    instanceId: string;
    boosterId: string;
    name: string;
    rarity: string;
    tier: number;
    /** Per-instance level earned from battles and exploration, 1..5. */
    level: number;
    xp: number;
    xpToNext: number | null;
    statModifiers: Partial<StatBlock>;
    unlocksAbility: string | null;
  }[];
}

export interface AbilityDef {
  id: string;
  name: string;
  source: "avatar" | "booster";
  damage: number;
  cooldownSeconds: number;
  effect: string;
  radiusM: number;
  description?: string | null;
}

const EMPTY: StatBlock = { attack: 0, defense: 0, speed: 0, health: 0 };

/** Avatar stats plus every equipped booster's modifiers, and unlocked abilities. */
export async function effectiveStats(avatarId: string): Promise<EffectiveAvatar> {
  const [avatar] = await db.select().from(schema.avatar).where(eq(schema.avatar.id, avatarId));
  if (!avatar) throw new Error(`Avatar ${avatarId} not found`);

  const equipped = await db
    .select({ instance: schema.boosterInstance, booster: schema.booster })
    .from(schema.boosterInstance)
    .innerJoin(schema.booster, eq(schema.booster.id, schema.boosterInstance.boosterId))
    .where(
      and(
        eq(schema.boosterInstance.equippedAvatarId, avatarId),
        isNull(schema.boosterInstance.supersededAt),
      ),
    );

  const base: StatBlock = {
    attack: avatar.attack,
    defense: avatar.defense,
    speed: avatar.speed,
    health: avatar.health,
  };

  const bonus = { ...EMPTY };
  const boosters: EffectiveAvatar["boosters"] = [];
  const abilities: AbilityDef[] = [avatarAbility(avatar)];

  for (const row of equipped) {
    const mods = parseMods(row.booster.statModifiers);
    // Tier multiplies a booster's modifiers: tier 2 = 1.5x, tier 3 = 2x, ...
    const tierScale = 1 + (row.booster.tier - 1) * 0.5;
    // Instance level stacks on top of tier: bought power x earned power.
    const scale = tierScale * levelScale(row.instance.level);
    for (const key of Object.keys(bonus) as (keyof StatBlock)[]) {
      bonus[key] += Math.round((mods[key] ?? 0) * scale);
    }
    boosters.push({
      instanceId: row.instance.id,
      boosterId: row.booster.id,
      name: row.booster.name,
      rarity: row.booster.rarity,
      tier: row.booster.tier,
      level: row.instance.level,
      xp: row.instance.xp,
      xpToNext: xpToNextLevel(row.instance.level),
      statModifiers: mods,
      unlocksAbility: row.booster.unlocksAbility,
    });
    if (row.booster.unlocksAbility) {
      abilities.push({
        id: `booster:${row.instance.id}`,
        name: row.booster.unlocksAbility,
        source: "booster",
        damage: Math.round(12 * scale + rarityBoost(row.booster.rarity)),
        cooldownSeconds: 14,
        effect: "burst",
        radiusM: 8,
        description: row.booster.abilityDescription,
      });
    }
  }

  const effective: StatBlock = {
    attack: base.attack + bonus.attack,
    defense: base.defense + bonus.defense,
    speed: base.speed + bonus.speed,
    health: base.health + bonus.health,
  };

  return { avatar, base, bonus, effective, abilities, boosters };
}

export function avatarAbility(avatar: typeof schema.avatar.$inferSelect): AbilityDef {
  const config = parseAbilityConfig(avatar.abilityConfig);
  return {
    id: "avatar",
    name: avatar.specialAbility,
    source: "avatar",
    damage: config.damage ?? 20,
    cooldownSeconds: config.cooldownSeconds ?? 15,
    effect: config.effect ?? "burst",
    radiusM: config.radiusM ?? 10,
    description: avatar.abilityDescription,
  };
}

export function parseMods(json: string): Partial<StatBlock> {
  try {
    const parsed = JSON.parse(json) as Partial<StatBlock>;
    return {
      attack: num(parsed.attack),
      defense: num(parsed.defense),
      speed: num(parsed.speed),
      health: num(parsed.health),
    };
  } catch {
    return {};
  }
}

function parseAbilityConfig(json: string | null) {
  if (!json) return {} as Record<string, number & string>;
  try {
    return JSON.parse(json) as { damage?: number; cooldownSeconds?: number; effect?: string; radiusM?: number };
  } catch {
    return {};
  }
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function rarityBoost(rarity: string) {
  return { common: 0, uncommon: 3, rare: 7, epic: 12, legendary: 20 }[rarity] ?? 0;
}
