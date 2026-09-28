import { z } from "zod";
import { playerProc } from "../middleware/auth";
import {
  generateAvatar,
  generateAvatarFromDescription,
  getAvatarOwned,
  listAvatars,
  releaseAvatar,
  renameAvatar,
  setAvatarCategory,
  setAvatarPersonality,
  speakAsAvatar,
} from "../services/avatars";
import { PERSONALITIES } from "../database/schema";
import { CREATURE_CATEGORIES } from "../lib/creature-form";
import { speechContextSchema } from "../ai/speech";
import { MAX_AVATARS_PER_PLAYER } from "../services/players";
import { effectiveStats } from "../battle/stats";

/**
 * Avatars (battle characters). Every avatar is AI-generated — name, lore, special
 * ability and a `modelId` hint the future WebXR client maps to a 3D asset.
 * Stats returned here are both base and effective (base + equipped boosters),
 * which is exactly what the battle engine uses when a match starts.
 */
export const avatars = {
  list: playerProc.handler(({ context }) => listAvatars(context.player.id)),

  limits: playerProc.handler(() => ({ maxAvatars: MAX_AVATARS_PER_PLAYER })),

  get: playerProc
    .input(z.object({ avatarId: z.string() }))
    .handler(async ({ input, context }) => {
      await getAvatarOwned(input.avatarId, context.player.id);
      return effectiveStats(input.avatarId);
    }),

  /**
   * AI-generate a new avatar. The player supplies a theme at most — rarity is
   * always rolled server-side so it stays meaningful (admins can force one
   * through `admin.generateAvatar`).
   */
  generate: playerProc
    .input(z.object({ theme: z.string().max(120).optional() }).optional())
    .handler(({ input, context }) =>
      generateAvatar({
        ownerId: context.player.id,
        playerName: context.player.username,
        theme: input?.theme,
      }),
    ),

  /**
   * Build a procedural creature from a sentence the player typed — "dragon-like,
   * pink, wings, spikes". Traits are parsed into body parameters (shape, limbs,
   * wings, horns, spikes, tail, palette, glow, scale), the theme sets whatever
   * the sentence left unsaid, and the result is stored on the avatar row for
   * the renderer to build from primitives. No assets, no model call.
   *
   * `persist` is what separates looking from keeping: the default returns the
   * creature without writing a row (so "Generate" and "Regenerate" are free and
   * do not consume avatar slots), and `persist: true` saves the identical object.
   * `seed` re-rolls the parts the description did not pin down.
   */
  generateFromDescription: playerProc
    .input(
      z.object({
        description: z.string().min(3).max(240),
        seed: z.number().int().min(0).max(1_000_000).optional(),
        /**
         * The category picked in the lab. Optional on purpose: left out, the
         * description decides, which keeps every existing caller working and
         * keeps "a boxer" building a human-like body on its own.
         */
        category: z.enum(CREATURE_CATEGORIES).optional(),
        persist: z.boolean().optional(),
      }),
    )
    .handler(({ input, context }) =>
      generateAvatarFromDescription({
        ownerId: context.player.id,
        description: input.description,
        seed: input.seed,
        category: input.category,
        persist: input.persist,
      }),
    ),

  rename: playerProc
    .input(z.object({ avatarId: z.string(), name: z.string().min(2).max(32) }))
    .handler(({ input, context }) =>
      renameAvatar({ avatarId: input.avatarId, ownerId: context.player.id, name: input.name }),
    ),

  /**
   * One spoken line for the AR speech bubble, in the avatar's own voice.
   *
   * The client sends the context it just observed — a booster coming into
   * range, a match starting, unsafe ground — and the server decides what gets
   * said. `detail` is only a hint (booster name, opponent name, hazard kind);
   * name, personality and the throttle all come from the server side.
   */
  speak: playerProc
    .input(
      z.object({
        avatarId: z.string(),
        context: speechContextSchema,
        detail: z.string().max(120).optional(),
      }),
    )
    .handler(({ input, context }) =>
      speakAsAvatar({
        avatarId: input.avatarId,
        ownerId: context.player.id,
        context: input.context,
        detail: input.detail,
      }),
    ),

  setPersonality: playerProc
    .input(z.object({ avatarId: z.string(), personality: z.enum(PERSONALITIES) }))
    .handler(({ input, context }) =>
      setAvatarPersonality({
        avatarId: input.avatarId,
        ownerId: context.player.id,
        personality: input.personality,
      }),
    ),

  /**
   * Re-train a saved character into another category — the same picker the lab
   * shows at creation, applied to a character that already exists.
   *
   * Body, stats, special and moveset are all re-derived from the new category;
   * name, rarity, personality and boosters are kept. Blocked mid-match, since
   * it changes the stats and the moveset the engine is resolving against.
   */
  setCategory: playerProc
    .input(z.object({ avatarId: z.string(), category: z.enum(CREATURE_CATEGORIES) }))
    .handler(({ input, context }) =>
      setAvatarCategory({
        avatarId: input.avatarId,
        ownerId: context.player.id,
        category: input.category,
      }),
    ),

  /** Free a slot. Blocked while the avatar is in an active match. */
  release: playerProc
    .input(z.object({ avatarId: z.string() }))
    .handler(({ input, context }) => releaseAvatar(input.avatarId, context.player.id)),
};
