import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * AR Battle backend schema (Drizzle + Turso/libSQL).
 *
 * Domain tables mirror the game design spec:
 *   Player, Avatar, Booster (definition) + BoosterInstance (owned copy),
 *   Item (skins/abilities), Zone, SpawnPoint, Match, MatchPlayer, BattleState,
 *   BattleEvent, MarketplaceListing, Transaction, CronRun, LeaderboardEntry.
 *
 * Better Auth owns `user`/`session`/`account`/`verification` (see auth-schema.ts).
 * Every gameplay row hangs off `player.id`, never the auth user id directly.
 */
export * from "./auth-schema";
// Community + safety tables (friends, teams, chat, meet-ups, reports, blocks).
export * from "./community-schema";

const now = () => new Date();
const timestamp = (col: string) => integer(col, { mode: "timestamp_ms" });

/* ------------------------------------------------------------------ Player */

/**
 * Age bands. `16to17` exists as its own band rather than folding into "16+"
 * because the community rules key off minor/adult, not off consent capability:
 * a 17-year-old consents for themselves but is still never matched, teamed or
 * chatted with an adult.
 */
export const AGE_BANDS = ["under13", "13to15", "16to17", "18plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Community segregation key. Minors and adults never share a surface. */
export const AGE_TIERS = ["minor", "adult"] as const;
export type AgeTier = (typeof AGE_TIERS)[number];

/** `hidden` is reversible and automatic; `suspended` is a human decision. */
export const MODERATION_STATES = ["active", "hidden", "suspended"] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

export const player = sqliteTable(
  "player",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    role: text("role", { enum: ["player", "admin"] })
      .notNull()
      .default("player"),
    /**
     * Self-declared at sign-up. This is age *screening*, not proof of age —
     * the app says so in the UI and treats it as the floor for what a player
     * is allowed to reach, never as a verified fact.
     */
    ageBand: text("age_band", { enum: AGE_BANDS }),
    ageTier: text("age_tier", { enum: AGE_TIERS }),
    /** Under-13 only: the address the consent link was sent to. */
    parentEmail: text("parent_email"),
    /** Set when a parent clicked the emailed link. Null = community locked. */
    parentConsentAt: timestamp("parent_consent_at"),
    /**
     * Coarse home area (2 dp, ≈1.1 km) captured once at sign-up. The precise
     * fix never leaves the session; this is what park matching reads.
     */
    homeLat: real("home_lat"),
    homeLng: real("home_lng"),
    homeSetAt: timestamp("home_set_at"),
    moderationState: text("moderation_state", { enum: MODERATION_STATES })
      .notNull()
      .default("active"),
    /** Permanent 8-char code. The only way another player can find this one. */
    inviteCode: text("invite_code"),
    currency: integer("currency").notNull().default(500),
    xp: integer("xp").notNull().default(0),
    level: integer("level").notNull().default(1),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    matchesPlayed: integer("matches_played").notNull().default(0),
    lastLat: real("last_lat"),
    lastLng: real("last_lng"),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("player_user_id_idx").on(t.userId),
    uniqueIndex("player_username_idx").on(t.username),
    uniqueIndex("player_invite_code_idx").on(t.inviteCode),
    index("player_moderation_idx").on(t.moderationState),
  ],
);

/* ------------------------------------------------------------------ Avatar */

/** Rarity tiers used across avatars, boosters and items. */
export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * How an avatar talks. Assigned at generation from its own stat spread (see
 * `personalityFor` in services/avatars.ts), so the voice matches the thing the
 * player is actually fighting with rather than being a cosmetic label.
 */
export const PERSONALITIES = ["brash", "stoic", "manic", "cold", "loyal", "feral"] as const;
export type Personality = (typeof PERSONALITIES)[number];

export const avatar = sqliteTable(
  "avatar",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    /** Reference the future WebXR client resolves to a 3D model / glb. */
    modelId: text("model_id").notNull(),
    /** Base stats — effective stats = base + equipped boosters (see battle/stats.ts). */
    attack: integer("attack").notNull(),
    defense: integer("defense").notNull(),
    speed: integer("speed").notNull(),
    health: integer("health").notNull(),
    rarity: text("rarity", { enum: RARITIES }).notNull(),
    /** Voice the avatar speaks in. Defaulted so avatars minted before it existed still talk. */
    personality: text("personality", { enum: PERSONALITIES }).notNull().default("stoic"),
    /**
     * Procedural body parameters, JSON — see `lib/creature-form.ts`. Nullable
     * because avatars minted before descriptions existed derive a form from
     * `modelId` instead; the client treats both paths identically.
     */
    form: text("form"),
    /** The player's own words, when the creature came from a description. */
    formDescription: text("form_description"),
    specialAbility: text("special_ability").notNull(),
    abilityDescription: text("ability_description"),
    /** JSON: { damage, cooldownSeconds, effect, radiusM } */
    abilityConfig: text("ability_config"),
    lore: text("lore"),
    skinItemId: text("skin_item_id"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("avatar_owner_idx").on(t.ownerId)],
);

/* ----------------------------------------------------------------- Booster */

/** Booster definition — AI generated, shared by every instance of it. */
export const booster = sqliteTable(
  "booster",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    rarity: text("rarity", { enum: RARITIES }).notNull(),
    /** JSON: { attack?, defense?, speed?, health? } flat additive modifiers. */
    statModifiers: text("stat_modifiers").notNull(),
    description: text("description").notNull(),
    /** Ability unlocked by holding this booster, if any. */
    unlocksAbility: text("unlocks_ability"),
    abilityDescription: text("ability_description"),
    /** Upgrade tier. Upgrading mints a new instance at tier+1. */
    tier: integer("tier").notNull().default(1),
    /** Shop price in in-game currency. 0 = not purchasable directly. */
    price: integer("price").notNull().default(0),
    /** Where this definition can appear: shop | nature | battle | any */
    origin: text("origin", { enum: ["shop", "nature", "battle", "any"] })
      .notNull()
      .default("any"),
    aiGenerated: integer("ai_generated", { mode: "boolean" }).notNull().default(true),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("booster_rarity_idx").on(t.rarity)],
);

/** An owned copy of a booster. Permanent until upgraded; then tradable. */
export const boosterInstance = sqliteTable(
  "booster_instance",
  {
    id: text("id").primaryKey(),
    boosterId: text("booster_id").notNull(),
    ownerId: text("owner_id").notNull(),
    equippedAvatarId: text("equipped_avatar_id"),
    acquiredVia: text("acquired_via", {
      enum: ["purchase", "pack", "nature", "battle", "marketplace", "starter", "upgrade", "spoils"],
    }).notNull(),
    /**
     * Per-instance progression, 1..BOOSTER_MAX_LEVEL. Earned by battling and
     * exploring — independent of `booster.tier`, which is bought with currency.
     * Level scales ability power, animation intensity and personality lines.
     */
    level: integer("level").notNull().default(1),
    /** XP banked toward the next level. */
    xp: integer("xp").notNull().default(0),
    /** Set when this instance was produced by upgrading another one. */
    upgradedFromId: text("upgraded_from_id"),
    /** Superseded by an upgrade — kept as a tradable item. */
    supersededAt: timestamp("superseded_at"),
    tradable: integer("tradable", { mode: "boolean" }).notNull().default(true),
    listedListingId: text("listed_listing_id"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("booster_instance_owner_idx").on(t.ownerId),
    index("booster_instance_avatar_idx").on(t.equippedAvatarId),
  ],
);

/* -------------------------------------------------- Items (skins/abilities) */

export const item = sqliteTable(
  "item",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    type: text("type", { enum: ["skin", "ability"] }).notNull(),
    name: text("name").notNull(),
    rarity: text("rarity", { enum: RARITIES }).notNull(),
    description: text("description").notNull(),
    /** JSON payload: skin → { materialId, palette }, ability → ability config. */
    payload: text("payload").notNull(),
    appliedAvatarId: text("applied_avatar_id"),
    listedListingId: text("listed_listing_id"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("item_owner_idx").on(t.ownerId)],
);

/* --------------------------------------------------- Zones & nature spawns */

/** Where a play area or hazard came from. OSM proposals need human approval. */
export const ZONE_SOURCES = ["manual", "osm", "player"] as const;
/** A zone only spawns boosters and hosts battles once an operator approves it. */
export const ZONE_REVIEW = ["pending", "approved", "rejected"] as const;

export const zone = sqliteTable("zone", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  centerLat: real("center_lat").notNull(),
  centerLng: real("center_lng").notNull(),
  radiusM: integer("radius_m").notNull().default(500),
  /** Higher weight = more spawns allocated on the daily refresh. */
  spawnWeight: integer("spawn_weight").notNull().default(1),
  terrain: text("terrain"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  /** OSM-proposed zones land as `pending` and are dark until reviewed. */
  review: text("review", { enum: ZONE_REVIEW }).notNull().default("approved"),
  source: text("source", { enum: ZONE_SOURCES }).notNull().default("manual"),
  /** Upstream OSM element, e.g. `way/27482304` — unique guard against re-import. */
  osmRef: text("osm_ref"),
  /** Operator note recorded at approval/rejection time. */
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().$defaultFn(now),
});

/** Hazards that veto play regardless of which safe zone they fall inside. */
export const DANGER_KINDS = ["road", "rail", "water", "private", "cliff", "other"] as const;

export const dangerZone = sqliteTable(
  "danger_zone",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: DANGER_KINDS }).notNull(),
    centerLat: real("center_lat").notNull(),
    centerLng: real("center_lng").notNull(),
    /** Hazards are modelled as buffered circles — a road is a chain of them. */
    radiusM: integer("radius_m").notNull().default(15),
    source: text("source", { enum: ZONE_SOURCES }).notNull().default("osm"),
    osmRef: text("osm_ref"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("danger_lat_idx").on(t.centerLat), index("danger_lng_idx").on(t.centerLng)],
);

/**
 * Append-only log of every safety verdict that blocked something. This is the
 * evidence trail for a game aimed at 8-16 year olds — it answers "was the
 * player warned before they walked into the road" after the fact.
 */
export const safetyEvent = sqliteTable(
  "safety_event",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id").notNull(),
    /** assess | block_collect | block_attack | pause_battle | resume_battle */
    kind: text("kind").notNull(),
    verdict: text("verdict").notNull(),
    lat: real("lat"),
    lng: real("lng"),
    speedMps: real("speed_mps"),
    detail: text("detail"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("safety_player_idx").on(t.playerId), index("safety_at_idx").on(t.createdAt)],
);

/** What happened to a player's fighting-ground suggestion. */
export const SUGGESTION_STATUS = ["auto_approved", "pending", "rejected", "duplicate"] as const;

/**
 * A player proposing a playground or park near them as a fighting ground.
 * The player's own position is never stored — only the public place they
 * picked, which is re-read from OpenStreetMap rather than trusted from the
 * client. `zoneId` is the zone it produced (approved or pending review).
 */
export const zoneSuggestion = sqliteTable(
  "zone_suggestion",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id").notNull(),
    zoneId: text("zone_id"),
    osmRef: text("osm_ref").notNull(),
    name: text("name").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    radiusM: integer("radius_m").notNull(),
    note: text("note"),
    status: text("status", { enum: SUGGESTION_STATUS }).notNull(),
    /** JSON: the automated checks and what each found. */
    checks: text("checks"),
    /** One-line verdict shown to the player and the operator. */
    summary: text("summary"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("zone_suggestion_player_idx").on(t.playerId, t.createdAt),
    index("zone_suggestion_ref_idx").on(t.osmRef),
  ],
);

export const spawnPoint = sqliteTable(
  "spawn_point",
  {
    id: text("id").primaryKey(),
    zoneId: text("zone_id").notNull(),
    boosterId: text("booster_id").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    rarity: text("rarity", { enum: RARITIES }).notNull(),
    /** AI generated flavour text shown when the player is near. */
    description: text("description").notNull(),
    /** Metres the player must be within to collect. */
    collectRadiusM: integer("collect_radius_m").notNull().default(25),
    collectedByPlayerId: text("collected_by_player_id"),
    collectedAt: timestamp("collected_at"),
    /**
     * A personal drop: only this player sees it or can collect it. Null for
     * the shared daily scatter that anyone in the zone can race for.
     */
    reservedForPlayerId: text("reserved_for_player_id"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("spawn_zone_idx").on(t.zoneId),
    index("spawn_expires_idx").on(t.expiresAt),
    index("spawn_reserved_idx").on(t.reservedForPlayerId),
  ],
);

/* ------------------------------------------------------ Matches & battles */

export const match = sqliteTable(
  "match",
  {
    id: text("id").primaryKey(),
    zoneId: text("zone_id").notNull(),
    hostPlayerId: text("host_player_id").notNull(),
    status: text("status", { enum: ["waiting", "active", "finished", "cancelled"] })
      .notNull()
      .default("waiting"),
    maxPlayers: integer("max_players").notNull().default(4),
    /** Winner is resolved by the battle engine on finish. */
    winnerPlayerId: text("winner_player_id"),
    startTime: timestamp("start_time"),
    endTime: timestamp("end_time"),
    summary: text("summary"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("match_status_idx").on(t.status), index("match_zone_idx").on(t.zoneId)],
);

export const matchPlayer = sqliteTable(
  "match_player",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull(),
    playerId: text("player_id").notNull(),
    avatarId: text("avatar_id").notNull(),
    joinedAt: timestamp("joined_at").notNull().$defaultFn(now),
    leftAt: timestamp("left_at"),
    placement: integer("placement"),
    xpEarned: integer("xp_earned").notNull().default(0),
    currencyEarned: integer("currency_earned").notNull().default(0),
  },
  (t) => [
    index("match_player_match_idx").on(t.matchId),
    uniqueIndex("match_player_unique_idx").on(t.matchId, t.playerId),
  ],
);

/** Authoritative per-avatar combat state. The server owns every number here. */
export const battleState = sqliteTable(
  "battle_state",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull(),
    playerId: text("player_id").notNull(),
    avatarId: text("avatar_id").notNull(),
    maxHealth: integer("max_health").notNull(),
    currentHealth: integer("current_health").notNull(),
    attack: integer("attack").notNull(),
    defense: integer("defense").notNull(),
    speed: integer("speed").notNull(),
    /** Ability ids unlocked for this match (avatar + booster grants). */
    abilities: text("abilities").notNull().default("[]"),
    lat: real("lat"),
    lng: real("lng"),
    heading: real("heading"),
    altitude: real("altitude"),
    alive: integer("alive", { mode: "boolean" }).notNull().default(true),
    kills: integer("kills").notNull().default(0),
    damageDealt: integer("damage_dealt").notNull().default(0),
    damageTaken: integer("damage_taken").notNull().default(0),
    lastAttackAt: timestamp("last_attack_at"),
    abilityReadyAt: timestamp("ability_ready_at"),
    diedAt: timestamp("died_at"),
    /**
     * Stamina, stored as a reading plus the moment it was taken. Regen is
     * never ticked by a timer — the pool is recomputed forward from
     * `staminaAt` whenever anyone asks, so a match that nobody is looking at
     * costs nothing to keep current and a client cannot bank regen by going
     * quiet. See `lib/move-combat.ts`.
     */
    stamina: real("stamina").notNull().default(100),
    staminaAt: timestamp("stamina_at"),
    /**
     * When this avatar is free to act again. Replaces the one flat attack
     * cooldown: a move's own length plus its recovery, so a ground slam
     * genuinely costs more of the fight than a bite does.
     */
    recoverUntil: timestamp("recover_until"),
    /**
     * The defender's committed read. `guardAt` is stamped by the server on
     * arrival and the client never sends a time of its own, which is the whole
     * of the anti-cheat here: you cannot claim to have parried earlier than
     * your packet got in.
     */
    guardMove: text("guard_move"),
    guardAt: timestamp("guard_at"),
    /** Punished for guessing wrong on a parry — cannot act until this passes. */
    staggeredUntil: timestamp("staggered_until"),
    /**
     * The room, as last measured by this player's own device: metres to the
     * opponent across the AR floor, and metres of space behind their own back.
     * Presentation-side measurements of a space the server cannot see, used
     * softly — see `gapForCheck` and `corneredMultiplier`.
     */
    arGapM: real("ar_gap_m"),
    spaceBehindM: real("space_behind_m"),
    /**
     * Stationary-battle rule: walking suspends your own combat. Set from the
     * server's own speed calculation in updatePosition, never from the client.
     */
    moving: integer("moving", { mode: "boolean" }).notNull().default(false),
    lastSpeedMps: real("last_speed_mps"),
    movingSince: timestamp("moving_since"),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("battle_state_match_idx").on(t.matchId),
    uniqueIndex("battle_state_unique_idx").on(t.matchId, t.playerId),
  ],
);

/** Append-only battle log — also the payload source for realtime events. */
export const battleEvent = sqliteTable(
  "battle_event",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    actorPlayerId: text("actor_player_id"),
    targetPlayerId: text("target_player_id"),
    /** JSON payload delivered verbatim to realtime subscribers. */
    payload: text("payload").notNull().default("{}"),
    /** AI generated commentary line, when present. */
    message: text("message"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("battle_event_match_idx").on(t.matchId, t.seq)],
);

/* ---------------------------------------------- Marketplace & transactions */

export const MARKET_ITEM_TYPES = ["booster", "avatar", "skin", "ability"] as const;

export const marketplaceListing = sqliteTable(
  "marketplace_listing",
  {
    id: text("id").primaryKey(),
    sellerId: text("seller_id").notNull(),
    itemType: text("item_type", { enum: MARKET_ITEM_TYPES }).notNull(),
    /** boosterInstance.id | avatar.id | item.id depending on itemType. */
    itemId: text("item_id").notNull(),
    itemName: text("item_name").notNull(),
    itemRarity: text("item_rarity", { enum: RARITIES }).notNull(),
    /** Snapshot of the item at listing time, for browsing without joins. */
    itemSnapshot: text("item_snapshot").notNull().default("{}"),
    price: integer("price").notNull(),
    status: text("status", { enum: ["active", "sold", "cancelled"] })
      .notNull()
      .default("active"),
    buyerId: text("buyer_id"),
    soldAt: timestamp("sold_at"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("listing_status_idx").on(t.status),
    index("listing_seller_idx").on(t.sellerId),
    uniqueIndex("listing_item_active_idx").on(t.itemType, t.itemId, t.status),
  ],
);

export const transaction = sqliteTable(
  "transaction",
  {
    id: text("id").primaryKey(),
    type: text("type", {
      enum: [
        "market_sale",
        "shop_purchase",
        "battle_reward",
        "nature_pickup",
        "upgrade",
        "admin_grant",
        "battle_forfeit",
      ],
    }).notNull(),
    listingId: text("listing_id"),
    fromPlayerId: text("from_player_id"),
    toPlayerId: text("to_player_id"),
    /** Gross amount moved in in-game currency. */
    amount: integer("amount").notNull().default(0),
    /** Marketplace fee taken by the house (10%). */
    fee: integer("fee").notNull().default(0),
    netAmount: integer("net_amount").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("transaction_from_idx").on(t.fromPlayerId),
    index("transaction_to_idx").on(t.toPlayerId),
  ],
);

/**
 * What a fight cost. The loser gives up one booster that was equipped on the
 * avatar that fought — it is destroyed — and the winner is minted a fresh copy.
 * When the loser had nothing equipped the winner gets a random booster instead
 * (`kind: "bounty"`). Also the anti-farming ledger: one row per pair per day.
 */
export const boosterForfeit = sqliteTable(
  "booster_forfeit",
  {
    id: text("id").primaryKey(),
    matchId: text("match_id").notNull(),
    winnerPlayerId: text("winner_player_id").notNull(),
    loserPlayerId: text("loser_player_id").notNull(),
    kind: text("kind", { enum: ["spoils", "bounty"] }).notNull(),
    /** The definition that changed hands (spoils) or was rolled (bounty). */
    boosterId: text("booster_id").notNull(),
    /** The loser's destroyed instance — null for a bounty. */
    lostInstanceId: text("lost_instance_id"),
    lostLevel: integer("lost_level"),
    grantedInstanceId: text("granted_instance_id").notNull(),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("forfeit_pair_idx").on(t.winnerPlayerId, t.loserPlayerId),
    index("forfeit_match_idx").on(t.matchId),
  ],
);

/* ----------------------------------------------------- Cron & leaderboard */

export const cronRun = sqliteTable(
  "cron_run",
  {
    id: text("id").primaryKey(),
    job: text("job").notNull(),
    status: text("status", { enum: ["running", "ok", "error"] }).notNull(),
    startedAt: timestamp("started_at").notNull().$defaultFn(now),
    finishedAt: timestamp("finished_at"),
    detail: text("detail"),
    trigger: text("trigger", { enum: ["schedule", "manual"] })
      .notNull()
      .default("schedule"),
  },
  (t) => [index("cron_run_job_idx").on(t.job, t.startedAt)],
);

export const leaderboardEntry = sqliteTable(
  "leaderboard_entry",
  {
    id: text("id").primaryKey(),
    /** ISO date of the Monday the snapshot covers. */
    weekStart: text("week_start").notNull(),
    playerId: text("player_id").notNull(),
    username: text("username").notNull(),
    rank: integer("rank").notNull(),
    wins: integer("wins").notNull(),
    xp: integer("xp").notNull(),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("leaderboard_unique_idx").on(t.weekStart, t.playerId)],
);
