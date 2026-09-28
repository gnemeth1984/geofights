import type * as React from "react";
import { Crosshair, Shield, Sparkles, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CombatFrame } from "@/components/play/combat-frame";
import { MovePad, moveLabel, type MoveSet } from "@/components/play/move-pad";
import type { AnimationState } from "@/ar/character";
import type { HudAbility } from "@/components/play/battle-hud";

/**
 * The full-screen battle pad.
 *
 * A fight is the one moment the scene has to own the screen, so everything the
 * HUD normally carries — rosters, health bars, distances, the shop — is pulled
 * away and what is left is the target, the moves, and what the body has left
 * to throw them with.
 *
 * The press is the move now. It goes to the server as `moveType`, is checked
 * against the body that has to perform it, and carries that move's own power,
 * reach, stamina and telegraph — so the button the player pressed is the blow
 * the fight resolves. What the engine still owns is the *outcome*: the stat
 * line, the defender's read, the roll.
 *
 * Two rows, two meanings. An attack opens an exchange. A defence answers one
 * already in the air, against the telegraph the incoming blow broadcast — so
 * it is a different request, on its own timing, and the row says which blow it
 * is answering.
 */

/** The blow currently in the air, as the defender needs to read it. */
export type IncomingBlow = {
  attackType: string;
  /** What has to be answered: a body swinging, or the floor moving. */
  kind: "melee" | "area";
};

export function BattlePad({
  moves,
  level,
  active,
  onMove,
  onGuard,
  guardDisabled,
  disabledFor,
  emphasise,
  incoming,
  stamina,
  staminaMax,
  exchange,
  targetName,
  attackReadyInMs,
  abilityReadyInMs,
  ability,
  onAbility,
  canAct,
  blockedReason,
  pending,
  landscape,
  stick,
  footer,
}: {
  moves: MoveSet | null;
  level: number;
  active: AnimationState;
  onMove: (state: AnimationState) => void;
  /** A defence press. Answers the blow in the air rather than opening one. */
  onGuard?: (state: AnimationState) => void;
  guardDisabled?: boolean;
  /** Why one particular move cannot be thrown — reach, or breath. */
  disabledFor?: (state: AnimationState) => string | null;
  /** Which defences answer the kind of blow that is coming. */
  emphasise?: (state: AnimationState) => boolean;
  incoming?: IncomingBlow | null;
  stamina?: number | null;
  staminaMax?: number | null;
  /** The last exchange in one line: grade, damage, the roll behind it. */
  exchange?: string | null;
  targetName: string | null;
  attackReadyInMs: number;
  abilityReadyInMs: number;
  ability: HudAbility | null;
  onAbility: () => void;
  canAct: boolean;
  blockedReason: string | null;
  pending: boolean;
  /** Two-handed layout: stick on the left, moves on the right. */
  landscape?: boolean;
  stick?: React.ReactNode;
  /** Sits under the card — the pull handle goes here. */
  footer?: React.ReactNode;
}) {
  const cooling = attackReadyInMs > 0;
  const disabled = pending || !canAct || cooling;

  /*
   * What a press costs, said once. The move list is priced per move and the
   * pool is shared, so the thing worth telling the player is that the choice
   * is paid for — the per-button tooltips say which ones they cannot afford.
   */
  const swingNote = (
    <p className="text-[9px] text-foreground/60 [text-shadow:0_1px_2px_rgb(0_0_0/0.55)]">
      {incoming
        ? `Answer the ${moveLabel(incoming.attackType).toLowerCase()} — time it as it lands.`
        : "The move you press is the move thrown. Heavier moves cost more breath."}
    </p>
  );

  const staminaBar =
    typeof stamina === "number" && typeof staminaMax === "number" && staminaMax > 0 ? (
      <div className="flex items-center gap-1.5">
        <Zap className="size-3 shrink-0 text-foreground/70" />
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-background/40">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${Math.round((Math.max(0, stamina) / staminaMax) * 100)}%` }}
          />
        </div>
      </div>
    ) : null;

  const abilityButton = ability && (
    <Button
      size="sm"
      variant="secondary"
      className="h-8 w-full text-[11px]"
      disabled={pending || !canAct || abilityReadyInMs > 0}
      onClick={onAbility}
    >
      <Sparkles className="size-4" />
      {abilityReadyInMs > 0
        ? `${ability.name} · ${Math.ceil(abilityReadyInMs / 1000)}s`
        : `${ability.name} · ${ability.effect}`}
    </Button>
  );

  const card = (
      // Barely-there panel: a fight is the scene's moment, so the pad reads as
      // glass laid over it rather than a sheet covering it. The blur is what
      // keeps the labels legible against whatever the camera is pointed at —
      // the tint alone is far too thin to do it.
      <div
        data-pad="card"
        className={
          "flex flex-col rounded-lg border border-white/15 bg-background/20 p-2 backdrop-blur-sm " +
          // Upright the pad sits beside the stick and is held to a third of
          // the screen; sideways the frame already keeps it out of the middle.
          (landscape ? "" : "max-h-[33dvh]")
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={canAct && !cooling ? "live" : "warn"}>
            <Crosshair className="size-3" />
            {targetName ?? "no target"}
          </Badge>
          {/* The telegraph, named. The window itself is read off the body
              throwing it — that is what a windup is for — so this says what is
              coming and what kind of thing it is, and the ringed buttons below
              say what answers it. */}
          {incoming && (
            <Badge tone="warn">
              <Shield className="size-3" />
              {moveLabel(incoming.attackType)} · {incoming.kind}
            </Badge>
          )}
          {cooling && <Badge tone="neutral">{Math.ceil(attackReadyInMs / 1000)}s</Badge>}
          {blockedReason && <span className="text-[11px] text-accent">{blockedReason}</span>}
        </div>

        {/* Breath, and the last exchange's numbers. Both are one line tall:
            the pad is held to a third of the screen and every line it grows is
            a row of moves it has to clip instead. */}
        {staminaBar && <div className="mt-1">{staminaBar}</div>}
        {exchange && (
          <p className="mt-1 truncate text-[10px] text-foreground/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.55)]">
            {exchange}
          </p>
        )}

        {/*
         * Every move the body has, in both orientations and in both modes:
         * attacks, defences and the combinations the booster level unlocks.
         * Which one the engine picks is its business — hiding half of them
         * from the player is not.
         */}
        <div
          data-pad="moves"
          className={`mt-1.5 overflow-y-auto ${landscape ? "max-h-[48dvh]" : "min-h-0"}`}
        >
          <MovePad
            moves={moves}
            level={level}
            active={active}
            onPlay={onMove}
            onGuard={onGuard}
            disabled={disabled}
            guardDisabled={guardDisabled}
            disabledFor={disabledFor}
            emphasise={emphasise}
            showDefences
            defencesTitle={incoming ? `Answer · ${incoming.kind}` : undefined}
            columns
            glass
            dense={!landscape}
          />
        </div>

        {/* Upright these two live outside the card — see below. */}
        {landscape && <div className="mt-1.5">{swingNote}</div>}
        {landscape && ability && <div className="mt-1.5">{abilityButton}</div>}
      </div>
  );

  if (landscape) {
    return (
      <CombatFrame stick={stick} footer={footer}>
        {card}
      </CombatFrame>
    );
  }

  return (
    <div className="pointer-events-auto mx-auto w-full max-w-md">
      {/*
       * Held upright the controls split left and right, same as sideways: the
       * stick under the left thumb, the moves under the right one. Stacked, the
       * two of them ate the bottom half of the screen — which is where the
       * fight is standing.
       */}
      {/*
       * The note and the special go above and below the split row rather than
       * inside the card: held to a third of the screen, every line the card
       * carries is a row of moves it has to clip instead.
       */}
      <div className="mb-1.5">{swingNote}</div>
      <div className="flex items-end gap-2">
        {stick && <div className="shrink-0">{stick}</div>}
        <div className="min-w-0 flex-1">{card}</div>
      </div>
      {ability && <div className="mt-1.5">{abilityButton}</div>}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}
