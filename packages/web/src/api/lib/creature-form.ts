/**
 * Creature forms: the parameter set a procedural character is built from.
 *
 * A form is the whole description of a creature's body — theme, silhouette,
 * how many limbs and wings, horns, spikes, tail, palette, glow and scale. It is
 * deliberately small, flat and JSON-serialisable, because it is three things at
 * once: what the trait parser produces from a player's sentence, what gets
 * stored on the avatar row, and what the renderer reads to lay out primitives.
 *
 * Nothing in here imports the database, three.js or any server-only module: the
 * API routes, the battle engine and the browser renderer all import this same
 * file, so a creature described on the server and a creature drawn on a phone
 * can never drift apart.
 *
 * There are no assets. A form is ~15 numbers and strings, so a character shows
 * up the frame after it is generated even on mobile data.
 */

/* ------------------------------------------------------------------- types */

/** Broad creature families. Each one carries a full set of form defaults. */
export const CREATURE_THEMES = [
  "dragon",
  "beast",
  "insect",
  "elemental",
  "bird",
  "construct",
] as const;
export type CreatureTheme = (typeof CREATURE_THEMES)[number];

/**
 * Creature categories: the body plan, and with it the fighting vocabulary.
 *
 * A category is deliberately *not* a theme. A theme is what a creature is made
 * of — scales, fur, chitin, stone, feathers, steel — and it owns the palette,
 * the name syllables and the trait defaults. A category is how that material is
 * arranged and therefore what it can do with itself: a body with two legs, two
 * arms and a spine throws punches and kicks, and a body with four legs and a
 * muzzle bites and pounces. The two are picked separately on purpose, so a
 * chrome martial artist and a furred quadruped are both reachable.
 *
 * Every category carries three things: a body preset (`CATEGORY_PRESET`), a
 * core move set (`CATEGORY_CORE`, plus what it is *not* allowed — a humanoid
 * with a jaw still does not open a fight by biting), and a stat identity
 * (`CATEGORY_WEIGHTS`). Those three together are the whole difference between
 * picking one category and another, which is why the picker is worth having.
 *
 * Nothing is locked in at generation: `applyCategory` re-plans an existing
 * body onto another category, so a saved character can be re-trained rather
 * than re-rolled.
 */
export const CREATURE_CATEGORIES = [
  "humanoid",
  "beastly",
  "draconic",
  "insectoid",
  "mechanical",
  "avian",
  "ethereal",
] as const;
export type CreatureCategory = (typeof CREATURE_CATEGORIES)[number];

/** How the trunk is massed. Drives the torso primitive and how limbs attach. */
export const BODY_SHAPES = [
  "serpentine",
  "bulky",
  "lithe",
  "orb",
  "insectoid",
  "upright",
] as const;
export type BodyShape = (typeof BODY_SHAPES)[number];

/** Overall proportions, applied on top of the body shape. */
export const SILHOUETTES = ["tall", "squat", "long", "round"] as const;
export type Silhouette = (typeof SILHOUETTES)[number];

export const TAILS = ["none", "long", "thick", "lash", "plume"] as const;
export type Tail = (typeof TAILS)[number];

/**
 * Mesh block sets.
 *
 * The renderer builds every creature from the same procedural skeleton, but a
 * block set tells it to fill some of that skeleton's slots — head, ears, face,
 * torso, paws, tail, accessory — with pre-authored low-poly mesh blocks instead
 * of the default primitives. `"none"` is the original primitive-only body, so
 * every creature minted before block sets existed keeps the exact shape it had.
 *
 * A block set is a visual choice only: it never changes stats, moves, damage,
 * placement or facing, and its blocks hang off the same animated groups the
 * primitives did, so the existing animation channels drive them unchanged.
 */
export const BLOCK_SETS = ["none", "cat", "dragon", "sprite"] as const;
export type BlockSet = (typeof BLOCK_SETS)[number];

export type CreaturePalette = {
  /** Body colour, `#rrggbb`. */
  base: string;
  /** Plating, horns, spikes and wing membrane. */
  accent: string;
  /** Emissive parts: core, eyes, glowing tail tips. */
  glowColor: string;
};

export type CreatureForm = {
  theme: CreatureTheme;
  /**
   * Body plan and fighting vocabulary. Independent of `theme`: the theme is the
   * material, this is the arrangement. Drives `movesForForm` and contributes
   * its own block to `statWeightsForForm`.
   */
  category: CreatureCategory;
  bodyShape: BodyShape;
  silhouette: Silhouette;
  /** Legs on the ground: 0 (floating), 2, 4 or 6. */
  limbCount: number;
  /** True if it has a pair of arms that can swipe. Drives `swipe` and `parry`. */
  arms: boolean;
  /**
   * Arm length as a multiplier on the body's own, 0.7–1.6. 1 is the default
   * reach every creature had before this field existed.
   *
   * Separate from `silhouette` because they are genuinely different statements:
   * a silhouette is what the *trunk* is shaped like, and "long arms" says
   * nothing about the trunk. Folding the two together is what made a
   * long-armed fighter come out as a stretched horizontal body instead of an
   * upright one that reaches further.
   */
  armSpan: number;
  /** Wings, in individual wings rather than pairs: 0, 2 or 4. */
  wings: number;
  /** Head horns, 0–4. */
  horns: number;
  /** Back/spine spikes, 0–10. */
  spikes: number;
  tail: Tail;
  /**
   * Which mesh block set fills the head/ear/face/torso/paw/tail/accessory
   * slots. `"none"` keeps the primitive-only body.
   */
  blockSet: BlockSet;
  palette: CreaturePalette;
  /** Emissive strength, 0–1. 0 is matte, 1 is lit from inside. */
  glow: number;
  /** Uniform size multiplier, 0.6–1.6. */
  scale: number;
};

/* -------------------------------------------------------- deterministic rng */

/** Stable 32-bit string hash. The same description always seeds the same rolls. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, fast, good enough for picking body parts. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, options: readonly T[]): T {
  return options[Math.floor(random() * options.length)]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------- hex + hsl */

function toHex(r: number, g: number, b: number): string {
  const part = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** h in [0,360), s and l in [0,1]. */
export function hslHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/* -------------------------------------------------------- keyword vocabulary */

/**
 * Theme words. The longest match wins, so "rock golem" reads as an elemental
 * rather than tripping on "rock" alone in a sentence like "rock-hard beast".
 */
const THEME_WORDS: Array<{ words: readonly string[]; theme: CreatureTheme }> = [
  {
    theme: "dragon",
    words: ["dragon", "draconic", "drake", "wyvern", "wyrm", "serpent", "snake", "lizard", "reptile", "hydra"],
  },
  {
    theme: "beast",
    words: ["beast", "fox", "wolf", "dog", "cat", "tiger", "lion", "bear", "boar", "ram", "stag", "deer", "horse", "rat", "mammal", "feline", "canine"],
  },
  {
    theme: "insect",
    words: ["insect", "bug", "beetle", "spider", "arachnid", "scorpion", "mantis", "ant", "wasp", "hornet", "crab", "crustacean", "centipede"],
  },
  {
    theme: "elemental",
    words: ["elemental", "golem", "rock", "stone", "crystal", "magma", "lava", "ice", "frost", "storm", "flame", "fire", "ember", "earth", "sand", "water", "spirit", "wisp"],
  },
  {
    theme: "bird",
    words: ["bird", "avian", "hawk", "eagle", "owl", "raven", "crow", "phoenix", "falcon", "gull", "heron", "roc"],
  },
  {
    theme: "construct",
    words: ["construct", "machine", "mech", "automaton", "droid", "turret", "engine", "clockwork", "metal", "steel", "chrome"],
  },
];

/** Colour words → hue/sat/light triples the palette is built from. */
const COLOR_WORDS: Record<string, { h: number; s: number; l: number }> = {
  pink: { h: 335, s: 0.8, l: 0.68 },
  magenta: { h: 320, s: 0.8, l: 0.55 },
  red: { h: 356, s: 0.72, l: 0.46 },
  crimson: { h: 348, s: 0.7, l: 0.38 },
  scarlet: { h: 6, s: 0.78, l: 0.46 },
  orange: { h: 28, s: 0.85, l: 0.52 },
  amber: { h: 38, s: 0.85, l: 0.52 },
  gold: { h: 45, s: 0.8, l: 0.52 },
  golden: { h: 45, s: 0.8, l: 0.52 },
  yellow: { h: 52, s: 0.85, l: 0.55 },
  lime: { h: 80, s: 0.8, l: 0.5 },
  green: { h: 136, s: 0.6, l: 0.4 },
  emerald: { h: 158, s: 0.68, l: 0.38 },
  jade: { h: 152, s: 0.45, l: 0.44 },
  teal: { h: 178, s: 0.6, l: 0.38 },
  cyan: { h: 188, s: 0.75, l: 0.5 },
  blue: { h: 214, s: 0.68, l: 0.46 },
  azure: { h: 205, s: 0.75, l: 0.52 },
  navy: { h: 222, s: 0.6, l: 0.26 },
  indigo: { h: 250, s: 0.55, l: 0.4 },
  purple: { h: 276, s: 0.55, l: 0.46 },
  violet: { h: 268, s: 0.65, l: 0.55 },
  lilac: { h: 280, s: 0.45, l: 0.68 },
  brown: { h: 26, s: 0.42, l: 0.3 },
  bronze: { h: 30, s: 0.5, l: 0.38 },
  copper: { h: 20, s: 0.6, l: 0.42 },
  tan: { h: 34, s: 0.4, l: 0.56 },
  sand: { h: 42, s: 0.35, l: 0.6 },
  bone: { h: 44, s: 0.22, l: 0.78 },
  white: { h: 210, s: 0.08, l: 0.86 },
  pale: { h: 210, s: 0.12, l: 0.74 },
  silver: { h: 210, s: 0.06, l: 0.7 },
  grey: { h: 220, s: 0.05, l: 0.5 },
  gray: { h: 220, s: 0.05, l: 0.5 },
  slate: { h: 215, s: 0.14, l: 0.38 },
  charcoal: { h: 220, s: 0.08, l: 0.22 },
  black: { h: 225, s: 0.1, l: 0.12 },
  obsidian: { h: 250, s: 0.16, l: 0.14 },
  rust: { h: 14, s: 0.55, l: 0.36 },
  ice: { h: 192, s: 0.45, l: 0.72 },
  frost: { h: 192, s: 0.45, l: 0.72 },
  molten: { h: 18, s: 0.9, l: 0.48 },
  lava: { h: 14, s: 0.9, l: 0.44 },
  neon: { h: 150, s: 0.95, l: 0.55 },
  rainbow: { h: 300, s: 0.75, l: 0.55 },
};

/** Themes that come with a palette when the description names no colour. */
const THEME_HUE: Record<CreatureTheme, { h: number; s: number; l: number }> = {
  dragon: { h: 272, s: 0.42, l: 0.34 },
  beast: { h: 26, s: 0.38, l: 0.36 },
  insect: { h: 96, s: 0.4, l: 0.28 },
  elemental: { h: 200, s: 0.3, l: 0.42 },
  bird: { h: 208, s: 0.34, l: 0.52 },
  construct: { h: 216, s: 0.12, l: 0.4 },
};

/** Form defaults per theme, before the description's own traits are layered on. */
const THEME_PRESET: Record<CreatureTheme, Omit<CreatureForm, "palette">> = {
  dragon: {
    theme: "dragon",
    category: "draconic",
    bodyShape: "serpentine",
    silhouette: "long",
    limbCount: 4,
    arms: false,
    armSpan: 1,
    wings: 2,
    horns: 2,
    spikes: 6,
    tail: "long",
    blockSet: "none",
    glow: 0.45,
    scale: 1.15,
  },
  beast: {
    theme: "beast",
    category: "beastly",
    bodyShape: "lithe",
    silhouette: "long",
    limbCount: 4,
    arms: false,
    armSpan: 1,
    wings: 0,
    horns: 0,
    spikes: 0,
    tail: "plume",
    blockSet: "none",
    glow: 0.2,
    scale: 0.95,
  },
  insect: {
    theme: "insect",
    category: "insectoid",
    bodyShape: "insectoid",
    silhouette: "squat",
    limbCount: 6,
    arms: true,
    armSpan: 1,
    wings: 0,
    horns: 1,
    spikes: 3,
    tail: "lash",
    blockSet: "none",
    glow: 0.3,
    scale: 0.85,
  },
  elemental: {
    theme: "elemental",
    category: "ethereal",
    bodyShape: "bulky",
    silhouette: "squat",
    limbCount: 2,
    arms: true,
    armSpan: 1,
    wings: 0,
    horns: 0,
    spikes: 5,
    tail: "none",
    blockSet: "none",
    glow: 0.6,
    scale: 1.2,
  },
  bird: {
    theme: "bird",
    category: "avian",
    bodyShape: "lithe",
    silhouette: "tall",
    limbCount: 2,
    arms: false,
    armSpan: 1,
    wings: 2,
    horns: 0,
    spikes: 0,
    tail: "plume",
    blockSet: "none",
    glow: 0.25,
    scale: 0.9,
  },
  construct: {
    theme: "construct",
    category: "mechanical",
    bodyShape: "upright",
    silhouette: "tall",
    limbCount: 2,
    arms: true,
    armSpan: 1,
    wings: 0,
    horns: 0,
    spikes: 0,
    tail: "none",
    blockSet: "none",
    glow: 0.4,
    scale: 1,
  },
};

/**
 * The category a theme is naturally built as.
 *
 * This is what keeps every character minted before categories existed exactly
 * as it was: a row with no `category` normalises to its theme's own plan, so a
 * stored dragon is still draconic and a stored construct is still mechanical.
 * It is also the starting point the Character Lab shows before the player
 * touches the picker.
 */
export const THEME_CATEGORY: Record<CreatureTheme, CreatureCategory> = {
  dragon: "draconic",
  beast: "beastly",
  insect: "insectoid",
  elemental: "ethereal",
  bird: "avian",
  construct: "mechanical",
};

/**
 * The theme a category implies when the sentence named no theme of its own.
 *
 * The inverse of `THEME_CATEGORY`, and it exists for the same reason
 * `BLOCK_SET_THEME` does. There is no "human" theme — the themes are what a
 * creature is *made of*, and the six of them are dragon, beast, insect,
 * elemental, bird and construct. So "human-like with long arms" named no
 * theme, the theme was rolled off the seed, and one roll in six handed a
 * person the construct palette: desaturated blue-grey plating at 0.4 glow.
 * Which is to say it came out a robot, because that is what the words for a
 * robot produce, and nothing in the sentence had ruled it out.
 *
 * Asking for a category is a statement about what the creature is, so it
 * stands in for the roll. A written theme word still beats it, which is what
 * keeps "steel samurai" mechanical-looking and human-shaped at the same time.
 */
const CATEGORY_THEME: Record<CreatureCategory, CreatureTheme> = {
  // Warm, organic, barely any glow — the least manufactured thing in the set,
  // which is as close to flesh as the six themes get.
  humanoid: "beast",
  beastly: "beast",
  draconic: "dragon",
  insectoid: "insect",
  mechanical: "construct",
  avian: "bird",
  ethereal: "elemental",
};

/**
 * The body a category needs in order to fight the way it fights.
 *
 * Only the traits the plan actually depends on are listed. A humanoid must
 * stand on two legs and have arms, or a punch has nothing to throw and a kick
 * nothing to throw it with; a spirit must have no legs, or it is a person made
 * of light rather than a floating one. Everything absent — horns, spikes,
 * glow, scale, palette, block set — is left exactly as the theme and the
 * player's own words set it, so picking a category re-plans the skeleton
 * without repainting the creature.
 */
const CATEGORY_PRESET: Record<CreatureCategory, Partial<Omit<CreatureForm, "palette" | "category">>> = {
  // Two legs, two arms, upright. Punches, kicks, grapples.
  humanoid: { bodyShape: "upright", silhouette: "tall", limbCount: 2, arms: true, wings: 0, tail: "none" },
  // Four legs, low and long. Bites, claws, pounces.
  beastly: { bodyShape: "lithe", silhouette: "long", limbCount: 4, arms: false },
  // Wings, tail, breath.
  draconic: { bodyShape: "serpentine", silhouette: "long", limbCount: 4, wings: 2, tail: "long" },
  // Six legs and pincers.
  insectoid: { bodyShape: "insectoid", silhouette: "squat", limbCount: 6, arms: true, wings: 0 },
  // Heavy, rigid, planted. Slams rather than swings.
  mechanical: { bodyShape: "bulky", silhouette: "tall", limbCount: 2, arms: true, wings: 0, tail: "none" },
  // Light frame on two legs, wings and a plume. Dives and talons.
  avian: { bodyShape: "lithe", silhouette: "tall", limbCount: 2, arms: false, wings: 2, tail: "plume" },
  // Nothing to stand on. Floats, and hits with what it is made of.
  ethereal: { bodyShape: "orb", silhouette: "round", limbCount: 0, arms: false, wings: 0, tail: "none" },
};

/** Category names and one line of what picking it actually changes, for the UI. */
export const CATEGORY_LABELS: Record<CreatureCategory, { label: string; blurb: string }> = {
  humanoid: { label: "Human-like", blurb: "Two legs, two arms, upright. Punches, kicks and grapples." },
  beastly: { label: "Animal-like", blurb: "Four legs, low and fast. Bites, claws and a pounce." },
  draconic: { label: "Dragon / mythic", blurb: "Wings, a long tail and breath. Hits hardest, turns slowest." },
  insectoid: { label: "Insectoid", blurb: "Six legs and pincers. Skitters out of range, guards well." },
  mechanical: { label: "Machine / construct", blurb: "Heavy and rigid. Piston slams, and very hard to move." },
  avian: { label: "Bird-like", blurb: "Light frame, wings and talons. Fastest thing in the game." },
  ethereal: { label: "Elemental / spirit", blurb: "Floating, no legs. Bursts and absorbs, but fragile." },
};

/**
 * Words that name a category outright. Read the same way themes are — longest
 * match wins — so "robot samurai" lands on humanoid off "samurai" while a bare
 * "robot" stays mechanical.
 */
const CATEGORY_WORDS: Array<{ category: CreatureCategory; words: readonly string[] }> = [
  {
    category: "humanoid",
    words: [
      "human", "humanoid", "human-like", "humanlike", "person", "man", "woman", "guy", "girl",
      "warrior", "fighter", "boxer", "brawler", "martial", "monk", "ninja", "samurai", "knight",
      "soldier", "swordsman", "gladiator", "kickboxer", "wrestler", "puncher", "humanoid-like",
    ],
  },
  {
    category: "beastly",
    words: [
      "animal", "animal-like", "animallike", "beastly", "quadruped", "four-legged", "feral",
      "wolf", "tiger", "lion", "panther", "bear", "hound", "fox", "cat-like",
    ],
  },
  { category: "draconic", words: ["draconic", "mythic", "mythical", "dragonkin", "wyvern-like"] },
  { category: "insectoid", words: ["insectoid", "buglike", "bug-like", "arthropod", "chitinous", "skittering"] },
  {
    category: "mechanical",
    words: ["mechanical", "machine", "machine-like", "mech", "robot", "robotic", "android", "automaton", "golem", "construct-like"],
  },
  { category: "avian", words: ["avian", "bird-like", "birdlike", "raptor", "falcon-like"] },
  {
    category: "ethereal",
    words: ["ethereal", "spirit", "spectral", "ghost", "ghostly", "wraith", "phantom", "wisp", "floating", "incorporeal", "elemental-spirit"],
  },
];

/** Trait words that override whatever the theme preset supplied. */
const WING_WORDS = ["wing", "winged", "wings", "feathered", "flying", "flight", "batlike", "bat-like"];
const NO_WING_WORDS = ["wingless", "flightless", "no wings"];
const SPIKE_WORDS = ["spike", "spiked", "spikes", "spiny", "spined", "thorn", "thorns", "barbed", "jagged", "quills"];
const HORN_WORDS = ["horn", "horned", "horns", "antler", "antlers", "tusks", "crest", "crown"];
const TAIL_WORDS = ["tail", "tailed", "stinger", "sting"];
const NO_TAIL_WORDS = ["tailless", "no tail"];
const GLOW_WORDS = ["glow", "glowing", "luminous", "radiant", "shining", "bright", "neon", "burning", "blazing", "lit", "bioluminescent", "ethereal", "spectral", "plasma"];
const DIM_WORDS = ["matte", "dull", "dim", "dimmed", "faded", "dark", "shadow", "shadowy", "stealth", "muted", "unlit"];
const BIG_WORDS = ["giant", "huge", "massive", "colossal", "towering", "hulking", "big", "great", "titanic", "enormous"];
const SMALL_WORDS = ["tiny", "small", "little", "cute", "baby", "miniature", "compact", "pocket", "dainty"];
const BULKY_WORDS = ["bulky", "heavy", "armoured", "armored", "stocky", "thick", "burly", "tank", "fat", "round", "boulder"];
const LITHE_WORDS = ["lithe", "sleek", "slender", "nimble", "agile", "swift", "quick", "thin", "lean", "fast"];
const CRYSTAL_WORDS = ["crystal", "crystals", "crystalline", "gem", "gems", "shard", "shards", "geode", "quartz"];
const ORB_WORDS = ["orb", "sphere", "ball", "blob", "cloud", "wisp", "floating", "levitating", "hovering"];
// The body plan tops out at six legs, so anything asking for more reads as
// "as many as this creature can have" rather than falling back to the default.
const MANY_LEG_WORDS = [
  "six-legged",
  "six legs",
  "eight-legged",
  "eight legs",
  "many legs",
  "many-legged",
  "multi-legged",
  "octopedal",
  "多",
];
const FOUR_LEG_WORDS = ["four-legged", "four legs", "quadruped", "on all fours"];
const TWO_LEG_WORDS = ["two-legged", "two legs", "bipedal", "biped", "upright", "standing"];
/**
 * Silhouette asked for by name. Separate from the theme preset so "squat
 * dragon" keeps the dragon and only overrides its proportions.
 */
const SILHOUETTE_WORDS: Array<{ words: readonly string[]; silhouette: Silhouette }> = [
  { silhouette: "tall", words: ["tall", "towering", "lanky", "upright silhouette"] },
  { silhouette: "squat", words: ["squat", "stumpy", "low-slung", "crouched"] },
  { silhouette: "long", words: ["long", "elongated", "stretched", "sinuous"] },
  { silhouette: "round", words: ["round", "rounded", "spherical", "globular", "chubby"] },
];

/**
 * Words that ask for a mesh block set. Checked in order, first match wins, so
 * "cat dragon" reads as a cat with a dragon's temperament rather than a dragon
 * with a cat's head. Everything else stays on the primitive body.
 */
const BLOCK_SET_WORDS: Array<{ words: readonly string[]; blockSet: Exclude<BlockSet, "none"> }> = [
  {
    blockSet: "cat",
    words: [
      "cat",
      "cat-like",
      "catlike",
      "feline",
      "kitten",
      "kitty",
      "meow",
      "meowth",
      "paw",
      "paws",
      "pawed",
      "whiskers",
      "tabby",
    ],
  },
  {
    blockSet: "dragon",
    words: ["dragon", "dragon-like", "draconic", "drake", "wyvern", "wyrm", "snout", "fang", "fangs", "fanged"],
  },
  {
    blockSet: "sprite",
    words: ["sprite", "fairy", "pixie", "imp", "wisp", "spirit", "mascot", "chibi"],
  },
];

/**
 * The theme a block set implies when the sentence named no theme of its own.
 * "meowth style creature" carries no theme word, so the theme used to be rolled
 * off the seed and a cat could come out draconic — cat ears and paws over a
 * dragon's palette and temperament. Asking for a block set is a statement about
 * what the creature *is*, so it stands in for the roll; a written theme word
 * still wins over it.
 */
const BLOCK_SET_THEME: Record<Exclude<BlockSet, "none">, CreatureTheme> = {
  cat: "beast",
  dragon: "dragon",
  sprite: "elemental",
};

/** The block set a sentence asks for by name, or null when it asks for none. */
function detectBlockSet(source: { text: string; words: string[] }): Exclude<BlockSet, "none"> | null {
  for (const entry of BLOCK_SET_WORDS) {
    if (mentionsAny(source, entry.words)) return entry.blockSet;
  }
  return null;
}

const ARM_WORDS = ["arms", "armed", "claws", "clawed", "hands", "fists", "pincers", "talons", "grasping"];

/**
 * Arm reach, asked for by name.
 *
 * These have to be read as arm words and not as body words. "long arms" used
 * to land on nothing at all — there was no arm-length trait to land on — while
 * the bare "long" inside it was picked up by `SILHOUETTE_WORDS` and stretched
 * the *trunk* instead, so asking for long arms got you a horizontal body with
 * the same stubby arms it started with. Both halves of that are fixed: the
 * phrases below set `armSpan`, and the silhouette pass no longer reads the
 * "long" out of a limb phrase.
 */
const LONG_ARM_WORDS = [
  "long arms", "long-armed", "long armed", "longarm", "long limbs", "long-limbed",
  "lanky arms", "gangly", "reaching arms", "ape-like", "apelike", "simian", "rangy",
  "wide reach", "long reach", "far-reaching",
];
const SHORT_ARM_WORDS = [
  "short arms", "short-armed", "short armed", "stubby arms", "stubby", "tiny arms",
  "little arms", "t-rex arms", "short limbs", "short-limbed", "short reach",
];

/**
 * Body parts that a size word in front of them is describing instead of the
 * body. Extends the "long tail" carve-out that already existed to every part
 * that can be long without the creature being long — which is all of them.
 */
const LIMB_PHRASE = /\b(long|short|huge|tiny)[\s-]*(tail|arm|limb|leg|neck|claw|horn|ear|fang|snout|mane|wing|whisker)\w*/g;

/** Words that read as "this thing is rare", nudging the roll upward. */
const GRAND_WORDS = ["ancient", "legendary", "mythic", "eternal", "divine", "cosmic", "celestial", "abyssal", "primordial", "king", "queen", "elder", "god", "godlike", "phoenix"];

/* --------------------------------------------------------------- parsing */

function tokenize(description: string): { text: string; words: string[] } {
  const text = description.toLowerCase();
  const words = text.split(/[^a-z0-9-]+/).filter(Boolean);
  return { text, words };
}

function mentionsAny(source: { text: string; words: string[] }, needles: readonly string[]): boolean {
  return needles.some((needle) =>
    needle.includes(" ") || needle.includes("-")
      ? source.text.includes(needle)
      : source.words.includes(needle),
  );
}

/** Count how many distinct words from a list appear — "spikes and thorns" is spikier. */
function countAny(source: { text: string; words: string[] }, needles: readonly string[]): number {
  let hits = 0;
  for (const needle of needles) {
    if (needle.includes(" ") || needle.includes("-")) {
      if (source.text.includes(needle)) hits += 1;
    } else if (source.words.includes(needle)) hits += 1;
  }
  return hits;
}

function detectTheme(source: { text: string; words: string[] }): CreatureTheme | null {
  let best: { theme: CreatureTheme; length: number } | null = null;
  for (const entry of THEME_WORDS) {
    for (const word of entry.words) {
      if (!source.words.includes(word) && !source.text.includes(word)) continue;
      if (!best || word.length > best.length) best = { theme: entry.theme, length: word.length };
    }
  }
  return best?.theme ?? null;
}

/** Same longest-match read as `detectTheme`, for the body plan. */
function detectCategory(source: { text: string; words: string[] }): CreatureCategory | null {
  let best: { category: CreatureCategory; length: number } | null = null;
  for (const entry of CATEGORY_WORDS) {
    for (const word of entry.words) {
      if (!source.words.includes(word) && !source.text.includes(word)) continue;
      if (!best || word.length > best.length) best = { category: entry.category, length: word.length };
    }
  }
  return best?.category ?? null;
}

/**
 * Re-plan a body onto another category.
 *
 * This is what "swap category" is: the category's own preset overwrites only
 * the traits its fighting style depends on, and everything that makes the
 * creature *that* creature — palette, theme, horns, spikes, glow, scale, block
 * set — is carried across untouched. Swapping a dragon to human-like keeps its
 * colours and its scale and gives it arms and two legs to punch with; swapping
 * back gives the wings and the tail back.
 *
 * Idempotent, and safe to call on a form from any older build, because it ends
 * in `normalizeForm` like every other way a form is produced.
 */
export function applyCategory(form: CreatureForm, category: CreatureCategory): CreatureForm {
  if (!CREATURE_CATEGORIES.includes(category)) return normalizeForm(form);
  return normalizeForm({ ...form, ...CATEGORY_PRESET[category], category });
}

/** Every colour word in the description, in the order they were written. */
function detectColors(source: { text: string; words: string[] }) {
  const found: Array<{ h: number; s: number; l: number }> = [];
  for (const word of source.words) {
    const hit = COLOR_WORDS[word];
    if (hit) found.push(hit);
  }
  return found;
}

/**
 * Build the three-colour palette. The first colour named owns the body; a
 * second becomes the accent; the glow colour is pushed to a bright, saturated
 * version of the accent so emissive parts actually read as lit.
 */
function buildPalette(
  colors: Array<{ h: number; s: number; l: number }>,
  theme: CreatureTheme,
  random: () => number,
): CreaturePalette {
  const themeHue = THEME_HUE[theme];
  const base = colors[0] ?? themeHue;
  const second =
    colors[1] ??
    (colors[0]
      ? { h: base.h + 28 + random() * 40, s: clamp(base.s + 0.2, 0, 1), l: clamp(base.l + 0.22, 0.2, 0.82) }
      : { h: themeHue.h + 150 + random() * 60, s: 0.7, l: 0.55 });
  const glowSource = colors[2] ?? second;
  return {
    base: hslHex(base.h, base.s, base.l),
    accent: hslHex(second.h, second.s, second.l),
    glowColor: hslHex(glowSource.h, clamp(glowSource.s + 0.25, 0.4, 1), clamp(glowSource.l + 0.18, 0.5, 0.78)),
  };
}

/**
 * Turn a player's sentence into a form.
 *
 * Words the player wrote always win; everything they left unsaid comes from the
 * theme preset, and anything the preset does not fix is rolled from `seed` —
 * which is what makes "Regenerate" produce a different creature from the same
 * sentence while a saved creature stays byte-identical forever.
 *
 * `category` is the picker's answer, and it is the one input that outranks the
 * theme preset: choosing "human-like" re-plans the skeleton whatever the
 * sentence said the creature was made of. Left out, the category is read from
 * the sentence, and failing that it is the theme's own natural plan — which is
 * the branch every creature minted before the picker existed takes, so their
 * bodies are bit-for-bit what they always were.
 */
export function parseCreatureDescription(
  description: string,
  seed = 0,
  category?: CreatureCategory | null,
): CreatureForm {
  const source = tokenize(description);
  // The roll stream is keyed to the seed alone, never to the sentence. Hashing
  // the text would mean adding one word ("spikes") silently re-rolled every
  // trait the player had not written yet — so the Character Lab's trait buttons
  // would hand back a different animal instead of the same one with spikes.
  // Words are intent, the seed is variation, and only "Regenerate" moves it.
  const random = rng(Math.round(seed) * 7919 + 104729);

  // The block set a sentence names also says what the creature is, so it fills
  // in a theme the words left unsaid. The roll is drawn either way: every trait
  // after this one reads from the same stream, and skipping a draw here would
  // shift all of them for cats and sprites alone.
  const blockSet = detectBlockSet(source);
  const rolledTheme = pick(random, CREATURE_THEMES);

  /* category — the body plan */

  // Picked wins over written, written wins over the theme's own plan. Read
  // before the theme, because a category the player asked for is also the best
  // guess at what the creature is made of when the sentence never said.
  const chosen =
    (category && CREATURE_CATEGORIES.includes(category) ? category : null) ?? detectCategory(source);

  // The roll is the last resort, not the second one: a written theme first,
  // then the block set, then the category, and only then the seed. The `pick`
  // above stays where it is whether or not its result is used — every trait
  // after it reads from the same stream, and skipping the draw would shift all
  // of them for any creature that names a category.
  const theme =
    detectTheme(source) ??
    (blockSet ? BLOCK_SET_THEME[blockSet] : null) ??
    (chosen ? CATEGORY_THEME[chosen] : null) ??
    rolledTheme;
  const preset = THEME_PRESET[theme];
  const form: CreatureForm = { ...preset, palette: buildPalette(detectColors(source), theme, random) };

  // The preset is only stamped on when the category was *asked for*, because
  // the theme presets already describe their natural category's body and
  // stamping it again would quietly re-shape every creature the old builds
  // produced.
  form.category = chosen ?? THEME_CATEGORY[theme];
  if (chosen) Object.assign(form, CATEGORY_PRESET[chosen]);

  /* body shape and silhouette */
  if (mentionsAny(source, ORB_WORDS)) {
    form.bodyShape = "orb";
    form.silhouette = "round";
    form.limbCount = 0;
  } else if (mentionsAny(source, BULKY_WORDS)) {
    form.bodyShape = "bulky";
    form.silhouette = mentionsAny(source, ["round", "boulder"]) ? "round" : "squat";
  } else if (mentionsAny(source, LITHE_WORDS)) {
    form.bodyShape = form.bodyShape === "serpentine" ? "serpentine" : "lithe";
    form.silhouette = theme === "bird" ? "tall" : "long";
  }
  if (mentionsAny(source, ["tall", "towering", "upright", "standing", "long-necked"])) {
    form.silhouette = "tall";
  }
  if (mentionsAny(source, ["coiled", "snakelike", "snake-like", "eel", "worm"])) {
    form.bodyShape = "serpentine";
    form.silhouette = "long";
  }
  // Standing on two legs is a body plan, not only a limb count. Without this a
  // "bipedal cat" keeps the beast preset's horizontal trunk and the leg builder
  // plants two legs under a body still massed for four, which reads as a
  // crouching quadruped. Orbs float and serpents coil, so both keep their shape.
  if (
    mentionsAny(source, TWO_LEG_WORDS) &&
    form.bodyShape !== "orb" &&
    form.bodyShape !== "serpentine" &&
    !mentionsAny(source, FOUR_LEG_WORDS) &&
    !mentionsAny(source, MANY_LEG_WORDS)
  ) {
    form.bodyShape = "upright";
    if (form.silhouette === "long") form.silhouette = "tall";
  }

  // An explicitly named silhouette wins over the one the shape implied. Read
  // from the sentence with the limb phrases removed, so "long tail" describes
  // the tail, "long arms" describes the arms, and only a bare "long" describes
  // the body.
  const shapeSource = tokenize(description.toLowerCase().replace(LIMB_PHRASE, " "));
  for (const entry of SILHOUETTE_WORDS) {
    if (mentionsAny(shapeSource, entry.words)) form.silhouette = entry.silhouette;
  }

  /* limbs */
  if (mentionsAny(source, MANY_LEG_WORDS) || (theme === "insect" && !mentionsAny(source, TWO_LEG_WORDS))) {
    form.limbCount = 6;
  }
  if (mentionsAny(source, FOUR_LEG_WORDS)) form.limbCount = 4;
  if (mentionsAny(source, TWO_LEG_WORDS)) form.limbCount = 2;
  if (mentionsAny(source, ["legless", "no legs"])) form.limbCount = 0;
  if (mentionsAny(source, ARM_WORDS)) form.arms = true;
  // Asking for arms of any length is asking for arms: a body with none cannot
  // have long ones, and the phrase would otherwise be silently dropped on
  // every four-legged or floating preset.
  if (mentionsAny(source, LONG_ARM_WORDS)) {
    form.arms = true;
    form.armSpan = 1.42;
  } else if (mentionsAny(source, SHORT_ARM_WORDS)) {
    form.arms = true;
    form.armSpan = 0.76;
  }

  /* wings */
  if (mentionsAny(source, NO_WING_WORDS)) form.wings = 0;
  else if (mentionsAny(source, WING_WORDS)) {
    form.wings = mentionsAny(source, ["four wings", "double wings", "two pairs"]) ? 4 : 2;
  }

  /* horns, spikes, tail */
  // Asking for horns or spikes always adds to what the preset already gave,
  // so the trait reads as applied even on a body that started out spiky.
  const hornHits = countAny(source, HORN_WORDS);
  if (hornHits > 0) form.horns = clamp(Math.max(1 + hornHits, form.horns + 1), 1, 4);
  const spikeHits = countAny(source, SPIKE_WORDS);
  if (spikeHits > 0) form.spikes = clamp(Math.max(4 + spikeHits * 2, form.spikes + 2), 3, 10);
  if (mentionsAny(source, CRYSTAL_WORDS)) form.spikes = clamp(Math.max(form.spikes, 5) + 1, 5, 10);
  if (mentionsAny(source, NO_TAIL_WORDS)) form.tail = "none";
  else if (mentionsAny(source, TAIL_WORDS)) {
    form.tail = mentionsAny(source, ["long tail", "longtail", "trailing tail"])
      ? "long"
      : mentionsAny(source, ["stinger", "sting", "whip", "lash"])
      ? "lash"
      : mentionsAny(source, ["thick", "heavy", "club", "clubbed"])
        ? "thick"
        : mentionsAny(source, ["fluffy", "bushy", "feathered", "plume"])
          ? "plume"
          : form.tail === "none"
            ? "long"
            : form.tail;
  }

  /* glow */
  const glowHits = countAny(source, GLOW_WORDS);
  if (glowHits > 0) form.glow = clamp(0.6 + glowHits * 0.15, 0.6, 1);
  if (mentionsAny(source, DIM_WORDS)) form.glow = clamp(form.glow - 0.35, 0.05, 1);
  if (mentionsAny(source, CRYSTAL_WORDS)) form.glow = clamp(form.glow + 0.2, 0, 1);

  /* scale */
  if (mentionsAny(source, BIG_WORDS)) form.scale = clamp(form.scale + 0.3, 0.6, 1.6);
  if (mentionsAny(source, SMALL_WORDS)) form.scale = clamp(form.scale - 0.32, 0.6, 1.6);

  /* mesh blocks */
  // The sentence has to ask for a block set by name. Nothing infers one from a
  // theme alone, so a description that worked before block sets existed still
  // builds the same primitive body it always did.
  if (blockSet) form.blockSet = blockSet;

  // Whatever the sentence left open gets a small deterministic nudge, so two
  // creatures from the same three words are still visibly different animals.
  form.scale = round2(clamp(form.scale + (random() - 0.5) * 0.12, 0.6, 1.6));
  form.glow = round2(clamp(form.glow + (random() - 0.5) * 0.1, 0, 1));
  if (form.spikes > 0) form.spikes = clamp(form.spikes + (random() < 0.5 ? -1 : 1), 1, 10);

  return normalizeForm(form);
}

/**
 * Coerce anything form-shaped into a valid form. Used on the way out of the
 * database (a row written by an older build may be missing fields) and on the
 * way in from a client, so the renderer never sees a wings count of 37.
 */
export function normalizeForm(input: Partial<CreatureForm> | null | undefined): CreatureForm {
  const theme = CREATURE_THEMES.includes(input?.theme as CreatureTheme)
    ? (input!.theme as CreatureTheme)
    : "beast";
  const preset = THEME_PRESET[theme];
  const wings = Math.round(input?.wings ?? preset.wings);
  const limbs = Math.round(input?.limbCount ?? preset.limbCount);
  const hex = (value: unknown, fallback: string) =>
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
  const fallbackPalette = buildPalette([], theme, rng(hashString(theme)));
  return {
    theme,
    // A row written before categories existed has no field here. It falls back
    // to its theme's natural plan, which is the body it has always had.
    category: CREATURE_CATEGORIES.includes(input?.category as CreatureCategory)
      ? (input!.category as CreatureCategory)
      : THEME_CATEGORY[theme],
    bodyShape: BODY_SHAPES.includes(input?.bodyShape as BodyShape)
      ? (input!.bodyShape as BodyShape)
      : preset.bodyShape,
    silhouette: SILHOUETTES.includes(input?.silhouette as Silhouette)
      ? (input!.silhouette as Silhouette)
      : preset.silhouette,
    limbCount: [0, 2, 4, 6].includes(limbs) ? limbs : 2,
    arms: typeof input?.arms === "boolean" ? input.arms : preset.arms,
    // A row written before arm length existed has no field here, and 1 is the
    // reach it was minted with.
    armSpan: round2(clamp(input?.armSpan ?? preset.armSpan, 0.7, 1.6)),
    wings: [0, 2, 4].includes(wings) ? wings : 0,
    horns: clamp(Math.round(input?.horns ?? preset.horns), 0, 4),
    spikes: clamp(Math.round(input?.spikes ?? preset.spikes), 0, 10),
    tail: TAILS.includes(input?.tail as Tail) ? (input!.tail as Tail) : preset.tail,
    // A row written before block sets existed has no field here, and must keep
    // the primitive body it was minted with rather than growing mesh blocks.
    blockSet: BLOCK_SETS.includes(input?.blockSet as BlockSet)
      ? (input!.blockSet as BlockSet)
      : preset.blockSet,
    palette: {
      base: hex(input?.palette?.base, fallbackPalette.base),
      accent: hex(input?.palette?.accent, fallbackPalette.accent),
      glowColor: hex(input?.palette?.glowColor, fallbackPalette.glowColor),
    },
    glow: round2(clamp(input?.glow ?? preset.glow, 0, 1)),
    scale: round2(clamp(input?.scale ?? preset.scale, 0.6, 1.6)),
  };
}

/**
 * A form for an avatar that has none — everything minted before descriptions
 * existed. Derived from the stable `modelId` hash, so those characters keep one
 * consistent body across sessions instead of being re-rolled on every load.
 */
export function formFromModelId(modelId: string, rarity?: string): CreatureForm {
  const seed = hashString(modelId || "character");
  const random = rng(seed);
  const theme = CREATURE_THEMES[seed % CREATURE_THEMES.length]!;
  const preset = THEME_PRESET[theme];
  const grand = rarity === "legendary" || rarity === "epic";
  return normalizeForm({
    ...preset,
    horns: preset.horns + (grand ? 1 : 0),
    spikes: preset.spikes + (grand ? 2 : 0),
    glow: preset.glow + (grand ? 0.2 : 0),
    palette: buildPalette([], theme, random),
  });
}

/** Read a form off a stored JSON string, falling back to the modelId body. */
export function formFromJson(
  json: string | null | undefined,
  fallback: { modelId: string; rarity?: string },
): CreatureForm {
  if (json) {
    try {
      return normalizeForm(JSON.parse(json) as Partial<CreatureForm>);
    } catch {
      // Malformed JSON on the row is not a reason to fail to draw a character.
    }
  }
  return formFromModelId(fallback.modelId, fallback.rarity);
}

/**
 * Read a stored form, or nothing. Used by the client, which must be able to
 * tell "this character has no saved body" (so the scene derives one from the
 * modelId) apart from "this character's body is this".
 */
export function parseStoredForm(json: string | null | undefined): CreatureForm | null {
  if (!json) return null;
  try {
    return normalizeForm(JSON.parse(json) as Partial<CreatureForm>);
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- naming + stats */

const NAME_PREFIX: Record<CreatureTheme, readonly string[]> = {
  dragon: ["Vex", "Mor", "Drak", "Saphi", "Ignis", "Zar"],
  beast: ["Rhu", "Fen", "Bram", "Kes", "Lox", "Orin"],
  insect: ["Chit", "Vesp", "Mand", "Skit", "Thrax", "Nid"],
  elemental: ["Gran", "Obsi", "Quar", "Tect", "Pyra", "Cryo"],
  bird: ["Aeri", "Stri", "Falc", "Cirr", "Plum", "Zeph"],
  construct: ["Cog", "Volt", "Iron", "Rive", "Axl", "Dyn"],
};

const NAME_SUFFIX: Record<CreatureTheme, readonly string[]> = {
  dragon: ["thyr", "moth", "scale", "wyrm", "fang"],
  beast: ["mane", "paw", "hide", "howl", "tooth"],
  insect: ["idae", "carax", "swarm", "husk", "sting"],
  elemental: ["lith", "core", "vein", "shard", "mantle"],
  bird: ["wing", "quill", "gale", "talon", "crest"],
  construct: ["frame", "works", "unit", "drive", "gear"],
};

/** A name from the form itself, so the preview and the saved row always match. */
export function nameForForm(form: CreatureForm, seed = 0): string {
  const random = rng(hashString(JSON.stringify(form)) + Math.round(seed) * 104729);
  const prefix = pick(random, NAME_PREFIX[form.theme]);
  const suffix = pick(random, NAME_SUFFIX[form.theme]);
  return `${prefix}${suffix}`;
}

/** `modelId` describing how the body is built, for logs and stable re-rolls. */
export function modelIdForForm(form: CreatureForm): string {
  const parts = [
    `proc_${form.theme}`,
    form.category,
    form.bodyShape,
    `l${form.limbCount}`,
    form.wings > 0 ? `w${form.wings}` : "w0",
    form.spikes > 0 ? `s${form.spikes}` : "s0",
    hashString(JSON.stringify(form)).toString(36).slice(0, 6),
  ];
  return parts.join("_");
}

/**
 * How the body reads as stats, before rarity scaling. Shape decides the spread
 * so a description has consequences in the fight and not only on screen: mass
 * defends, wings and lithe bodies are fast, spikes and horns hit harder.
 */
/**
 * What a category is worth in the fight, before the body's own shape is read.
 *
 * This is the other half of the picker: the moves say what a category *does*,
 * and this says what it is *for*. They are sized to matter without swamping
 * the rest — the biggest single term here (a machine's +0.34 defense) is about
 * what a bulky trunk already gives, so shape, parts and category each stay
 * worth roughly the same amount and a booster still moves the number more than
 * any of them. Nothing here reaches the [0.6, 1.6] bound on its own, so every
 * category keeps its full spread instead of clipping flat at the top.
 *
 * Read down a column and the roster has a shape to it: humanoid is the
 * all-rounder with no hole in it, avian and insectoid buy speed with health,
 * mechanical is the wall, draconic is the hammer, ethereal hits and guards
 * well but cannot take a hit.
 */
const CATEGORY_WEIGHTS: Record<
  CreatureCategory,
  { attack: number; defense: number; speed: number; health: number }
> = {
  humanoid: { attack: 0.18, defense: 0.14, speed: 0.1, health: 0 },
  beastly: { attack: 0.22, defense: -0.08, speed: 0.2, health: 0 },
  draconic: { attack: 0.3, defense: 0.1, speed: -0.08, health: 0.12 },
  insectoid: { attack: -0.06, defense: 0.22, speed: 0.26, health: -0.14 },
  mechanical: { attack: 0.14, defense: 0.34, speed: -0.26, health: 0.22 },
  avian: { attack: 0.1, defense: -0.14, speed: 0.34, health: -0.12 },
  ethereal: { attack: 0.2, defense: 0.18, speed: 0.14, health: -0.26 },
};

export function statWeightsForForm(form: CreatureForm) {
  const identity = CATEGORY_WEIGHTS[form.category] ?? CATEGORY_WEIGHTS.beastly;
  let attack = 1 + identity.attack;
  let defense = 1 + identity.defense;
  let speed = 1 + identity.speed;
  let health = 1 + identity.health;

  if (form.bodyShape === "bulky") {
    defense += 0.3;
    health += 0.25;
    speed -= 0.2;
  } else if (form.bodyShape === "lithe") {
    speed += 0.3;
    attack += 0.1;
    health -= 0.12;
  } else if (form.bodyShape === "serpentine") {
    attack += 0.2;
    speed += 0.12;
    defense -= 0.1;
  } else if (form.bodyShape === "orb") {
    defense += 0.15;
    speed += 0.15;
    health -= 0.1;
  } else if (form.bodyShape === "insectoid") {
    speed += 0.2;
    defense += 0.1;
    health -= 0.1;
  }

  attack += form.spikes * 0.03 + form.horns * 0.05;
  defense += form.spikes * 0.02;
  speed += form.wings * 0.07 - (form.scale - 1) * 0.2;
  health += (form.scale - 1) * 0.5;
  if (form.tail === "lash") speed += 0.08;
  if (form.tail === "thick") attack += 0.08;
  attack += form.glow * 0.1;

  const bound = (value: number) => round2(clamp(value, 0.6, 1.6));
  return { attack: bound(attack), defense: bound(defense), speed: bound(speed), health: bound(health) };
}

/** Description words that argue for a better roll ("ancient", "mythic", …). */
export function grandnessOf(description: string): number {
  return countAny(tokenize(description), GRAND_WORDS);
}

/* ------------------------------------------------------------- move sets */

/**
 * Attacks. Which ones a creature actually has is a property of its body — a
 * wingless creature cannot gust, a tailless one cannot whip — so the server
 * picks from `movesForForm` and the client is guaranteed to have something
 * sensible to play for whatever it is sent.
 */
export const ATTACK_MOVES = [
  "swipe",
  "bite",
  "tail_whip",
  "wing_gust",
  "spike_burst",
  "charge",
  "dash_strike",
  "ground_slam",
  "elemental_burst",
  // Category cores. Each one belongs to a body plan rather than to a part
  // count: a punch needs a shoulder over a hip, a pounce needs four legs to
  // gather under it, breath needs a throat built for it. They are appended
  // rather than woven in so every id above keeps the exact meaning, timing and
  // profile it already had.
  "punch",
  "kick",
  "grapple",
  "pounce",
  "fire_breath",
  "pincer_snap",
  "dive_bomb",
  "piston_slam",
] as const;
export type AttackMove = (typeof ATTACK_MOVES)[number];

export const DEFENSE_MOVES = [
  "shell_guard",
  "wing_shield",
  "dodge",
  "parry",
  "absorb",
  "counter_stance",
] as const;
export type DefenseMove = (typeof DEFENSE_MOVES)[number];

/** Two moves fused into one longer animation, unlocked by booster level. */
export const COMBO_MOVES = [
  "swipe_bite",
  "charge_slam",
  "gust_spike",
  "dash_bite",
  "dash_whip",
  "dash_slam",
  "dodge_counter",
  "absorb_burst",
  // Category chains, on the same terms as the singles above: appended, so no
  // existing combo's timing or composition moves.
  "punch_kick",
  "dash_punch",
  "pounce_bite",
] as const;
export type ComboMove = (typeof COMBO_MOVES)[number];

/**
 * Combos that open with a dash — the body covers ground before it swings, so
 * the client translates it across the floor rather than only animating it in
 * place. Named here, next to the move list, because the animation layer, the
 * stage and the sound table all have to agree on which moves move.
 */
export const DASH_MOVES = ["dash_strike", "dash_bite", "dash_whip", "dash_slam"] as const;

/**
 * Combos that open a hit. `dodge_counter` and `absorb_burst` start by reading
 * an incoming attack, so they only ever come out of the defending roll.
 */
export const DEFENSIVE_COMBOS = ["dodge_counter", "absorb_burst"] as const;

/**
 * What a dash strike needs: legs to cover the ground with, and something on
 * the front of the body to arrive with. A creature that can swipe but cannot
 * walk lunges nowhere, and one that can run but has nothing to swing with
 * arrives as a charge — which it already has.
 */
const canDash = (form: CreatureForm) =>
  form.limbCount >= 2 && (form.arms || form.limbCount >= 4);

/** Booster level a combo needs, and the body it needs to perform it. */
const COMBO_REQUIREMENTS: Record<
  ComboMove,
  { level: number; needs: (form: CreatureForm) => boolean }
> = {
  swipe_bite: { level: 2, needs: (form) => form.arms || form.limbCount >= 4 },
  charge_slam: { level: 3, needs: (form) => form.limbCount >= 2 },
  gust_spike: { level: 3, needs: (form) => form.wings > 0 && form.spikes >= 3 },
  // Each dash combo needs the dash itself plus whatever it lands with, so a
  // body never unlocks a combination it is missing half of.
  dash_bite: { level: 2, needs: canDash },
  dash_whip: { level: 3, needs: (form) => canDash(form) && form.tail !== "none" },
  dash_slam: {
    level: 4,
    needs: (form) =>
      canDash(form) &&
      (form.bodyShape === "bulky" || form.limbCount >= 4 || form.scale >= 1.2),
  },
  dodge_counter: { level: 4, needs: (form) => form.limbCount >= 2 || form.wings > 0 },
  absorb_burst: { level: 5, needs: (form) => form.glow >= 0.3 },
  // A one-two is the first thing a fighter learns, so it unlocks early; the
  // grapple chain and the running punch are later, and both still need the
  // body underneath them to exist.
  punch_kick: { level: 2, needs: (form) => form.category === "humanoid" && form.arms && form.limbCount >= 2 },
  dash_punch: { level: 3, needs: (form) => form.category === "humanoid" && canDash(form) },
  pounce_bite: { level: 2, needs: (form) => form.category === "beastly" && form.limbCount >= 4 },
};

/**
 * The strikes every body gets, whatever it is.
 *
 * Two of them, and both are the whole body rather than a part of it: a charge
 * is mass arriving, and a lurch is mass arriving badly. Nothing here names an
 * arm, a jaw, a wing or a tail, which is exactly why they are safe to hand to
 * a floating orb and to a six-legged beetle on the same terms. They are also
 * the floor the picker needs: swap to any category and there is always
 * something to throw while the rest of the set is being re-planned.
 */
const UNIVERSAL_ATTACKS = ["charge"] as const;

/**
 * The core set a category fights with. This is what "the picker swaps the
 * moveset" means literally: pick human-like and the openers become a punch and
 * a kick, pick animal-like and they become a bite and a pounce.
 */
const CATEGORY_CORE: Record<CreatureCategory, readonly AttackMove[]> = {
  humanoid: ["punch", "kick"],
  beastly: ["bite", "pounce"],
  draconic: ["bite", "fire_breath"],
  insectoid: ["pincer_snap", "bite"],
  mechanical: ["piston_slam"],
  avian: ["dive_bomb", "bite"],
  ethereal: ["elemental_burst"],
};

/**
 * Moves a category will not perform even when the body could.
 *
 * The point of the whole feature: a human-like creature has a jaw and hands,
 * and the part-counting layer below would happily give it `bite` — but a
 * person who fights does not open with their teeth, and seeing one do it is
 * what made the categories necessary. A machine has no teeth to open with at
 * all. Everything else keeps the full part-derived set.
 */
const CATEGORY_DENY: Record<CreatureCategory, readonly AttackMove[]> = {
  humanoid: ["bite"],
  beastly: [],
  draconic: [],
  insectoid: [],
  mechanical: ["bite"],
  avian: [],
  ethereal: ["bite"],
};

/**
 * Extra moves a category adds once the body can carry them. Separate from the
 * core because these are conditional: a humanoid needs arms to grapple with,
 * and a dragon with no wings does not get to dive.
 */
const CATEGORY_EXTRA: Record<CreatureCategory, ReadonlyArray<{ move: AttackMove; needs: (form: CreatureForm) => boolean }>> = {
  humanoid: [{ move: "grapple", needs: (form) => form.arms && form.limbCount >= 2 }],
  beastly: [],
  draconic: [],
  insectoid: [],
  // A machine that is big enough plants a foot and drops the floor out.
  mechanical: [{ move: "ground_slam", needs: (form) => form.limbCount >= 2 }],
  avian: [{ move: "dive_bomb", needs: (form) => form.wings > 0 }],
  ethereal: [],
};

export function movesForForm(form: CreatureForm, level = 1) {
  const category = CATEGORY_CORE[form.category] ? form.category : "beastly";
  const denied = new Set<AttackMove>(CATEGORY_DENY[category]);
  const attacks: AttackMove[] = [];
  const add = (move: AttackMove) => {
    if (denied.has(move) || attacks.includes(move)) return;
    attacks.push(move);
  };

  // Three layers, in this order: what everyone gets, what the category is,
  // then what the parts on this particular body allow. The third layer is
  // untouched from before categories existed — it is still the reason a
  // wingless creature cannot gust and a tailless one cannot whip — it is only
  // filtered now, so the category can refuse a move its body could physically
  // make.
  for (const move of UNIVERSAL_ATTACKS) add(move);
  for (const move of CATEGORY_CORE[category]) add(move);
  for (const extra of CATEGORY_EXTRA[category]) if (extra.needs(form)) add(extra.move);

  if (form.arms || form.limbCount >= 4) add("swipe");
  if (form.tail !== "none") add("tail_whip");
  if (form.wings > 0) add("wing_gust");
  if (form.spikes >= 3) add("spike_burst");
  // Closing the gap and arriving with a claw. Legs and a front end, so a
  // floating or a limbless body charges instead.
  if (canDash(form)) add("dash_strike");
  // Slamming the ground needs legs to slam it with: a floating creature has
  // nothing to plant, so it bursts or charges instead however big it is.
  if (form.limbCount >= 2 && (form.bodyShape === "bulky" || form.limbCount >= 4 || form.scale >= 1.2))
    add("ground_slam");
  if (form.theme === "elemental" || form.glow >= 0.55) add("elemental_burst");

  const defenses: DefenseMove[] = ["shell_guard", "dodge", "counter_stance"];
  if (form.wings > 0) defenses.push("wing_shield");
  if (form.arms) defenses.push("parry");
  if (form.glow >= 0.35) defenses.push("absorb");

  const combos = COMBO_MOVES.filter((move) => {
    const rule = COMBO_REQUIREMENTS[move];
    return level >= rule.level && rule.needs(form);
  });

  return { attacks, defenses, combos };
}

/**
 * Choose the attack this hit is animated as. Server-side and seeded by the
 * caller (match id, sequence, whatever is to hand) so every client watching the
 * same event plays the same move, and so a fight does not look like one
 * animation on repeat.
 *
 * `preferCombo` is what a levelled booster buys: at higher levels the roll is
 * allowed to land on a combo, which is longer and hits harder visually.
 */
export function pickAttackMove(input: {
  form: CreatureForm;
  level?: number;
  seed: string;
  /** Ability effect from the battle engine, when this came from an ability. */
  effect?: string | null;
}): AttackMove | ComboMove {
  const level = clamp(Math.round(input.level ?? 1), 1, 5);
  const { attacks, combos } = movesForForm(input.form, level);
  const random = rng(hashString(input.seed));

  // An area ability is a slam or a burst, never a bite: the animation has to
  // agree with what the engine says just happened.
  if (input.effect === "aoe" || input.effect === "area") {
    if (attacks.includes("ground_slam")) return "ground_slam";
    if (attacks.includes("elemental_burst")) return "elemental_burst";
    // A dragon has no slam and no burst, and before breath existed it fell
    // through to a random attack — so an area ability read as a bite.
    if (attacks.includes("fire_breath")) return "fire_breath";
  }
  if (input.effect === "burn" || input.effect === "freeze" || input.effect === "poison") {
    // Burning is breath first if the body has it: a draconic creature setting
    // something alight should be seen doing it with its mouth, not with an
    // aura. Freeze and poison stay on the burst, which is colour-agnostic.
    if (input.effect === "burn" && attacks.includes("fire_breath")) return "fire_breath";
    if (attacks.includes("elemental_burst")) return "elemental_burst";
    if (attacks.includes("fire_breath")) return "fire_breath";
  }

  // Combos get likelier as the boosters level: a 20% shot at level 2, 50% at 5.
  const comboPool = combos.filter(
    (move) => !(DEFENSIVE_COMBOS as readonly string[]).includes(move),
  );
  if (comboPool.length > 0 && random() < 0.1 * level) return pick(random, comboPool);
  return pick(random, attacks);
}

/** The same roll for the receiving side of a hit. */
export function pickDefenseMove(input: {
  form: CreatureForm;
  level?: number;
  seed: string;
  /** True when the hit landed — a creature that took damage did not dodge it. */
  hit?: boolean;
}): DefenseMove | ComboMove {
  const level = clamp(Math.round(input.level ?? 1), 1, 5);
  const { defenses, combos } = movesForForm(input.form, level);
  const random = rng(hashString(input.seed));

  const landed = input.hit ?? true;
  const pool = landed
    ? defenses.filter((move) => move !== "dodge")
    : defenses;
  const comboPool = combos.filter((move) =>
    (DEFENSIVE_COMBOS as readonly string[]).includes(move),
  );
  if (comboPool.length > 0 && random() < 0.08 * level) return pick(random, comboPool);
  return pick(random, pool.length > 0 ? pool : defenses);
}

/** Human-readable move names, for feed text and the lab UI. */
export const MOVE_LABELS: Record<AttackMove | DefenseMove | ComboMove, string> = {
  swipe: "Swipe",
  bite: "Bite",
  tail_whip: "Tail whip",
  wing_gust: "Wing gust",
  spike_burst: "Spike burst",
  charge: "Charge",
  dash_strike: "Dash strike",
  ground_slam: "Ground slam",
  elemental_burst: "Elemental burst",
  shell_guard: "Shell guard",
  wing_shield: "Wing shield",
  dodge: "Dodge",
  parry: "Parry",
  absorb: "Absorb",
  counter_stance: "Counter stance",
  swipe_bite: "Swipe → bite",
  charge_slam: "Charge → slam",
  gust_spike: "Gust → spike",
  dash_bite: "Dash → bite",
  dash_whip: "Dash → tail whip",
  dash_slam: "Dash → slam",
  dodge_counter: "Dodge → counter",
  absorb_burst: "Absorb → burst",
  punch: "Punch",
  kick: "Kick",
  grapple: "Grapple throw",
  pounce: "Pounce",
  fire_breath: "Breath",
  pincer_snap: "Pincer snap",
  dive_bomb: "Dive",
  piston_slam: "Piston slam",
  punch_kick: "Punch → kick",
  dash_punch: "Dash → punch",
  pounce_bite: "Pounce → bite",
};
