import * as React from "react";
import {
  COMBO_WINDOW_MS,
  closingHype,
  freshHypeState,
  heatNow,
  hypeExchange,
  openingHype,
  taunt,
  tauntFor,
  type HypeBanner,
  type HypeExchange,
  type HypeState,
} from "@/lib/hype";
import { playCrowd, playHypeCall, primeHype, setCrowdHeat, stopCrowdBed } from "@/ar/hype";
import type { ARStage } from "@/ar/stage";
import type { SpeechContext } from "@/hooks/use-avatar-voice";
import { COMBO_MOVES } from "../../api/lib/creature-form";

/**
 * The fight's hype layer, as one hook.
 *
 * Lives here rather than in `play.tsx` for a boring reason and a good one: the
 * page is already a hundred lines under the lint ceiling, and the announcer has
 * to behave identically in a real match and in the training area, which means
 * it cannot be written into either code path.
 *
 * What the caller does is report exchanges. Everything that follows from one —
 * which milestone it is, whether the announcer shouts, what the crowd does, how
 * hot the room is, whether the opponent gets a line in — is decided in
 * `lib/hype.ts` (pure) and played through `ar/hype.ts` (audio). This is only the
 * glue and the React state.
 */

export type Hype = {
  /** The callout to draw, or null. */
  banner: HypeBanner | null;
  /** Blows deep the live chain is. */
  streak: number;
  /** The server's line about the last exchange. */
  commentary: string | null;
  /**
   * Report an `avatar_damage` payload from a real match. Safe to call on every
   * one; it decides on its own whether anything is worth saying.
   */
  reportPayload: (payload: Record<string, unknown>, mine: boolean, message: string | null) => void;
  /** Report a training hit, where the numbers are real but the damage is not. */
  reportTraining: (hit: { mine: boolean; damage: number; crit: boolean; combo: boolean }) => void;
  /** "Fight!" — call it when the match goes active. */
  open: () => void;
  /** The result call. A win with nothing landed on me becomes a PERFECT. */
  close: (won: boolean) => void;
  /** Wipe the streak, heat and callout — a new match, or leaving one. */
  reset: () => void;
};

/**
 * How often the crowd bed is re-pointed at the fight's heat.
 *
 * Heat decays in real time, so between blows there is no event to hang a
 * volume change on. Twice a second is far more often than a bed gliding over
 * about a second can visibly follow, and it costs one gain assignment.
 */
const HEAT_TICK_MS = 500;

/**
 * The player's own character's mouth, for a blow that just happened.
 *
 * Only ever about my character, and only for the three moments worth a line:
 * about to go down, just took a heavy one, just landed one. Everything smaller
 * is the announcer's and the crowd's job — a character that comments on every
 * jab is noise, and each line is a model round trip behind its own gates.
 */
function combatLine(exchange: HypeExchange): SpeechContext | null {
  if (exchange.whiff || exchange.damage <= 0) return null;
  const heavy = exchange.crit || exchange.damage >= 14;
  if (!exchange.mine) {
    // The blow came in, so the health left is mine.
    if (exchange.healthLeft != null && exchange.healthLeft <= 0.2) return "near_death";
    return heavy ? "taunt_hurt" : null;
  }
  return heavy ? "taunt_landed" : null;
}

export function useHype(
  stage: ARStage | null,
  enabled: boolean,
  /** The match roster, for turning absolute health into a fraction. */
  players: ReadonlyArray<{ playerId: string; maxHealth: number }>,
  /**
   * The character's voice, if the caller has one. Passed in rather than used
   * here so this hook stays the only place that decides *when* a fight is worth
   * a line, while `useAvatarVoice` stays the only place that rations them.
   */
  say?: (context: SpeechContext, detail?: string) => void,
): Hype {
  const state = React.useRef<HypeState>(freshHypeState());
  const [banner, setBanner] = React.useState<HypeBanner | null>(null);
  const [streak, setStreak] = React.useState(0);
  const [commentary, setCommentary] = React.useState<string | null>(null);

  // Read inside callbacks that must not be rebuilt when these change: a
  // `report` identity that churned would restart the feed effect that calls it.
  const stageRef = React.useRef(stage);
  stageRef.current = stage;
  const enabledRef = React.useRef(enabled);
  enabledRef.current = enabled;
  const playersRef = React.useRef(players);
  playersRef.current = players;
  const sayRef = React.useRef(say);
  sayRef.current = say;

  /**
   * Has anything landed on me this fight — the one fact a PERFECT needs and the
   * feed does not carry. Tracked in here rather than by the caller because it is
   * per-fight bookkeeping, which is exactly what this hook already owns.
   */
  const takenAHit = React.useRef(false);

  /*
   * The counter on screen is a live chain, so it has to be able to end on its
   * own. Nothing in the feed says "that chain is over" — a chain ends by the
   * window lapsing, which is a clock event, not an event event. Without this the
   * count from the last flurry hangs over a fight that has gone quiet.
   */
  const lapse = React.useRef<number | null>(null);
  const clearLapse = () => {
    if (lapse.current !== null) window.clearTimeout(lapse.current);
    lapse.current = null;
  };
  React.useEffect(() => clearLapse, []);

  /* The announcer set is ~270 KB and the first call of a match is "Fight!", so
   * the fetch has to have happened before then. Priming on mount is early
   * enough; the graph itself still waits for the gesture the browser wants. */
  React.useEffect(() => {
    if (enabled) primeHype();
  }, [enabled]);

  /* Keep the room pointed at the fight. One interval for the whole hook,
   * running only while there is a fight to have a room for. */
  React.useEffect(() => {
    if (!enabled) {
      stopCrowdBed();
      return;
    }
    const timer = window.setInterval(() => {
      setCrowdHeat(heatNow(state.current, Date.now()));
    }, HEAT_TICK_MS);
    return () => {
      window.clearInterval(timer);
      stopCrowdBed();
    };
  }, [enabled]);

  const report = React.useCallback((exchange: HypeExchange, message?: string | null) => {
    if (!enabledRef.current) return;
    if (!exchange.mine && !exchange.whiff && exchange.damage > 0) takenAHit.current = true;
    const now = Date.now();
    const result = hypeExchange(state.current, exchange, now);
    state.current = result.state;

    setStreak(result.streak);
    clearLapse();
    if (result.streak > 0) {
      lapse.current = window.setTimeout(() => {
        lapse.current = null;
        setStreak(0);
      }, COMBO_WINDOW_MS);
    }
    if (result.banner) setBanner(result.banner);
    // Only ever replaced by a line, never cleared by a silent exchange: the
    // commentary is the last thing said about the fight, and blanking it on
    // every whiff would make it flicker.
    if (message) setCommentary(message);

    if (result.call) playHypeCall(result.call);
    if (result.crowd) playCrowd(result.crowd);
    setCrowdHeat(result.heat);

    /* The opponent's mouth. `saySparringLine` is the second body's bubble in
     * both modes — the sparring partner in training, and the real opponent in a
     * match, since the same body is what a remote player is drawn as. */
    const kind = tauntFor(exchange, result.streak);
    if (kind) stageRef.current?.saySparringLine(taunt(kind, now), 3_000);

    /* My own character's mouth, which is the opposite arrangement: the line is
     * written server-side from this character's personality, so it is asked for
     * rather than picked. Never called on the opponent's behalf. */
    const spoken = combatLine(exchange);
    if (spoken) sayRef.current?.(spoken);
  }, []);

  const open = React.useCallback(() => {
    if (!enabledRef.current) return;
    const { call, banner: opening } = openingHype(Date.now());
    setBanner(opening);
    playHypeCall(call);
    setCrowdHeat(heatNow(state.current, Date.now()));
  }, []);

  const reportPayload = React.useCallback(
    (payload: Record<string, unknown>, mine: boolean, message: string | null) => {
      const targetId = typeof payload.targetPlayerId === "string" ? payload.targetPlayerId : null;
      const target = targetId
        ? playersRef.current.find((player) => player.playerId === targetId)
        : undefined;
      report(exchangeFromPayload(payload, mine, target?.maxHealth ?? null, !takenAHit.current), message);
    },
    [report],
  );

  /*
   * A training hit carries no health, on purpose: nothing is applied in the
   * training area and both bodies stay full, so the two calls that need a
   * health fraction — DANGER and FINISH — never fire there. Everything that is
   * about the blow itself still does.
   */
  const reportTraining = React.useCallback(
    (hit: { mine: boolean; damage: number; crit: boolean; combo: boolean }) => {
      report({
        mine: hit.mine,
        actor: hit.mine ? "you" : "partner",
        damage: hit.damage,
        crit: hit.crit,
        whiff: false,
        combo: hit.combo,
        grade: null,
        riposte: 0,
        killed: false,
        healthLeft: null,
        untouched: false,
      });
    },
    [report],
  );

  const close = React.useCallback((won: boolean) => {
    if (!enabledRef.current) return;
    const outcome = { won, untouched: won && !takenAHit.current };
    const { call, banner: closing } = closingHype(outcome, Date.now());
    setBanner(closing);
    playHypeCall(call);
    playCrowd(outcome.won ? "roar" : "gasp");
    // The chain is over whoever won it.
    clearLapse();
    setStreak(0);
    state.current = { ...state.current, streakBy: null, streak: 0 };
  }, []);

  const reset = React.useCallback(() => {
    state.current = freshHypeState();
    takenAHit.current = false;
    clearLapse();
    setBanner(null);
    setStreak(0);
    setCommentary(null);
  }, []);

  return { banner, streak, commentary, reportPayload, reportTraining, open, close, reset };
}

/**
 * Read an `avatar_damage` payload into the shape the hype layer wants.
 *
 * Every field is the server's own, lifted rather than recomputed — the numbers
 * on the callout have to be the numbers the engine applied, or the callout is
 * lying about a fight the player is watching.
 *
 * Two of them are not in the payload and are worked out here instead:
 *
 *   - `combo`, which the engine sends as the *move's* name rather than as a
 *     flag, so it is read off `COMBO_MOVES` the same way the sound cue is;
 *   - `killed`, because a death is its own `avatar_death` event and the damage
 *     event carries no flag for it. `targetHealth` hitting zero is the same
 *     fact arriving one event earlier, which is the event the K.O. call has to
 *     ride — waiting for `avatar_death` would put the shout a beat late.
 */
function exchangeFromPayload(
  payload: Record<string, unknown>,
  mine: boolean,
  /** The receiver's max health, for turning `targetHealth` into a fraction. */
  targetMaxHealth: number | null,
  untouched: boolean,
): HypeExchange {
  const number = (key: string): number | null =>
    typeof payload[key] === "number" ? (payload[key] as number) : null;

  const health = number("targetHealth");
  const attackType = typeof payload.attackType === "string" ? payload.attackType : "";

  return {
    mine,
    actor: typeof payload.playerId === "string" ? payload.playerId : mine ? "me" : "them",
    damage: number("damage") ?? 0,
    crit: payload.crit === true,
    whiff: payload.whiff === true,
    combo: (COMBO_MOVES as readonly string[]).includes(attackType),
    grade: typeof payload.grade === "string" ? payload.grade : null,
    riposte: number("riposte") ?? 0,
    killed: health != null && health <= 0,
    healthLeft:
      health != null && targetMaxHealth != null && targetMaxHealth > 0
        ? Math.max(0, Math.min(1, health / targetMaxHealth))
        : null,
    untouched,
  };
}
