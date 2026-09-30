import * as React from "react";
import { Link } from "wouter";
import {
  Compass,
  Crosshair,
  Eye,
  Glasses,
  Camera as CameraIcon,
  MapPin,
  Radio,
  RotateCcw,
  Satellite,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AvatarDock, type DockAvatar } from "@/components/play/avatar-dock";
import { BattleHud, type HudAbility, type HudMovement } from "@/components/play/battle-hud";
import {
  BoosterPanel,
  type InventoryBooster,
  type PackOffer,
  type PackReveal,
} from "@/components/play/booster-panel";
import { MatchResult, type ResultPlayer } from "@/components/play/match-result";
import { BattlePad, type IncomingBlow } from "@/components/play/battle-pad";
import { RevealHandle } from "@/components/play/reveal-handle";
import { TrainingMode, type TrainingHit } from "@/components/play/training-mode";
import { MoveStick } from "@/components/play/move-stick";
import { CollectSheet, type SpawnTarget } from "@/components/play/collect-sheet";
import { EnvNotice } from "@/components/play/env-notice";
import { ConsentGate } from "@/components/play/consent-gate";
import {
  SafetyBlock,
  SafetyStrip,
  type SafetyVerdict,
} from "@/components/play/safety-overlay";
import { SignInCard } from "@/components/play/sign-in-card";
import {
  COMBO_MOVES,
  DEFENSE_MOVES,
  DEFENSIVE_COMBOS,
  formFromModelId,
  movesForForm,
  parseStoredForm,
} from "../../api/lib/creature-form";
import { computeDamage } from "../../api/lib/damage";
import {
  ATTACK_PROFILE,
  DEFENCE_PROFILE,
  FALLBACK_ATTACK,
  GUARD_WINDOW,
  staminaCheck,
  staminaNow,
} from "../../api/lib/move-combat";
import { trainingStats } from "../../api/lib/training-stats";
import { isAnimationState, strikeFrames, type AnimationState } from "@/ar/character";
import { cueForMove, playCue } from "@/ar/sfx";
import {
  SPAR_GUARD_CHANCE,
  newSparringSeed,
  pickBotMove,
  pickRandom,
  rollSparringPartner,
  sparTaunt,
} from "@/ar/sparring";
import { compassPoint } from "@/ar/heading";
import type { Marker } from "@/ar/markers";
import { HypeBanner } from "@/components/play/hype-banner";
import { useArStage } from "@/hooks/use-ar-stage";
import { useAvatarVoice } from "@/hooks/use-avatar-voice";
import { useHype } from "@/hooks/use-hype";
import { exchangeLine } from "@/lib/hype";
import { INPUT_BUFFER_MS, useCommitClock } from "@/hooks/use-commit-clock";
import { useGeo } from "@/hooks/use-geo";
import { useMatchChannel } from "@/hooks/use-match-channel";
import { useLandscape } from "@/hooks/use-orientation";
import { coarseLabel, distanceM, enuOffset, metres } from "@/lib/geo";
import { errorMessage } from "@/lib/format";
import { moveForFootwork, throwableMoves } from "@/lib/footwork";
import { useMe, useSession, useSignOut } from "@/queries/session";
import {
  useAttack,
  useGuard,
  useAvatarLimits,
  useAvatarLoadout,
  useBattleConfig,
  useBoosterInventory,
  useBoosterLimits,
  useBoosterPacks,
  useBuyPack,
  useCollectSpawn,
  useEligibleAvatars,
  useEquipBooster,
  useGenerateAvatar,
  useHazards,
  useLeaveMatch,
  useMatch,
  useMyBattleState,
  useMyMatches,
  useNearbySpawns,
  useNearestZone,
  useQuickMatch,
  useReleaseAvatar,
  useSafetyCheck,
  useSafetyConfig,
  useStartMatch,
  useUnequipBooster,
  useUpdatePosition,
  useUseAbility,
} from "@/queries/play";

/**
 * The AR client.
 *
 * One screen, because that is what the game is: a camera view with characters
 * standing in it and the least chrome that still answers "what do I press".
 * Everything authoritative — range, cooldowns, damage, whether it is safe to
 * play here at all — is read from the server every few seconds and rendered as
 * given. The client's own jobs are narrow: draw the scene, report the pose,
 * and refuse to offer an action the server would reject.
 *
 * Layering, from the back: camera video, WebGL canvas, HTML overlay. In an
 * immersive WebXR session the same overlay is handed to the session as a DOM
 * overlay, so the controls survive the transition into the headset.
 */

const POSE_INTERVAL_MS = 2_000;
/**
 * Whether the engine turned a pose away for good rather than tripping over the
 * network. Being knocked out or posting into a match that has closed are both
 * final for the rest of the fight, so the ticker stops instead of stacking up
 * one refusal every two seconds; a transport hiccup carries no status and the
 * next tick retries it as before.
 */
function isPoseRefusal(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return status >= 400 && status < 500;
  const code = (error as { code?: unknown } | null)?.code;
  return code === "BAD_REQUEST" || code === "NOT_FOUND" || code === "FORBIDDEN";
}
/** How long a "picked it up" confirmation stays on screen. */
const PICKUP_NOTE_MS = 4_000;
/** How long an opened pack's contents stay revealed. */
const PACK_REVEAL_MS = 12_000;
/** Above this the player is walking, and the training area does not open. */
const TRAINING_MAX_SPEED_MPS = 1.2;
/**
 * How often the sparring partner throws something, and the spread on it.
 * Two to four seconds: slow enough to read a move end to end, quick enough
 * that the player is answering pressure rather than waiting for it.
 */
const SPAR_MIN_MS = 2_000;
const SPAR_MAX_MS = 4_000;
/**
 * Fire something at the moment a move actually connects.
 *
 * Contact used to happen a flat 420ms after the press whatever was thrown, so
 * a bite that lands a third of the way through its curve and a wing gust that
 * lands two thirds of the way through its own both landed on the same frame —
 * which is why an exchange read as two animations playing near each other
 * rather than as one blow hitting. `strikeFrames` carries each move's real
 * contact moments, read off the curve that draws it, and this books a timer
 * against every one of them: a chain lands twice because it hits twice.
 *
 * Returns its timers, because a component that unmounts mid-swing has to be
 * able to cancel a landing that is no longer going to happen.
 */
function isDefensiveMove(state: string): boolean {
  return (
    (DEFENSE_MOVES as readonly string[]).includes(state) ||
    (DEFENSIVE_COMBOS as readonly string[]).includes(state)
  );
}

function bookStrikes(state: AnimationState, land: (index: number) => void): number[] {
  return strikeFrames(state).map((frame, index) =>
    window.setTimeout(() => land(index), frame.at * 1_000),
  );
}
function Play() {
  const geo = useGeo();
  const session = useSession();
  const signedIn = Boolean(session.data?.user);
  // The player id has to come from the profile, not from battle state: before a
  // match starts there is no battle state, and without an id the host cannot be
  // recognised as the host — which is who gets the Start button.
  const profile = useMe(signedIn);
  const signOut = useSignOut();
  const myPlayerId = profile.data?.id ?? null;

  const [selectedAvatarId, setSelectedAvatarId] = React.useState<string | null>(null);
  const [matchId, setMatchId] = React.useState<string | null>(null);
  const [tappedId, setTappedId] = React.useState<string | null>(null);
  const [movement, setMovement] = React.useState<HudMovement | null>(null);
  const [actionNote, setActionNote] = React.useState<string | null>(null);
  const [pickupNote, setPickupNote] = React.useState<string | null>(null);
  // A pack opening is a moment, not a state: the reveal card sits there until
  // the next purchase replaces it or the timer clears it.
  const [packReveal, setPackReveal] = React.useState<PackReveal | null>(null);
  const [boosterNote, setBoosterNote] = React.useState<string | null>(null);
  /** The move the pads show as playing — presentation only, never authority. */
  const [previewMove, setPreviewMove] = React.useState<AnimationState>("idle");
  /**
   * The blow in the air, out of the server's own telegraph.
   *
   * Set on `avatar_windup` and cleared when the window it opened has closed.
   * It is what makes a defence a read rather than a button: the pad names the
   * move, rings the defences that answer that *kind* of move, and the timing
   * is read off the body the client is already animating.
   */
  const [incoming, setIncoming] = React.useState<IncomingBlow | null>(null);
  /** The last exchange in one line — grade, damage, and the roll behind it. */
  const [exchange, setExchange] = React.useState<string | null>(null);
  const [sparring, setSparring] = React.useState(false);
  const [partnerSeed, setPartnerSeed] = React.useState(() => newSparringSeed());
  const [partnerMove, setPartnerMove] = React.useState<string | null>(null);
  /**
   * The last training exchange's calculated damage. Presentation only: it is
   * shown, it is never applied, and nothing reads it back.
   */
  const [lastHit, setLastHit] = React.useState<TrainingHit | null>(null);
  /** Whether the pulled-up chrome is showing over a full-screen mode. */
  const [chromeRevealed, setChromeRevealed] = React.useState(false);
  /** Sideways: stick under the left thumb, moves under the right. */
  const landscape = useLandscape();

  const safetyConfig = useSafetyConfig(true);
  const safety = useSafetyCheck(geo.fix, true);
  const hazards = useHazards(geo.fix, true);
  const spawns = useNearbySpawns(geo.fix, true);
  const zone = useNearestZone(geo.fix, true);
  const battleConfig = useBattleConfig(true);

  const avatars = useEligibleAvatars(signedIn);
  const avatarLimits = useAvatarLimits(signedIn);
  const generateAvatar = useGenerateAvatar();
  const releaseAvatar = useReleaseAvatar();
  const quickMatch = useQuickMatch();
  const startMatch = useStartMatch();
  const leaveMatch = useLeaveMatch();
  const collect = useCollectSpawn();
  const updatePosition = useUpdatePosition();
  const attack = useAttack();
  const guard = useGuard();
  const ability = useUseAbility();

  const boosterInventory = useBoosterInventory(signedIn);
  const boosterPacks = useBoosterPacks(signedIn);
  const boosterLimits = useBoosterLimits(signedIn);
  const buyPack = useBuyPack();
  const equipBooster = useEquipBooster();
  const unequipBooster = useUnequipBooster();

  const myMatches = useMyMatches(signedIn);
  const match = useMatch(matchId);
  const myState = useMyBattleState(matchId);

  // A reload loses component state but not the match: the player is still a
  // participant server-side. Recover the live one (waiting or active, not left)
  // so refreshing the page does not strand them outside their own fight.
  const liveMatchId = React.useMemo(() => {
    const rows = myMatches.data ?? [];
    const live = rows.find(
      (row) => row.leftAt == null && (row.status === "waiting" || row.status === "active"),
    );
    return live?.id ?? null;
  }, [myMatches.data]);

  React.useEffect(() => {
    if (!matchId && liveMatchId) setMatchId(liveMatchId);
  }, [matchId, liveMatchId]);

  const verdict = safety.data as SafetyVerdict | undefined;
  const stage = useArStage({ onMarkerTap: (marker: Marker) => setTappedId(marker.id) });

  /* ------------------------------------------------------------- telegraph */

  /**
   * A blow the server announced before it landed.
   *
   * Kept per attacker, keyed by the strike time it named, for one reason: the
   * body starts swinging *now*, so when `avatar_damage` arrives at the strike
   * frame the reaction has to land on a swing already in flight rather than
   * restart it. Without this the client plays the same swing twice — once on
   * the telegraph and once on the resolution — and the second one rewinds the
   * animation at the exact instant it should be connecting.
   */
  const telegraph = React.useRef<Record<string, { attackType: string; strikeAt: number }>>({});
  const windupTimers = React.useRef<number[]>([]);

  React.useEffect(
    () => () => {
      windupTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  /**
   * The telegraphs, as they arrive. Not the feed: a windup is true for the
   * length of one blow and then it is a lie, so it drives a timer and a pad
   * badge instead of a durable log entry.
   */
  const onTelegraph = React.useCallback(
    (event: { type: string; payload: Record<string, unknown> }) => {
      const target = stage.stage;
      const payload = event.payload;
      const actor = typeof payload.playerId === "string" ? payload.playerId : null;
      if (!target || !actor || !myPlayerId) return;
      const mine = actor === myPlayerId;

      if (event.type === "avatar_windup") {
        const attackType = typeof payload.attackType === "string" ? payload.attackType : null;
        const strikeAt = typeof payload.strikeAt === "number" ? payload.strikeAt : null;
        if (!attackType || !strikeAt) return;
        telegraph.current[actor] = { attackType, strikeAt };

        // The attacker already swung on their own press, so only the far body
        // needs starting here — and starting it here is what gives the
        // defender something to read: the swing is visibly on its way.
        if (!mine && isAnimationState(attackType)) target.playSparringAnimation(attackType);

        // Aimed at this player: name it on the pad, ring the defences that
        // answer it, and take it down once the window it opened has shut.
        if (payload.targetPlayerId === myPlayerId) {
          const kind = payload.kind === "area" ? "area" : "melee";
          setIncoming({ attackType, kind });
          windupTimers.current.push(
            window.setTimeout(
              () => setIncoming((current) => (current?.attackType === attackType ? null : current)),
              Math.max(0, strikeAt + GUARD_WINDOW.lateToMs - Date.now()),
            ),
          );
        }
        return;
      }

      // A guard going up. The player's own is animated off the press, which
      // has the grade in its reply; this is the other body bracing, and seeing
      // it early is the whole reason the read is worth making.
      if (event.type === "avatar_guard" && !mine) {
        const defenseType = typeof payload.defenseType === "string" ? payload.defenseType : null;
        if (defenseType && isAnimationState(defenseType)) target.playSparringAnimation(defenseType);
      }
    },
    [stage.stage, myPlayerId],
  );

  const channel = useMatchChannel(matchId, { onEphemeral: onTelegraph });

  /* ------------------------------------------------------------- selection */

  const avatarList = React.useMemo<DockAvatar[]>(
    () => (avatars.data ?? []) as DockAvatar[],
    [avatars.data],
  );

  React.useEffect(() => {
    if (!selectedAvatarId && avatarList.length > 0) setSelectedAvatarId(avatarList[0]!.id);
  }, [avatarList, selectedAvatarId]);

  const selectedAvatar = avatarList.find((avatar) => avatar.id === selectedAvatarId) ?? null;

  /* ---------------------------------------------------------------- loadout */

  // The effective loadout is authoritative about how levelled the equipped
  // boosters are, and that level is what the scene animates at: a level 5
  // loadout breathes harder, lurches further and celebrates bigger than a
  // level 1 one. Read it from the server rather than inferring it locally so
  // the visual and the damage numbers never disagree.
  const loadout = useAvatarLoadout(selectedAvatarId);
  const loadoutLevel = React.useMemo(
    () => (loadout.data?.boosters ?? []).reduce((max, row) => Math.max(max, row.level), 1),
    [loadout.data],
  );

  /**
   * What the *body* is, reduced to the fields the mesh is actually built from.
   *
   * The avatar row carries a lot more than that — hp, xp, `updatedAt` — and a
   * fight rewrites those constantly: every durable match event re-reads the
   * avatar list, so the selected row arrives as a new object several times a
   * round. Keying the rebuild on the row itself therefore tore the character
   * down mid-swing and stood a fresh one back up at the scene origin, which
   * read on screen as the body teleporting away and locking up. Key it on the
   * shape instead: nothing here changes unless the player picks another
   * creature or the server re-rolls this one's form.
   */
  const characterKey = selectedAvatar
    ? [
        selectedAvatar.id,
        selectedAvatar.modelId,
        selectedAvatar.name,
        selectedAvatar.rarity,
        typeof selectedAvatar.form === "string"
          ? selectedAvatar.form
          : JSON.stringify(selectedAvatar.form ?? null),
      ].join("\u0000")
    : null;

  // The character in the scene is whichever avatar is selected. The level goes
  // in at build time so a rebuilt mesh never animates at level 1 for a frame.
  React.useEffect(() => {
    if (!stage.stage) return;
    stage.stage.setCharacter(
      selectedAvatar
        ? {
            modelId: selectedAvatar.modelId,
            name: selectedAvatar.name,
            rarity: selectedAvatar.rarity,
            level: loadoutLevel,
            // The body the server generated for this character. Characters made
            // before the form column existed have none, and the scene derives a
            // stable one from their modelId instead.
            form: parseStoredForm(selectedAvatar.form),
          }
        : null,
    );
    // `selectedAvatar` and `loadoutLevel` are deliberately not dependencies:
    // the row's identity churns during a fight and a booster levelling up
    // mid-session must not rebuild the mesh. `characterKey` covers the former
    // and the effect below handles the latter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.stage, characterKey]);

  // A booster that levels up during the session — from a battle, a pickup or a
  // swap in the panel — re-scales the reactions in place.
  React.useEffect(() => {
    stage.stage?.setCharacterLevel(loadoutLevel);
  }, [stage.stage, loadoutLevel]);

  /**
   * The body the move buttons are built from, and the moves it can perform at
   * the level its boosters are on. This is `movesForForm` — the same function
   * the battle engine picks moves by — so a button can never offer a move the
   * server would not have chosen for this creature.
   */
  const characterForm = React.useMemo(
    () =>
      selectedAvatar
        ? (parseStoredForm(selectedAvatar.form) ??
          formFromModelId(selectedAvatar.modelId, selectedAvatar.rarity))
        : null,
    [selectedAvatar],
  );
  const characterMoves = React.useMemo(
    () => (characterForm ? movesForForm(characterForm, loadoutLevel) : null),
    [characterForm, loadoutLevel],
  );

  // The selected character's voice. `say` is gated internally, so the triggers
  // below can fire as often as their source data changes.
  const voice = useAvatarVoice(stage.stage, selectedAvatar?.id ?? null);

  /* ---------------------------------------------------------------- markers */

  const opponents = React.useMemo(
    () => (match.data?.players ?? []).filter((player) => player.playerId !== myPlayerId),
    [match.data, myPlayerId],
  );

  const markers = React.useMemo<Marker[]>(() => {
    const origin = geo.origin;
    if (!origin) return [];
    const out: Marker[] = [];

    for (const spawn of spawns.data ?? []) {
      const { east, north } = enuOffset(origin, spawn);
      out.push({
        id: spawn.id,
        kind: "booster",
        east,
        north,
        label: spawn.booster.name,
        variant: spawn.booster.rarity,
        inRange: spawn.inRange,
        distanceM: spawn.distanceM,
      });
    }

    for (const hazard of hazards.data ?? []) {
      if (!hazard.near && hazard.distanceM > 120) continue;
      const { east, north } = enuOffset(origin, { lat: hazard.centerLat, lng: hazard.centerLng });
      out.push({
        id: hazard.id,
        kind: "hazard",
        east,
        north,
        label: hazard.name,
        variant: hazard.kind,
        radiusM: hazard.radiusM,
        distanceM: hazard.distanceM,
      });
    }

    for (const opponent of opponents) {
      const pose = channel.poses[opponent.playerId];
      const point = pose ?? opponent.position;
      if (!point) continue;
      const { east, north } = enuOffset(origin, point);
      out.push({
        id: `opponent:${opponent.playerId}`,
        kind: "opponent",
        east,
        north,
        label: opponent.avatarName,
        distanceM: geo.fix ? Math.round(distanceM(geo.fix, point)) : undefined,
      });
    }

    return out;
  }, [geo.origin, geo.fix, spawns.data, hazards.data, opponents, channel.poses]);

  /* -------------------------------------------------- pose reporting + pause */

  /**
   * A training zone is not a pause, it is a mode: combat is off but the
   * character keeps breathing, talking and taking animation states, so the
   * stage's paused stance (locked pose, amber ring) must not kick in for it.
   */
  const trainingZone = verdict?.verdict === "training_zone";
  // Undefined means the check has not landed yet, not that play is refused:
  // the server re-checks every gated action anyway, so an in-flight verdict
  // must not flicker the controls off screen.
  const battleBlocked = verdict?.canBattle === false;
  const pickupBlocked = verdict?.canPickup === false;
  const combatPaused = Boolean(movement?.paused) || (battleBlocked && !trainingZone);

  /* ------------------------------------------------ training + full screen */

  const inMatch = Boolean(matchId && match.data);
  const matchStatus = match.data?.match.status ?? "waiting";

  /**
   * The training area opens on its own, and only when standing on unclassified
   * ground is genuinely all that is wrong: still on your feet, no hazard under
   * or beside you, and no zone proposal waiting on review — a pending zone
   * comes back as `outside_zone`, so the verdict carrying no zone at all is
   * what says this ground is unclassified rather than under consideration.
   */
  const hazardNear =
    (verdict?.hazards ?? []).some((hazard) => hazard.inside || hazard.distanceM <= 40) ||
    (hazards.data ?? []).some((hazard) => hazard.near);
  const stationary =
    (verdict?.speedMps ?? 0) <= TRAINING_MAX_SPEED_MPS && !movement?.moving && !movement?.paused;
  const trainingMode =
    trainingZone && signedIn && !inMatch && stationary && !hazardNear && verdict?.zone == null;

  /**
   * A live fight takes the whole screen. Everything the HUD normally carries is
   * one pull away instead of permanently in front of the scene, because the
   * complaint that started this was simply that you could not see the fight.
   */
  const fullscreenBattle = inMatch && matchStatus === "active";
  const chromeHidden = (trainingMode || fullscreenBattle) && !chromeRevealed;
  const pullable = trainingMode || fullscreenBattle;

  /* ------------------------------------------------------------------- hype */

  /**
   * The announcer and the crowd. On in a live fight and in the training area —
   * the two places blows are thrown — and off everywhere else, so walking
   * around the map is not scored by a stadium.
   */
  const hype = useHype(
    stage.stage,
    fullscreenBattle || trainingMode,
    match.data?.players ?? [],
    voice.say,
  );
  // Pulled out so the effects below can depend on the callbacks rather than on
  // the whole hook result, whose `banner` changes on every callout and would
  // otherwise re-run the feed reader on each one.
  const {
    reportPayload: reportHype,
    reportTraining: reportTrainingHype,
    open: openHype,
    close: closeHype,
    reset: resetHype,
  } = hype;

  React.useEffect(() => {
    // The training area is the creature and nothing else: the world overlay —
    // boosters, hazard rings, opponents — is not offering anything there.
    stage.stage?.setMarkers(trainingMode ? [] : markers);
  }, [stage.stage, markers, trainingMode]);

  // A mode change starts with the chrome away: entering a fight should not
  // inherit a pulled-up HUD from the last one.
  React.useEffect(() => {
    setChromeRevealed(false);
  }, [matchId, trainingMode, fullscreenBattle]);

  /* ------------------------------------------------------ sparring partner */

  const partner = React.useMemo(() => rollSparringPartner(partnerSeed), [partnerSeed]);

  /**
   * The partner's reply to a move the player pressed: one timer per moment the
   * move connects, so a chain gets answered on both of its hits. Cleared on the
   * next press, so a reply to a swing the player has already moved on from
   * never arrives late.
   */
  const answerTimers = React.useRef<number[]>([]);
  /**
   * The same, for landings booked off the match feed. Kept on a ref rather than
   * inside the feed effect because the effect re-runs on every event and a
   * landing booked by the last one is still in flight.
   */
  const feedTimers = React.useRef<number[]>([]);
  React.useEffect(
    () => () => {
      answerTimers.current.forEach((timer) => window.clearTimeout(timer));
      feedTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  // Leaving the training area ends the spar — there is nothing to leave behind.
  React.useEffect(() => {
    if (!trainingMode && sparring) setSparring(false);
  }, [trainingMode, sparring]);

  /**
   * The live opponent's body, for a real match.
   *
   * The snapshot carries the other player's `modelId`, rarity and form, so the
   * same procedural mesh that draws the player's character draws theirs — a
   * fight is two characters squared up in the room, not a map marker floating
   * where their phone says they are. Destructured to primitives so a poll that
   * returns identical data does not rebuild the mesh every few seconds.
   */
  const liveOpponent = opponents.find((row) => row.alive) ?? opponents[0] ?? null;
  const duelModelId = liveOpponent?.modelId ?? null;
  const duelName = liveOpponent?.avatarName ?? null;
  const duelRarity = liveOpponent?.rarity ?? null;
  const duelForm = liveOpponent?.form ?? null;
  const duelOpponent = React.useMemo(
    () =>
      duelModelId
        ? {
            modelId: duelModelId,
            name: duelName ?? "Opponent",
            rarity: duelRarity ?? "common",
            level: 1,
            form: parseStoredForm(duelForm),
          }
        : null,
    [duelModelId, duelName, duelRarity, duelForm],
  );

  /**
   * Who is standing opposite the player: the training bot, or the other player
   * in a live match. One effect owns the second body in both modes, because
   * two effects fighting over the same slot would clear each other's character.
   */
  React.useEffect(() => {
    const target = stage.stage;
    if (!target) return;
    const bot =
      trainingMode && sparring
        ? {
            modelId: partner.modelId,
            name: partner.name,
            rarity: partner.rarity,
            level: partner.level,
            form: partner.form,
          }
        : null;
    const other = bot ?? (fullscreenBattle ? duelOpponent : null);
    if (!other) {
      target.setSparringPartner(null);
      setPartnerMove(null);
      setLastHit(null);
      return;
    }
    // A training bout stands them beside each other so both bodies are in
    // frame; a real fight puts them dead ahead of one another.
    target.setOpponentStance(bot ? "spar" : "duel");
    target.setSparringPartner(other);
    if (bot) target.saySparringLine(sparTaunt(partner.seed), 4_000);
    setPartnerMove(null);
    setLastHit(null);
    return () => target.setSparringPartner(null);
  }, [stage.stage, trainingMode, sparring, partner, fullscreenBattle, duelOpponent]);

  /**
   * A live fight seats itself.
   *
   * The training area asks the player to drop their character on the floor,
   * because that is the whole of what it is for. A match does not: the pad is
   * the only chrome on screen, the engine is already resolving swings, and a
   * fight with an empty room in the middle of it is the one state that reads
   * as broken. So the moment a match goes active the character is placed by
   * the same `place()` the button calls — the fallback path puts it the same
   * distance ahead as it always does — and the opponent is seated across from
   * it. The retry is for the mesh: the character config arrives with the
   * roster poll and `place()` refuses until there is a body to place.
   */
  React.useEffect(() => {
    if (!fullscreenBattle || stage.placed) return;
    if (stage.stage?.place()) return;
    const timer = window.setInterval(() => {
      if (stage.stage?.place()) window.clearInterval(timer);
    }, 400);
    return () => window.clearInterval(timer);
  }, [fullscreenBattle, stage.placed, stage.stage]);

  /**
   * When your own swing lets go of you again, and what to do with a press that
   * arrives a beat before it does. Both live in the clock — see the hook.
   */
  const clock = useCommitClock({
    polledReadyInMs: myState.data?.readyInMs ?? null,
    polledAttackReadyInMs: myState.data?.attackReadyInMs ?? null,
    polledAt: myState.dataUpdatedAt,
  });
  const { commitUntil, setCommitUntil, onBeat, readyAt, attackReadyAt } = clock;

  /* --------------------------------------------------- training-only damage */

  /**
   * The numbers a training exchange is scored with. A real match reads them
   * off `battle_state`; the training area has no match, so they are derived
   * from the body, its rarity and its booster level by the same curves the
   * server rolls a real character from.
   */
  const myTrainingStats = React.useMemo(
    () =>
      trainingStats({
        form: characterForm,
        rarity: selectedAvatar?.rarity ?? null,
        level: loadoutLevel,
      }),
    [characterForm, selectedAvatar?.rarity, loadoutLevel],
  );
  const partnerTrainingStats = React.useMemo(
    () => trainingStats({ form: partner.form, rarity: partner.rarity, level: partner.level }),
    [partner],
  );

  /**
   * Score a training move and throw the result away.
   *
   * The damage is real — same `computeDamage` the engine calls, same
   * mitigation, same crit roll, same variance — and it is then used for
   * nothing but the line on screen. No health is written, on either body: a
   * training hit is a number, not an injury, and the bar stays full.
   */
  const scoreTrainingHit = React.useCallback(
    (move: string, from: "you" | "partner") => {
      const attacker = from === "you" ? myTrainingStats : partnerTrainingStats;
      const target = from === "you" ? partnerTrainingStats : myTrainingStats;
      const defensive =
        (DEFENSE_MOVES as readonly string[]).includes(move) ||
        (DEFENSIVE_COMBOS as readonly string[]).includes(move);
      // Blocking, dodging and absorbing are not swings: they get the guard
      // sound and no number, because there is nothing for them to have dealt.
      if (defensive) {
        playCue("guard");
        return;
      }
      const combo = (COMBO_MOVES as readonly string[]).includes(move);
      const result = computeDamage({
        attack: attacker.attack,
        defense: target.defense,
        attackerSpeed: attacker.speed,
        // Full health every time: nothing carries over between exchanges,
        // because nothing was taken in the last one.
        targetHealth: target.health,
      });
      setLastHit({ move, damage: result.damage, crit: result.crit, combo, from });
      // The named training cue, not the generic one: a training hit reads as
      // its own event on the ear, distinct from a real swing landing.
      playCue(combo ? "combo_impact" : "training_hit");
      // The arena reacts in here too, off the same number.
      reportTrainingHype({ mine: from === "you", damage: result.damage, crit: result.crit, combo });
    },
    [myTrainingStats, partnerTrainingStats, reportTrainingHype],
  );

  /**
   * What drives the bot: a timer, not the engine. It throws one of its own
   * body's moves every two to four seconds, the player's character answers
   * with one of its defences, and both bodies square up again afterwards. The
   * swing is scored and dropped — no state is written and nothing is reported.
   */
  React.useEffect(() => {
    const target = stage.stage;
    if (!target || !trainingMode || !sparring) return;
    let cancelled = false;
    let throwTimer = 0;
    let answerTimers: number[] = [];

    const schedule = () => {
      throwTimer = window.setTimeout(
        () => {
          if (cancelled) return;
          const move = pickBotMove(partner.offence);
          if (move) {
            target.playSparringAnimation(move);
            setPartnerMove(move);
            playCue(cueForMove(move, COMBO_MOVES, DEFENSE_MOVES));
            // Whether the player's body gets a guard up is decided now, with
            // the move — but nothing is shown of it until the blow arrives.
            const answer = pickRandom(characterMoves?.defenses ?? []);
            answerTimers.forEach((timer) => window.clearTimeout(timer));
            answerTimers = bookStrikes(move, (index) => {
              if (cancelled) return;
              if (answer) target.playCharacterAnimation(answer);
              const landed = target.registerImpact({
                from: "partner",
                state: move,
                blocked: Boolean(answer),
              });
              // Thrown from too far to touch anything: the swing is the only
              // sound it makes, and it already made it. Nothing is scored,
              // because in here nothing was hit.
              if (landed.whiffed) return;
              if (answer) playCue("guard");
              // Scored on the first hit only. A chain lands twice on the eye
              // and the ear, but it is still one exchange and one number.
              if (index === 0) scoreTrainingHit(move, "partner");
            });
          }
          schedule();
        },
        SPAR_MIN_MS + Math.random() * (SPAR_MAX_MS - SPAR_MIN_MS),
      );
    };
    schedule();

    return () => {
      cancelled = true;
      window.clearTimeout(throwTimer);
      answerTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [stage.stage, trainingMode, sparring, partner, characterMoves, scoreTrainingHit]);

  React.useEffect(() => {
    stage.stage?.setCombatPaused(combatPaused);
  }, [stage.stage, combatPaused]);

  React.useEffect(() => {
    const state = myState.data;
    if (!state || !stage.stage) return;
    stage.stage.setCharacterHealth(state.currentHealth / Math.max(1, state.maxHealth));
  }, [stage.stage, myState.data]);

  /* ------------------------------------------------------------- reactions */

  /**
   * Combat animation is driven off the match feed rather than off the local
   * action handlers, because most of what happens to a character is not something
   * this client did: the damage that matters most is incoming. The feed is the
   * server's own ordered log, so the character reacts to what actually resolved.
   */
  const lastReactedSeq = React.useRef(0);

  React.useEffect(() => {
    // A new match restarts the sequence; keeping the old cursor would swallow
    // the first events of the fight.
    lastReactedSeq.current = 0;
    // Nothing is in the air in a fight that has not started.
    telegraph.current = {};
    setIncoming(null);
    setExchange(null);
    // The streak, the heat and the "not a scratch" flag are all per-fight.
    resetHype();
  }, [matchId, resetHype]);

  React.useEffect(() => {
    const target = stage.stage;
    if (!target || !myPlayerId || channel.feed.length === 0) return;
    // The feed is newest-first; replay oldest-first so the last reaction to be
    // triggered is the latest one that happened.
    const fresh = channel.feed.filter((event) => event.seq > lastReactedSeq.current).reverse();
    if (fresh.length === 0) return;
    lastReactedSeq.current = Math.max(...channel.feed.map((event) => event.seq));

    for (const event of fresh) {
      if (event.type === "avatar_damage") {
        // The server picked the move, from the body that threw it and the body
        // that took it. The core reactions stay the fallback for an event that
        // names no move, or names one this build does not know.
        const { attackType, defenseType } = event.payload;
        const swing: AnimationState = isAnimationState(attackType) ? attackType : "attack_lurch";
        const reaction: AnimationState = isAnimationState(defenseType) ? defenseType : "hit_react";
        // Blocked is the server's word, read off the defence it chose: a guard
        // is a guard, a hit reaction is a body wearing it. Nothing here decides
        // it, and nothing here may — this only picks which of the two the
        // player sees.
        const blocked = isAnimationState(defenseType) && isDefensiveMove(defenseType);
        const actor = event.payload.playerId;
        const mine = actor === myPlayerId;
        if (event.payload.targetPlayerId === myPlayerId || mine) {
          const from = mine ? "player" : "partner";
          /*
           * Was this blow telegraphed? If the windup for this exact swing
           * arrived, the body has been swinging since and the server timed
           * this event to the strike frame itself — so the landing is *now*,
           * and re-playing the swing would rewind it mid-connection. Without a
           * telegraph (the polling fallback, or a reconnect that missed it)
           * the old path stands: start the swing and book the impact for the
           * frame it connects on.
           */
          const announced = typeof actor === "string" ? telegraph.current[actor] : undefined;
          const telegraphed = announced?.attackType === attackType;
          if (typeof actor === "string") delete telegraph.current[actor];

          const land = () => {
            if (mine) target.playSparringAnimation(reaction);
            else target.playCharacterAnimation(reaction);
            /*
             * My blow landed, so my body may already be free again.
             *
             * The press guessed the full price of the swing — duration plus
             * the whole recovery — because that is what a whiff costs and the
             * press cannot know yet whether this one connects. The server has
             * since decided, and a hit confirm cut the recovery down: this is
             * the moment that becomes knowable, and the pad has to come back
             * up on the contact frame rather than a poll later, or the window
             * the cancel opened is one the player never sees.
             */
            if (mine && typeof event.payload.recoverInMs === "number") {
              const freeAt = Date.now() + Math.max(0, event.payload.recoverInMs);
              setCommitUntil((held) => Math.min(held, freeAt));
            }
            target.registerImpact({ from, state: swing, blocked, resolved: true });
            // The attacker's swing already sounded when the pad was pressed.
            // What the feed adds is the landing, so they hear the impact on
            // the other body rather than their own move twice.
            if (mine) {
              playCue(
                (COMBO_MOVES as readonly string[]).includes(attackType ?? "") ? "combo" : "hit",
              );
            } else {
              playCue(blocked ? "guard" : "hit");
            }
          };

          if (telegraphed) {
            land();
          } else {
            // The swing first, on whichever body threw it.
            if (mine) target.playCharacterAnimation(swing);
            else target.playSparringAnimation(swing);
            // Then the landing, on the frame the move actually connects rather
            // than on the frame the event was read. `resolved` because this
            // already happened: the server counted the hit, and range in here
            // is not allowed to turn it back into a miss.
            feedTimers.current.push(...bookStrikes(swing, land));
          }

          // The numbers, in the player's words. The engine already decided
          // them; this only stops them being invisible.
          setExchange(exchangeLine(event.payload, mine));

          /*
           * The arena's turn. Everything the callout, the announcer and the
           * crowd react to is read straight off this payload — the same numbers
           * the line above prints — so the shout can never disagree with the
           * fight. `message` is the server's own commentary line, written on
           * every hit since the engine was built and until now rendered nowhere
           * but the admin console.
           */
          reportHype(event.payload, mine, event.message ?? null);
        }
      } else if (event.type === "avatar_action" && event.payload.playerId === myPlayerId) {
        // An ability the caster fired: its own animation, not a generic lurch.
        const { attackType } = event.payload;
        if (isAnimationState(attackType)) target.playCharacterAnimation(attackType);
        playCue("combo");
      } else if (event.type === "avatar_death" && event.payload.playerId === myPlayerId) {
        target.playCharacterAnimation("hit_react");
        playCue("hit");
      } else if (event.type === "match_finished") {
        /*
         * Both bodies answer the result, on both screens. Losing used to play
         * nothing on the creature — a banner said "You lose" while the body
         * that had just been knocked out stood there breathing. So the states
         * are opposites dealt out the same way: the winner celebrates, the
         * loser slumps, and the opponent across the ring takes the other one.
         * The cue and the line follow: weight on the floor instead of a chirp,
         * and a loser that asks for a rematch rather than conceding.
         */
        const won = event.payload.winnerPlayerId === myPlayerId;
        target.playCharacterAnimation(won ? "celebrate" : "slump");
        target.playSparringAnimation(won ? "slump" : "celebrate");
        playCue(won ? "reaction" : "slam");
        voice.say(won ? "victory" : "defeat");
        closeHype(won);
      }
    }
    // Booked timers are kept so they can be cancelled on unmount, which means
    // the list grows for as long as the fight does. Anything this far back has
    // long since fired, and clearing a fired timer costs nothing.
    if (feedTimers.current.length > 32) {
      feedTimers.current
        .splice(0, feedTimers.current.length - 32)
        .forEach((timer) => window.clearTimeout(timer));
    }
  }, [
    channel.feed,
    closeHype,
    reportHype,
    myPlayerId,
    setCommitUntil,
    stage.stage,
    voice,
  ]);

  // Opening line. Driven by status rather than the `match_started` event so a
  // player who reloads mid-match still hears their character.
  React.useEffect(() => {
    if (match.data?.match.status === "active") voice.say("battle_start");
  }, [match.data?.match.status, voice]);

  // "Fight!" — the announcer's opening, on the same status edge as the
  // character's own line rather than on `match_started`, so a reload mid-match
  // does not leave the arena silent.
  React.useEffect(() => {
    if (match.data?.match.status === "active") openHype();
  }, [match.data?.match.status, openHype]);

  // Safety comes from the server verdict verbatim — the character only repeats
  // it. A training zone is not a warning, so it does not trigger the line.
  React.useEffect(() => {
    if (verdict?.canExplore === false) voice.say("hazard_warning", verdict.headline);
  }, [verdict?.canExplore, verdict?.headline, voice]);

  // Standing around with nothing happening: the one context that is not a
  // reaction to an event, so it needs a timer of its own.
  React.useEffect(() => {
    if (!stage.placed || matchId) return;
    const timer = setInterval(() => voice.say("idle"), 30_000);
    return () => clearInterval(timer);
  }, [stage.placed, matchId, voice]);

  /**
   * Whether the server would still accept a pose for this match.
   *
   * `match.data` is polled, so on its own it lets the ticker keep posting into
   * a fight that is already over: the engine rejects a pose from a knocked-out
   * player or a finished match, so every tick between the knockout and the
   * next poll came back 400. The feed arrives over the socket the moment it
   * happens, and neither a death nor a finish is reversible inside a match, so
   * it is the feed the ticker watches.
   *
   * The last opponent walking out counts too, and it is the earliest signal
   * there is: the engine settles a leaver's match behind a written after-action
   * summary, so `player_left` arrives seconds before the match is marked
   * finished. Waiting for the finish instead means posting into a fight that
   * nobody is left to have.
   */
  const poseClosed = React.useMemo(() => {
    const gone = new Set<string>();
    let over = false;
    for (const event of channel.feed) {
      const who = event.payload.playerId;
      if (event.type === "match_finished") over = true;
      else if (event.type === "avatar_death" && who === myPlayerId) over = true;
      else if (
        (event.type === "player_left" || event.type === "avatar_death") &&
        typeof who === "string"
      ) {
        gone.add(who);
      }
    }
    const opponentsLeft = opponents.filter((opponent) => !gone.has(opponent.playerId));
    return over || (opponents.length > 0 && opponentsLeft.length === 0);
  }, [channel.feed, myPlayerId, opponents]);

  /**
   * The engine can close a match a beat before the feed says so — a leaver's
   * match is settled while the after-action summary is still being written, so
   * a pose can leave this client while the fight is still live and be refused
   * by the time it lands. One refusal is that race; the ones after it would be
   * the ticker ignoring an answer it has already had.
   */
  const [poseRefused, setPoseRefused] = React.useState(false);
  React.useEffect(() => setPoseRefused(false), [matchId]);

  const reportPose = updatePosition.mutateAsync;
  React.useEffect(() => {
    if (!matchId || !geo.fix || poseClosed || poseRefused) return;
    if (match.data?.match.status !== "active") return;
    let cancelled = false;
    const send = async () => {
      const fix = geo.fix;
      if (!fix) return;
      try {
        const result = await reportPose({
          matchId,
          lat: fix.lat,
          lng: fix.lng,
          ...(stage.heading ? { heading: Math.round(stage.heading.headingDeg) } : {}),
        });
        if (!cancelled) setMovement(result.movement as HudMovement);
      } catch (error) {
        // A dropped pose is not fatal — the next tick retries, and the
        // server's own safety verdict keeps arriving through `safety.check`.
        // A refusal is different: it is an answer, and it will not change.
        if (!cancelled && isPoseRefusal(error)) setPoseRefused(true);
      }
    };
    void send();
    const timer = setInterval(() => void send(), POSE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    matchId,
    geo.fix,
    poseClosed,
    poseRefused,
    match.data?.match.status,
    reportPose,
    stage.heading,
  ]);

  /* -------------------------------------------------------------- pickups */

  const nearestSpawn = (spawns.data ?? [])[0] ?? null;
  const tappedSpawn = (spawns.data ?? []).find((spawn) => spawn.id === tappedId) ?? null;
  const activeSpawn = (tappedSpawn ??
    (nearestSpawn?.inRange ? nearestSpawn : null)) as SpawnTarget | null;

  const doCollect = () => {
    if (!activeSpawn || !geo.fix) return;
    collect.mutate(
      { spawnPointId: activeSpawn.id, lat: geo.fix.lat, lng: geo.fix.lng },
      {
        onSuccess: (result) => {
          setTappedId(null);
          // The sheet disappears the moment the spawn is claimed, so without
          // this the pickup would land with no feedback at all.
          setPickupNote(`${result.booster.name} added to your stash`);
          stage.stage?.playCharacterAnimation("celebrate");
          voice.say("booster_pickup", result.booster.name);
        },
      },
    );
  };

  // A module the player can see but has not taken yet. Announced while it is
  // still walkable, not only once it is in range, because the line is what
  // sends them towards it.
  React.useEffect(() => {
    if (!nearestSpawn) return;
    if (!nearestSpawn.inRange && nearestSpawn.distanceM > 80) return;
    voice.say("booster_found", nearestSpawn.booster.name);
  }, [nearestSpawn, voice]);

  /** Clears the pickup toast a few seconds after it appears. */
  React.useEffect(() => {
    if (!pickupNote) return;
    const timer = setTimeout(() => setPickupNote(null), PICKUP_NOTE_MS);
    return () => clearTimeout(timer);
  }, [pickupNote]);

  /* --------------------------------------------------------------- actions */

  const doGenerate = () => {
    setActionNote(null);
    generateAvatar.mutate({}, { onError: (error) => setActionNote(errorMessage(error)) });
  };

  /**
   * Free a slot. The server refuses while the character is mid-match, so the only
   * thing to do client-side is drop the selection and surface the refusal.
   */
  const doRelease = (avatarId: string) => {
    setActionNote(null);
    releaseAvatar.mutate(
      { avatarId },
      {
        onSuccess: () => {
          setSelectedAvatarId((current) => (current === avatarId ? null : current));
        },
        onError: (error) => setActionNote(errorMessage(error)),
      },
    );
  };

  /**
   * Buy a pack. The contents are rolled server-side, so the client's only job
   * is to show what came out — and to celebrate it, because a pack opening that
   * the character ignores feels like a receipt rather than a reward.
   */
  const doBuyPack = (tier: string) => {
    setBoosterNote(null);
    buyPack.mutate(
      { tier: tier as "common" | "rare" | "epic" | "mythic" },
      {
        onSuccess: (result) => {
          setPackReveal(result as PackReveal);
          stage.stage?.playCharacterAnimation("celebrate");
          const best = result.contents[result.contents.length - 1];
          if (best) voice.say("booster_pickup", best.booster.name);
        },
        onError: (error) => setBoosterNote(errorMessage(error)),
      },
    );
  };

  /** Clears the reveal card so it does not sit on screen for the rest of the session. */
  React.useEffect(() => {
    if (!packReveal) return;
    const timer = setTimeout(() => setPackReveal(null), PACK_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [packReveal]);

  const doEquip = (instanceId: string) => {
    if (!selectedAvatarId) return;
    setBoosterNote(null);
    equipBooster.mutate(
      { instanceId, avatarId: selectedAvatarId },
      { onError: (error) => setBoosterNote(errorMessage(error)) },
    );
  };

  const doUnequip = (instanceId: string) => {
    setBoosterNote(null);
    unequipBooster.mutate(
      { instanceId },
      { onError: (error) => setBoosterNote(errorMessage(error)) },
    );
  };

  const doQuickMatch = () => {
    if (!selectedAvatarId) return;
    setActionNote(null);
    quickMatch.mutate(
      {
        avatarId: selectedAvatarId,
        ...(geo.fix ? { lat: geo.fix.lat, lng: geo.fix.lng } : {}),
      },
      {
        onSuccess: (result) => {
          const id = (result as { match?: { id?: string }; id?: string }).match?.id ??
            (result as { id?: string }).id ??
            null;
          setMatchId(id);
        },
        onError: (error) => setActionNote(errorMessage(error)),
      },
    );
  };

  /**
   * What the clients measure and the server cannot.
   *
   * The gap between two bodies and the room behind one of them are AR-room
   * metres: they exist in the scene this device placed, and the server has no
   * eye on it. So both sides report and the engine reconciles — which is why
   * this is sent on every swing and every guard rather than kept locally.
   */
  const spacing = () => {
    const gap = stage.stage?.gapM();
    const behind = stage.stage?.spaceBehindM();
    return {
      ...(typeof gap === "number" ? { gapM: Math.round(gap * 100) / 100 } : {}),
      ...(typeof behind === "number" ? { spaceBehindM: Math.round(behind * 100) / 100 } : {}),
    };
  };

  /**
   * The move a press means, once the stick has had its say.
   *
   * Two inputs, one blow. The button names the strike and the stick names the
   * footwork it is thrown off, so pushing into an opponent turns a swipe into
   * the lunging swipe, stepping back turns it into whatever this body can
   * reach with, and circling turns it into the chain that comes round the
   * side. A centred stick throws exactly what was pressed.
   *
   * Read at the press, not at the send: `onBeat` can hold a press for the last
   * of a cooldown, and the thumb has usually moved on by the time it lands.
   */
  const footworkMove = (pressed: AnimationState): AnimationState =>
    moveForFootwork({
      pressed,
      bearing: stage.stage?.driveBearing() ?? null,
      throwable: throwableMoves(characterMoves),
    });

  /**
   * Throw the move that was pressed.
   *
   * `moveType` is the change: the pad used to be a single "attack" button and
   * the engine picked the swing, so the nineteen moves a body had were
   * decoration. The server still owns the outcome — and still refuses a move
   * this body cannot throw — but the choice is the player's now.
   */
  const doAttack = (targetPlayerId: string, moveType?: AnimationState) => {
    if (!matchId) return;
    const move = moveType ? footworkMove(moveType) : moveType;
    onBeat(attackReadyAt, () => throwAttack(targetPlayerId, move));
  };

  const throwAttack = (targetPlayerId: string, moveType?: AnimationState) => {
    if (!matchId) return;
    setActionNote(null);
    // The swing owns this body from the press, not from the reply: the engine
    // stamped its recovery at the same moment, and everything it refuses in
    // between has to read as refused here too.
    const pressedAt = Date.now();
    const heldUntil = commitUntil;
    const commitTo = (move: string) => {
      const profile = ATTACK_PROFILE[move] ?? ATTACK_PROFILE[FALLBACK_ATTACK]!;
      setCommitUntil(pressedAt + profile.durationMs + profile.recoveryMs);
    };
    commitTo(moveType ?? FALLBACK_ATTACK);
    /*
     * The body swings on the tap, not on the reply.
     *
     * It used to wait for `onSuccess`, and `onSuccess` is a round trip that
     * the server deliberately holds open for the length of the move's own
     * windup — so the swing began somewhere north of two hundred milliseconds
     * after the finger came off the button, every single time, and no amount
     * of animation polish survives that. The press is the move now: it starts
     * here, and the reply reconciles it.
     */
    const pressed = moveType && isAnimationState(moveType) ? moveType : FALLBACK_ATTACK;
    stage.stage?.playCharacterAnimation(pressed);
    playCue(cueForMove(pressed, COMBO_MOVES, DEFENSE_MOVES));
    setPreviewMove(pressed);
    attack.mutate(
      { matchId, targetPlayerId, ...(moveType ? { moveType } : {}), ...spacing() },
      {
        onSuccess: (result) => {
          const move = isAnimationState(result?.attackType) ? result.attackType : "attack_lurch";
          // Only if the engine threw something other than what was pressed:
          // the swing is already in the air, and restarting it on the reply
          // would undo the very latency this stopped paying. The pad follows
          // the correction for the same reason it always did — the feed is
          // about to name this move, not the pressed one.
          if (move !== pressed) {
            stage.stage?.playCharacterAnimation(move);
            playCue(cueForMove(move, COMBO_MOVES, DEFENSE_MOVES));
            setPreviewMove(move);
          }
          // The engine may have thrown something other than what was pressed,
          // and it is the move it threw that holds this body.
          commitTo(move);
        },
        // A refused swing bought no recovery, so give back the guess — but
        // never less than whatever was already holding the body before it.
        onError: (error) => {
          setCommitUntil(heldUntil);
          setActionNote(errorMessage(error));
        },
      },
    );
  };

  /**
   * Answer the blow in the air.
   *
   * A separate request from an attack, because it is a separate thing: it
   * names *what* the player guards with and never when. The server stamps the
   * arrival itself and grades it against the strike time it stamped when the
   * attack committed, so the timing cannot be claimed by a client — which is
   * the only reason a timed read can be trusted at all. The body braces on the
   * reply rather than on the press for the same reason: a refused guard that
   * animated anyway would teach the player a window that was not there.
   */
  const doGuard = (moveType: AnimationState) => {
    if (!matchId) return;
    // A guard is the press that most needs the buffer: it is aimed at a blow
    // already in the air, and the window it has to land in is shorter than the
    // recovery the player is pressing out of.
    onBeat(readyAt, () => throwGuard(moveType));
  };

  const throwGuard = (moveType: AnimationState) => {
    if (!matchId) return;
    setActionNote(null);
    const pressedAt = Date.now();
    const heldUntil = commitUntil;
    guard.mutate(
      { matchId, moveType, ...spacing() },
      {
        onSuccess: (result) => {
          const move = isAnimationState(result?.defenseType) ? result.defenseType : "block";
          stage.stage?.playCharacterAnimation(move);
          playCue("guard");
          setPreviewMove(move);
          // A guard commits too — shorter than any swing, but the server holds
          // the body for it all the same, so the row goes with it.
          setCommitUntil(pressedAt + (battleConfig.data?.guard.commitMs ?? 420));
        },
        onError: (error) => {
          setCommitUntil(heldUntil);
          setActionNote(errorMessage(error));
        },
      },
    );
  };

  const doAbility = (abilityId: string, targetPlayerId?: string) => {
    if (!matchId) return;
    setActionNote(null);
    ability.mutate(
      { matchId, abilityId, ...(targetPlayerId ? { targetPlayerId } : {}) },
      { onError: (error) => setActionNote(errorMessage(error)) },
    );
  };

  const doLeave = () => {
    if (!matchId) return;
    leaveMatch.mutate(
      { matchId },
      {
        onSettled: () => {
          setMatchId(null);
          setMovement(null);
        },
      },
    );
  };

  /* ------------------------------------------------------------------- view */

  const distances: Record<string, number | null> = {};
  const pausedRemote: Record<string, boolean> = {};
  for (const opponent of opponents) {
    const point = channel.poses[opponent.playerId] ?? opponent.position;
    distances[opponent.playerId] = geo.fix && point ? Math.round(distanceM(geo.fix, point)) : null;
    pausedRemote[opponent.playerId] = channel.poses[opponent.playerId]?.combatPaused ?? false;
  }

  const me = match.data?.players.find((player) => player.playerId === myPlayerId) ?? null;
  const hostPlayerId = match.data?.match.hostPlayerId;

  /**
   * Who the full-screen pad swings at. The HUD picks a target by tapping an
   * opponent's row, and the pad has no rows — so it aims at the nearest
   * opponent still standing and inside the engine's range, which is the one
   * the player was going to pick anyway. Out of range there is no target and
   * the pad says so rather than offering a press the server would refuse.
   */
  const attackRangeM = battleConfig.data?.attackRangeM ?? 30;
  const reachable = opponents
    .filter((opponent) => opponent.alive && (distances[opponent.playerId] ?? Infinity) <= attackRangeM)
    .sort((a, b) => (distances[a.playerId] ?? Infinity) - (distances[b.playerId] ?? Infinity));
  const battleTarget = reachable[0] ?? null;
  const hudAbilities = ((myState.data?.abilities ?? []) as HudAbility[]).filter(Boolean);
  const battleBlockedReason = movement?.paused
    ? "come to a stop to swing"
    : me && !me.alive
      ? "you are down"
      : !battleTarget
        ? `no opponent within ${attackRangeM} m`
        : null;
  /*
   * What the pad is waiting on — and a swing in flight is not on the list.
   *
   * `attack.isPending` used to be: the request is held open by the server for
   * the length of the move's own windup, so the whole pad went dead for a
   * couple of hundred milliseconds of every exchange, on top of the recovery
   * it was already greying for. The recovery is kept locally now and greys the
   * rows on its own clock, which is the honest one, so the request being in
   * flight is no longer anybody's business.
   */
  const battlePending = ability.isPending || startMatch.isPending || leaveMatch.isPending;

  /* ---------------------------------------------------------------- breath */

  /**
   * The pool, now.
   *
   * The server sends it regenerated to the moment it answered, and it answers
   * every two seconds — so between polls the honest number is that one plus
   * what has regenerated since, computed with the server's own function off
   * the server's own speed stat. The bar and the greyed-out buttons then agree
   * with what the engine will say when the press arrives, instead of refusing
   * a move the player can in fact afford.
   */
  const staminaMax = myState.data?.staminaMax ?? null;
  const staminaLive = myState.data
    ? staminaNow({
        stamina: myState.data.stamina,
        since: myState.dataUpdatedAt,
        now: Date.now(),
        speed: myState.data.speed,
      })
    : null;

  /** How much of your own recovery is left, off the deadline kept above. */
  const { recoverInMs, attackReadyInMs } = clock;

  /**
   * Why this particular move cannot be thrown.
   *
   * Two reasons, and they are the two Combat II added: it costs more breath
   * than is left, or it does not reach. Both are checked with the engine's own
   * profiles and its own `staminaCheck`, so the pad is a preview of the
   * server's answer rather than a second opinion on it — a button that greys
   * out for a reason the server would not give is worse than no button.
   */
  const disabledFor = (state: AnimationState): string | null => {
    const defence = DEFENCE_PROFILE[state];
    const offence = ATTACK_PROFILE[state];
    const cost = defence?.stamina ?? offence?.stamina ?? null;
    if (cost != null && staminaLive != null) {
      if (!staminaCheck({ stamina: staminaLive, cost }).allowed) {
        return `too winded — ${state.replace(/_/g, " ")} costs ${cost}`;
      }
    }
    // A guard reaches nobody, so reach is an attack's problem only.
    if (offence && !defence && stage.stage && !stage.stage.inReach(state)) {
      return `out of reach — ${offence.reachM} m`;
    }
    return null;
  };

  /**
   * Which defences answer the blow in the air.
   *
   * The ring is the read. The engine will only credit a guard whose `answers`
   * matches the incoming move's kind, so showing which ones those are turns a
   * row of six buttons into a decision with a right answer — and the timing
   * is still the player's problem.
   */
  const emphasise = (state: AnimationState): boolean => {
    if (!incoming) return false;
    const defence = DEFENCE_PROFILE[state];
    if (!defence) return false;
    return defence.answers === "any" || defence.answers === incoming.kind;
  };

  /**
   * A guard is not gated on the flat attack cooldown — that is the point. It
   * *is* gated on your own recovery, because the server gates everything on
   * it: swinging something heavy means you are still swinging it when the
   * counter arrives, and that is the risk side of throwing it.
   *
   * So this greys for `readyInMs` (the move's real recovery, or a stagger) and
   * not for `attackReadyInMs`, which carries the flat floor on top of it — a
   * defence is free again the moment the animation is, not a beat later.
   * Leaving the row live through the recovery meant the one press where timing
   * mattered hit a button the server had already refused.
   */
  const guardDisabled =
    Boolean(movement?.paused) ||
    Boolean(me && !me.alive) ||
    // Live through the last stretch of it: a press in there is caught and
    // thrown at the deadline rather than dropped, and a button the player
    // cannot press cannot be caught pressing.
    recoverInMs > INPUT_BUFFER_MS;

  /**
   * Play a move on the stage, score it, and apply none of it. Training only.
   */
  const playPreview = (pressed: AnimationState) => {
    // The training area is where the stick-plus-button mechanic is learnt, so
    // it resolves footwork on exactly the same terms a fight does — otherwise
    // the one place a player is free to experiment is the one place the
    // directions do nothing.
    const state = footworkMove(pressed);
    setPreviewMove(state);
    stage.stage?.playCharacterAnimation(state);
    playCue(cueForMove(state, COMBO_MOVES, DEFENSE_MOVES));
    // Mid-fight the opponent also answers, so a press reads as an exchange
    // rather than as the player shadow-boxing next to a stranger.
    if (!sparring) {
      // Nobody to hit: the number is the whole point of the press, so it is
      // scored on the press. Calculated and dropped, as ever — health never
      // moves in here.
      scoreTrainingHit(state, "you");
      return;
    }
    // What the swing does to the bot. A defence the player threw is not a
    // swing at all, so the bot answers it with a guard of its own; a real
    // attack it either gets a block up against or wears — and wearing it is
    // the hit reaction, which carries the glow pulse and the tail flick.
    const defensive =
      (DEFENSE_MOVES as readonly string[]).includes(state) ||
      (DEFENSIVE_COMBOS as readonly string[]).includes(state);
    const guard = defensive || Math.random() < SPAR_GUARD_CHANCE;
    const answer = guard ? pickRandom(partner.defence) : null;
    answerTimers.current.forEach((timer) => window.clearTimeout(timer));
    answerTimers.current = bookStrikes(state, (index) => {
      const target = stage.stage;
      if (!target) return;
      // A defence never lands on anybody, so there is no impact to register:
      // the bot just squares up with a guard of its own.
      if (defensive) {
        target.playSparringAnimation(answer ?? "hit_react");
        if (index === 0) scoreTrainingHit(state, "you");
        return;
      }
      const landed = target.registerImpact({ from: "player", state, blocked: Boolean(answer) });
      // Thrown from out of range: the body commits, finds air, and recovers —
      // and nothing is scored, because in here nothing was hit. The one place
      // range decides anything, and only because no server is in the loop.
      if (landed.whiffed) return;
      target.playSparringAnimation(answer ?? "hit_react");
      // The player's own move already sounded when the pad was pressed; what
      // this adds is the landing on the other body.
      if (!answer) playCue("hit");
      if (index === 0) scoreTrainingHit(state, "you");
    });
  };

  /**
   * The left-hand stick, in landscape: it walks the character.
   *
   * It replaced a stick that turned the body on the spot, which was all a body
   * that could not move had to offer. Facing is no longer hand-driven at all —
   * the character looks where it is walking and locks onto its opponent for the
   * length of a swing — so this is the only stick on screen.
   *
   * The handler is stable so the stick's own release-on-unmount does not fire
   * every time this component re-renders.
   */
  const drive = React.useCallback(
    (x: number, y: number) => stage.stage?.setCharacterDrive(x, y),
    [stage.stage],
  );
  const moveStick = <MoveStick onDrive={drive} />;

  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      {/* Camera passthrough for the non-WebXR path; empty until `startCamera`. */}
      <video
        ref={stage.videoRef}
        aria-label="Camera view behind the augmented reality scene"
        className="absolute inset-0 size-full object-cover"
        playsInline
        muted
      />
      <canvas
        ref={stage.canvasRef}
        aria-label="Augmented reality scene"
        className="absolute inset-0 size-full touch-none"
      />

      {/*
        The arcade layer, over the scene and under the controls. Its own
        absolute sibling rather than a child of the overlay below, so it cannot
        push the HUD's flex layout around, and `pointer-events-none` throughout
        so a callout landing over the attack button never eats the press.
      */}
      <HypeBanner banner={hype.banner} streak={hype.streak} commentary={hype.commentary} />

      <div
        ref={stage.overlayRef}
        className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-2 p-3"
      >
        {chromeHidden && trainingMode ? (
          /*
           * The training area owns the screen. No safety strip, no dock, no
           * shop, no world markers — one line saying where you are, the
           * creature, and its moves. The full UI is one pull away.
           */
          <TrainingMode
            headline={verdict?.headline ?? "Training Area"}
            characterName={selectedAvatar?.name ?? null}
            moves={characterMoves}
            level={loadoutLevel}
            active={previewMove}
            onPlay={playPreview}
            fighting={sparring}
            onToggleFight={() => setSparring((on) => !on)}
            onNewPartner={() => setPartnerSeed(newSparringSeed())}
            partnerName={sparring ? partner.name : null}
            partnerLevel={sparring ? partner.level : null}
            lastPartnerMove={partnerMove}
            lastHit={lastHit}
            placed={stage.placed}
            onPlace={stage.place}
            landscape={landscape}
            stick={moveStick}
            footer={
              <RevealHandle revealed={false} onChange={setChromeRevealed} label="full controls" />
            }
          />
        ) : chromeHidden ? (
          <>
            {/* Nothing at the top of a fight: the scene gets the whole frame. */}
            <div aria-hidden />
            <div
              className={
                landscape
                  ? "flex w-full flex-1 flex-col justify-end gap-2"
                  : "mx-auto w-full max-w-md space-y-2"
              }
            >
              {actionNote && (
                <div className="pointer-events-auto rounded-md border border-destructive/50 bg-destructive/15 px-3 py-2 text-[11px] text-destructive">
                  {actionNote}
                </div>
              )}
              <BattlePad
                moves={characterMoves}
                level={loadoutLevel}
                active={previewMove}
                onMove={(state) => battleTarget && doAttack(battleTarget.playerId, state)}
                onGuard={doGuard}
                guardDisabled={guardDisabled}
                disabledFor={disabledFor}
                emphasise={emphasise}
                incoming={incoming}
                stamina={staminaLive}
                staminaMax={staminaMax}
                exchange={exchange}
                targetName={battleTarget?.avatarName ?? null}
                // Minus the buffer: the attack row goes live for the last
                // stretch of the cooldown so a press on the beat has a button
                // to land on, and `doAttack` holds it until the beat.
                attackReadyInMs={Math.max(0, attackReadyInMs - INPUT_BUFFER_MS)}
                abilityReadyInMs={myState.data?.abilityReadyInMs ?? 0}
                ability={hudAbilities[0] ?? null}
                onAbility={() => {
                  const first = hudAbilities[0];
                  if (first) doAbility(first.id, battleTarget?.playerId);
                }}
                canAct={!battleBlockedReason}
                blockedReason={battleBlockedReason}
                pending={battlePending}
                landscape={landscape}
                stick={moveStick}
                footer={
                  <RevealHandle revealed={false} onChange={setChromeRevealed} label="battle HUD" />
                }
              />
            </div>
          </>
        ) : (
          <>
          {/* ---------------------------------------------------------- top */}
          <div className="pointer-events-auto space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/">
                <Button size="sm" variant="outline">
                  <Terminal className="size-4" />
                  GeoFights
                </Button>
              </Link>
              <Badge tone={stage.mode === "xr" ? "live" : stage.mode === "camera" ? "info" : "neutral"}>
                <Eye className="size-3" />
                {stage.mode}
              </Badge>
              <Badge tone={geo.status === "live" ? "live" : geo.status === "error" ? "bad" : "warn"}>
                <Satellite className="size-3" />
                {geo.status === "live" && geo.fix
                  ? `±${Math.round(geo.fix.accuracyM)} m`
                  : geo.status}
              </Badge>
              {stage.heading && (
                <Badge tone="neutral">
                  <Compass className="size-3" />
                  {compassPoint(stage.heading.headingDeg)} {Math.round(stage.heading.headingDeg)}°
                </Badge>
              )}
              {inMatch && (
                <Badge tone={channel.status === "live" ? "live" : channel.status === "polling" ? "warn" : "neutral"}>
                  <Radio className="size-3" />
                  {channel.status}
                </Badge>
              )}
            </div>

            <div className="max-w-md">
              <SafetyStrip verdict={verdict} pending={safety.isFetching} noFix={!geo.fix} />
            </div>

            {geo.error && (
              <div className="max-w-md">
                <EnvNotice geoDenied={geo.error.code === "denied"} />
              </div>
            )}

            {(geo.error || stage.error) && (
              <div className="max-w-md rounded-md border border-destructive/50 bg-destructive/15 px-3 py-2 text-[11px] text-destructive">
                {geo.error?.message ?? stage.error}
                {geo.error && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 w-full text-[11px]"
                    onClick={geo.retry}
                  >
                    Try locating again
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* ------------------------------------------------------- bottom */}
          <div className="pointer-events-auto mx-auto w-full max-w-md space-y-2">
            {pickupNote && (
              <div className="rounded-md border border-primary/50 bg-primary/15 px-3 py-2 text-[11px] text-primary">
                {pickupNote}
              </div>
            )}

            {activeSpawn && !pickupBlocked && (
              <CollectSheet
                spawn={activeSpawn}
                signedIn={signedIn}
                pending={collect.isPending}
                error={collect.error ? errorMessage(collect.error) : null}
                onCollect={doCollect}
                onDismiss={() => setTappedId(null)}
              />
            )}

            <div className="flex flex-wrap gap-2">
              {stage.capabilities?.xrSupported && stage.mode !== "xr" && (
                <Button size="sm" onClick={() => void stage.enterXR()}>
                  <Glasses className="size-4" />
                  Enter AR
                </Button>
              )}
              {stage.mode === "preview" && stage.capabilities?.cameraSupported && (
                <Button size="sm" variant="outline" onClick={() => void stage.startCamera()}>
                  <CameraIcon className="size-4" />
                  Camera view
                </Button>
              )}
              {stage.mode !== "preview" && (
                <Button size="sm" variant={stage.reticleVisible ? "default" : "outline"} onClick={stage.place}>
                  <Crosshair className="size-4" />
                  {stage.placed ? "Move character" : "Place character"}
                </Button>
              )}
              {!stage.motionGranted && (
                <Button size="sm" variant="outline" onClick={() => void stage.enableSensors()}>
                  <Compass className="size-4" />
                  Enable compass
                </Button>
              )}
              {geo.fix && (
                <Button size="sm" variant="ghost" onClick={geo.resetOrigin} title="Re-anchor the world here">
                  <RotateCcw className="size-4" />
                  Re-anchor
                </Button>
              )}
            </div>

            <div className="max-h-[52dvh] overflow-y-auto rounded-lg border border-border bg-background/88 p-3 backdrop-blur">
              {!signedIn ? (
                <SignInCard />
              ) : inMatch && matchStatus === "finished" ? (
                <MatchResult
                  players={(match.data?.players ?? []) as ResultPlayer[]}
                  winnerPlayerId={match.data?.match.winnerPlayerId ?? null}
                  myPlayerId={myPlayerId ?? null}
                  summary={match.data?.match.summary ?? null}
                  onLeave={doLeave}
                  pending={leaveMatch.isPending}
                />
              ) : inMatch ? (
                <BattleHud
                  status={matchStatus}
                  isHost={Boolean(hostPlayerId && hostPlayerId === myPlayerId)}
                  me={me}
                  players={match.data?.players ?? []}
                  lobby={match.data?.lobby ?? []}
                  distances={distances}
                  pausedRemote={pausedRemote}
                  movement={movement}
                  attackRangeM={battleConfig.data?.attackRangeM ?? 30}
                  abilities={((myState.data?.abilities ?? []) as HudAbility[]).filter(Boolean)}
                  attackReadyInMs={Math.max(0, attackReadyInMs - INPUT_BUFFER_MS)}
                  abilityReadyInMs={myState.data?.abilityReadyInMs ?? 0}
                  onStart={() => matchId && startMatch.mutate({ matchId })}
                  onAttack={doAttack}
                  onAbility={doAbility}
                  onLeave={doLeave}
                  pending={attack.isPending || ability.isPending || startMatch.isPending || leaveMatch.isPending}
                  note={actionNote}
                />
              ) : (
                <div className="space-y-3">
                  <AvatarDock
                    avatars={avatarList}
                    loading={avatars.isLoading}
                    selectedId={selectedAvatarId}
                    onSelect={setSelectedAvatarId}
                    onGenerate={doGenerate}
                    generating={generateAvatar.isPending}
                    onRelease={doRelease}
                    releasingId={
                      releaseAvatar.isPending ? (releaseAvatar.variables?.avatarId ?? null) : null
                    }
                    maxAvatars={avatarLimits.data?.maxAvatars}
                    onQuickMatch={doQuickMatch}
                    matching={quickMatch.isPending}
                    blockedReason={
                      trainingZone
                        ? "training area — battles disabled"
                        : battleBlocked
                          ? "not safe here"
                          : geo.status !== "live"
                            ? "needs location"
                            : null
                    }
                  />
                  {actionNote && <div className="text-[11px] text-destructive">{actionNote}</div>}
                  {/*
                   * Packs and the loadout. Collapsed by default: this is a camera
                   * screen first, and the shop should not be what the player sees
                   * when they point their phone at the world.
                   */}
                  <BoosterPanel
                    packs={(boosterPacks.data ?? []) as PackOffer[]}
                    inventory={(boosterInventory.data ?? []) as unknown as InventoryBooster[]}
                    currency={profile.data?.currency ?? null}
                    maxLevel={boosterLimits.data?.maxInstanceLevel ?? 5}
                    xpCurve={boosterLimits.data?.xpCurve ?? []}
                    selectedAvatarId={selectedAvatarId}
                    maxEquipped={boosterLimits.data?.maxEquippedPerAvatar ?? 3}
                    reveal={packReveal}
                    onBuyPack={doBuyPack}
                    buyingTier={buyPack.isPending ? (buyPack.variables?.tier ?? null) : null}
                    onEquip={doEquip}
                    onUnequip={doUnequip}
                    busyInstanceId={
                      equipBooster.isPending
                        ? (equipBooster.variables?.instanceId ?? null)
                        : unequipBooster.isPending
                          ? (unequipBooster.variables?.instanceId ?? null)
                          : null
                    }
                    error={boosterNote}
                  />
                  <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 font-mono text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {zone.data ? zone.data.name : "no zone nearby"}
                    </span>
                    <span>{coarseLabel(geo.fix)}</span>
                    {nearestSpawn && (
                      <span>
                        nearest booster {metres(nearestSpawn.distanceM)}
                      </span>
                    )}
                    {/*
                     * The session now also lives in localStorage as a bearer
                     * token, so without this there is no way off an account on a
                     * shared phone — clearing cookies would not do it.
                     */}
                    <button
                      type="button"
                      className="ml-auto underline underline-offset-2 hover:text-foreground"
                      onClick={() => signOut.mutate()}
                      disabled={signOut.isPending}
                    >
                      {profile.data?.username ? `sign out ${profile.data.username}` : "sign out"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            {/*
             * Pulled up over a full-screen mode: the same handle sends it back
             * down, so the gesture is reversible from where it landed.
             */}
            {pullable && (
              <RevealHandle
                revealed
                onChange={setChromeRevealed}
                label={trainingMode ? "full controls" : "battle HUD"}
              />
            )}
          </div>
          </>
        )}
      </div>

      {verdict && verdict.level === 2 && <SafetyBlock verdict={verdict} />}

      {/*
       * Sign-in comes before consent. This overlay covers the whole stage,
       * including the sign-in card below it, so showing it to a signed-out
       * visitor left the account form rendered but unclickable — which is what
       * "I made an account and cannot log in" actually was.
       */}
      {signedIn && geo.status === "unasked" && (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-background/96 backdrop-blur">
          <ConsentGate rules={safetyConfig.data?.rules} />
        </div>
      )}
    </div>
  );
}

export default Play;
