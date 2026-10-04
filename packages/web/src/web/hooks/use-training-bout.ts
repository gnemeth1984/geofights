import * as React from "react";
import { COMBO_MOVES, DEFENSE_MOVES, DEFENSIVE_COMBOS, type CreatureForm } from "../../api/lib/creature-form";
import { computeDamage } from "../../api/lib/damage";
import { attackProfile, defenceProfile } from "../../api/lib/move-combat";
import { trainingStats } from "../../api/lib/training-stats";
import { playCue } from "@/ar/sfx";

/**
 * A training bout with real health.
 *
 * Every swing goes through the same `computeDamage` the engine calls, scaled
 * by the move's own power the way a match scales it, and is then *taken*: the
 * target's bar drops, and the first body to reach zero loses the round. A
 * guard the defender got up cuts the blow by what that defence's early read
 * is worth in a match (a dodge does nothing about an area burst, exactly as it
 * does not in a match).
 *
 * The bout is local and resets on rematch or a new opponent. It writes
 * nothing to the server, so a knock-out in here costs no wins, coins or
 * rating — the stakes are the bar, not the account.
 */

export type TrainingSide = "you" | "partner";

export type TrainingHit = {
  move: string;
  damage: number;
  crit: boolean;
  combo: boolean;
  /** True when a guard took part of it. */
  blocked: boolean;
  from: TrainingSide;
  /** Whether it was taken off a health bar (false when shadow-boxing alone). */
  applied: boolean;
};

export type TrainingOutcome = "won" | "lost" | null;

type Fighter = { form: CreatureForm | null | undefined; rarity?: string | null; level?: number | null };

const isDefensive = (move: string) =>
  (DEFENSE_MOVES as readonly string[]).includes(move) ||
  (DEFENSIVE_COMBOS as readonly string[]).includes(move);

/** How much of a blow a guard lets through, from the match's own table. */
function guardShare(attack: string, guard: string | null | undefined) {
  if (!guard) return 1;
  const defence = defenceProfile(guard);
  if (!defence) return 1;
  const kind = attackProfile(attack).kind;
  const answers = defence.answers === "any" || defence.answers === kind;
  return answers ? defence.early : 1;
}

export function useTrainingBout(input: {
  mine: Fighter;
  partner: Fighter;
  /** Sparring with a partner: hits land on bars. Off: the number is shown only. */
  sparring: boolean;
  onHype: (hit: { mine: boolean; damage: number; crit: boolean; combo: boolean }) => void;
}) {
  const { sparring, onHype } = input;
  const { form: myForm, rarity: myRarity, level: myLevel } = input.mine;
  // The partner's rarity and level are rolled for show (its move set and
  // combos). Its stats are scaled to the player's own, so a common character
  // isn't fed to a legendary one: same power budget, its body decides the mix.
  const { form: theirForm } = input.partner;
  const mine = React.useMemo(
    () => trainingStats({ form: myForm, rarity: myRarity, level: myLevel }),
    [myForm, myRarity, myLevel],
  );
  const partner = React.useMemo(
    () => trainingStats({ form: theirForm, rarity: myRarity, level: myLevel }),
    [theirForm, myRarity, myLevel],
  );

  const [myHp, setMyHp] = React.useState(mine.health);
  const [partnerHp, setPartnerHp] = React.useState(partner.health);
  const [lastHit, setLastHit] = React.useState<TrainingHit | null>(null);
  const [outcome, setOutcome] = React.useState<TrainingOutcome>(null);
  // Read inside the scorer, which fires from timers that outlive a render.
  const hp = React.useRef({ you: mine.health, partner: partner.health, over: false });

  const reset = React.useCallback(() => {
    hp.current = { you: mine.health, partner: partner.health, over: false };
    setMyHp(mine.health);
    setPartnerHp(partner.health);
    setLastHit(null);
    setOutcome(null);
  }, [mine.health, partner.health]);

  // A new body on either side is a new bout.
  React.useEffect(() => reset(), [reset]);

  const score = React.useCallback(
    (move: string, from: TrainingSide, guard?: string | null) => {
      if (isDefensive(move)) {
        playCue("guard");
        return;
      }
      if (hp.current.over) return;
      const attacker = from === "you" ? mine : partner;
      const target = from === "you" ? partner : mine;
      const targetKey: TrainingSide = from === "you" ? "partner" : "you";
      const profile = attackProfile(move);
      const share = guardShare(move, guard);
      const swing = computeDamage({
        attack: attacker.attack,
        defense: target.defense,
        attackerSpeed: attacker.speed,
        targetHealth: sparring ? hp.current[targetKey] : target.health,
        multiplier: profile.power,
        critBonus: profile.critBonus,
      });
      const damage = share <= 0 ? 0 : Math.max(1, Math.round(swing.damage * share));
      const combo = (COMBO_MOVES as readonly string[]).includes(move);
      setLastHit({ move, damage, crit: swing.crit, combo, blocked: share < 1, from, applied: sparring });
      playCue(combo ? "combo_impact" : sparring ? "hit" : "training_hit");
      onHype({ mine: from === "you", damage, crit: swing.crit, combo });
      if (!sparring) return;

      const left = Math.max(0, hp.current[targetKey] - damage);
      hp.current[targetKey] = left;
      if (targetKey === "partner") setPartnerHp(left);
      else setMyHp(left);
      if (left === 0) {
        hp.current.over = true;
        setOutcome(from === "you" ? "won" : "lost");
      }
    },
    [mine, partner, sparring, onHype],
  );

  return {
    myHp,
    myMax: mine.health,
    partnerHp,
    partnerMax: partner.health,
    lastHit,
    outcome,
    score,
    reset,
  };
}
