import type * as React from "react";
import { Crosshair, Dumbbell, HeartPulse, RefreshCw, Swords, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CombatFrame } from "@/components/play/combat-frame";
import { MovePad, moveLabel, type MoveSet } from "@/components/play/move-pad";
import type { AnimationState } from "@/ar/character";

/**
 * The training area.
 *
 * Unclassified ground is not a dead screen: battles, pickups and progression
 * are off, but the character is on its floor, breathing, talking and able to
 * throw everything its body knows. So the chrome goes away — no safety strip,
 * no dock, no shop, no world markers — and what is left is the character, one
 * line saying where you are, and its moves.
 *
 * Damage *is* calculated here, by the same formula the engine uses, and then
 * deliberately dropped: every exchange reports what it would have done and no
 * health moves for it. The bar below is pinned full on purpose — a training hit
 * is a number, not an injury, and a player watching their health tick down in
 * a place where nothing is scored would reasonably assume it counted.
 */

/** What a training exchange produced. Presentation only — nothing reads it back. */
export type TrainingHit = {
  move: string;
  damage: number;
  crit: boolean;
  combo: boolean;
  /** Who threw it: the player's character, or the partner. */
  from: "you" | "partner";
};

export function TrainingMode({
  headline,
  characterName,
  moves,
  level,
  active,
  onPlay,
  fighting,
  onToggleFight,
  onNewPartner,
  partnerName,
  partnerLevel,
  lastPartnerMove,
  lastHit,
  placed,
  onPlace,
  landscape,
  stick,
  footer,
}: {
  headline: string;
  characterName: string | null;
  moves: MoveSet | null;
  level: number;
  active: AnimationState;
  onPlay: (state: AnimationState) => void;
  fighting: boolean;
  onToggleFight: () => void;
  onNewPartner: () => void;
  partnerName: string | null;
  partnerLevel: number | null;
  lastPartnerMove: string | null;
  /** The last exchange's calculated damage, which never landed. */
  lastHit: TrainingHit | null;
  placed: boolean;
  onPlace: () => void;
  /** Two-handed layout: stick on the left, moves on the right. */
  landscape?: boolean;
  stick?: React.ReactNode;
  /** Sits under the card, inside the bottom group — the pull handle goes here. */
  footer?: React.ReactNode;
}) {
  /* The un-placed state is the same in both orientations: there is nothing to
   * train with until the character is on the floor. */
  const placePrompt = (
    <div className="rounded-lg border border-border bg-background/88 p-3 backdrop-blur">
      <p className="text-[11px] text-muted-foreground">
        Point the camera at the floor ahead of you and drop your character in to train.
      </p>
      <Button size="sm" className="mt-2 w-full" onClick={onPlace}>
        <Crosshair className="size-4" />
        Place character
      </Button>
    </div>
  );

  /*
   * Who you are fighting, as a chip on the scene rather than a line in the pad.
   * Beside the stick the pad is half as wide as it was, and a wrapped badge
   * cost it a whole row of moves — the opponent's name reads better up with the
   * character it belongs to anyway.
   */
  const versus = fighting && partnerName && (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/50 bg-background/75 px-3 py-1 text-[11px] font-medium text-sky-300 backdrop-blur">
      <Swords className="size-3" />
      vs {partnerName}
      {partnerLevel ? ` · lv ${partnerLevel}` : ""}
    </div>
  );

  /*
   * One line: whose body this is, and the fight toggle. It never wraps, so
   * during a fight — when two buttons need the width — the name steps aside
   * rather than truncating to nothing: the character is on screen, and the
   * opponent is named on the chip above it.
   */
  const status = (
    <div className="flex items-center gap-1.5">
      {!fighting && (
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold [text-shadow:0_1px_2px_rgb(0_0_0/0.55)]">
          {characterName ?? "No character"}
        </span>
      )}
      <div className="ml-auto flex shrink-0 gap-1">
        {fighting && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onClick={onNewPartner}
            title="Roll a different opponent"
          >
            <RefreshCw className="size-3.5" />
            new opponent
          </Button>
        )}
        <Button
          size="sm"
          variant={fighting ? "outline" : "default"}
          className="h-6 px-1.5 text-[10px]"
          onClick={onToggleFight}
        >
          {fighting ? <X className="size-3.5" /> : <Swords className="size-3.5" />}
          {fighting ? "end fight" : "fight an opponent"}
        </Button>
      </div>
    </div>
  );

  /* The health bar, pinned. It exists to say that it is not moving. */
  const health = (
    <div className="mt-1.5 flex items-center gap-2">
      <HeartPulse className="size-3 shrink-0 text-muted-foreground" />
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-full rounded-full bg-emerald-500/80" />
      </div>
      <span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        full · no damage
      </span>
    </div>
  );

  return (
    <>
      {/* The one line of chrome that survives: where you are, why, and — once
          there is one — who you are squared up against. */}
      {!landscape && (
        <div className="pointer-events-none flex flex-wrap justify-center gap-1.5 pt-1">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-accent/50 bg-background/75 px-3 py-1 text-[11px] font-medium text-accent backdrop-blur">
            <Dumbbell className="size-3" />
            {headline}
          </div>
          {versus}
        </div>
      )}

      {landscape ? (
        <CombatFrame stick={placed ? stick : undefined} footer={footer}>
          {!placed ? (
            placePrompt
          ) : (
            <>
              {/*
               * Sideways there is no room for the full status card, but the
               * fight has to be startable from here or the mode is read-only
               * in the orientation it was designed for.
               */}
              <div className="flex items-center gap-1.5 rounded-md border border-border/70 bg-background/85 px-2 py-1 backdrop-blur">
                {fighting && partnerName ? (
                  <Badge tone="info">
                    <Swords className="size-3" />
                    vs {partnerName}
                    {partnerLevel ? ` · lv ${partnerLevel}` : ""}
                  </Badge>
                ) : (
                  <span className="truncate text-[11px] font-medium">
                    {characterName ?? "No character"}
                  </span>
                )}
                <div className="ml-auto flex gap-1">
                  {fighting && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5 text-[10px]"
                      onClick={onNewPartner}
                      title="Roll a different opponent"
                    >
                      <RefreshCw className="size-3" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={fighting ? "outline" : "default"}
                    className="h-6 px-1.5 text-[10px]"
                    onClick={onToggleFight}
                  >
                    {fighting ? <X className="size-3" /> : <Swords className="size-3" />}
                    {fighting ? "end" : "fight"}
                  </Button>
                </div>
              </div>
              <TrainingHitNote hit={lastHit} partnerName={partnerName} fighting={fighting} compact />
              {/* Glass over the camera, same as the battle pad: the character
                  on the floor is the point, and the pad is in front of it. */}
              <div data-pad="card" className="rounded-lg border border-white/15 bg-background/20 p-2 backdrop-blur-sm">
                <div data-pad="moves" className="max-h-[42dvh] overflow-y-auto">
                  <MovePad
                    moves={moves}
                    level={level}
                    active={active}
                    onPlay={onPlay}
                    showDefences
                    columns
                    glass
                  />
                </div>
              </div>
            </>
          )}
        </CombatFrame>
      ) : (
        <div className="pointer-events-auto mx-auto w-full max-w-md">
          {!placed ? (
            placePrompt
          ) : (
            /*
             * Upright, the controls are split the way the hands are: the stick
             * on the left under the left thumb, the moves on the right under
             * the right one, side by side rather than stacked. Stacked they ran
             * to half the screen; beside each other the pair is capped at a
             * third of it, and the character standing on the floor keeps the
             * other two thirds.
             */
            <>
              {/*
               * What the last exchange did sits above the controls, not inside
               * them. It is the longest and least predictable thing on screen —
               * a wrapped hit note used to swallow two rows of moves — and it
               * is a readout of the fight, which belongs with the fight.
               */}
              <div className="mb-1.5">
                {lastHit ? (
                  <TrainingHitNote
                    hit={lastHit}
                    partnerName={partnerName}
                    fighting={fighting}
                    compact
                  />
                ) : (
                  <p className="rounded-md border border-white/10 bg-background/30 px-2 py-1 text-[9px] leading-snug text-foreground/75 backdrop-blur-sm [text-shadow:0_1px_2px_rgb(0_0_0/0.55)]">
                    {fighting
                      ? lastPartnerMove
                        ? `${partnerName} threw ${moveLabel(lastPartnerMove)} — counted, not taken.`
                        : "Squaring up. Damage is calculated and thrown away."
                      : "Every move is scored and nothing lands — no health, no pickups, no rewards."}
                  </p>
                )}
              </div>

              <div className="flex items-end gap-2">
                {stick && <div className="shrink-0">{stick}</div>}
                <div
                  data-pad="card"
                  className="flex max-h-[33dvh] min-w-0 flex-1 flex-col rounded-lg border border-white/15 bg-background/20 p-2 backdrop-blur-sm"
                >
                  {status}
                  {health}

                  {/* The cap is on the card, so the moves can never push the
                      pad past a third of the screen — they shrink and scroll
                      first. At this body's move count they do not have to. */}
                  <div data-pad="moves" className="mt-1 min-h-0 overflow-y-auto">
                    <MovePad
                      moves={moves}
                      level={level}
                      active={active}
                      onPlay={onPlay}
                      showDefences
                      columns
                      glass
                      dense
                    />
                  </div>
                </div>
              </div>
            </>
          )}
          {footer && <div className="mt-2">{footer}</div>}
        </div>
      )}
    </>
  );
}

/**
 * What the last exchange would have done. The wording is the whole feature:
 * the number is real and the hit is not, and both halves of that have to be on
 * screen at once or the player is left guessing which.
 */
function TrainingHitNote({
  hit,
  partnerName,
  fighting,
  compact,
}: {
  hit: TrainingHit | null;
  partnerName: string | null;
  fighting: boolean;
  compact?: boolean;
}) {
  if (!hit) {
    if (!compact) return null;
    return (
      <div className="rounded-md border border-border/70 bg-background/80 px-2.5 py-1.5 text-[10px] text-muted-foreground backdrop-blur">
        {fighting ? "Squaring up — nothing lands here." : "Training · no damage"}
      </div>
    );
  }
  const who = hit.from === "you" ? "You" : (partnerName ?? "Opponent");
  return (
    <div
      className={`${compact ? "" : "mt-1.5 "}rounded-md border border-accent/50 bg-accent/10 px-2 py-1 backdrop-blur-sm`}
    >
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone="info">{hit.combo ? "Training Combo" : "Training Hit"}</Badge>
        <span className="min-w-0 truncate text-[10px] font-medium">
          {who} · {moveLabel(hit.move)}
        </span>
        <span className="text-[10px] text-muted-foreground">
          would have dealt {hit.damage}
          {hit.crit ? " · critical" : ""}
          {compact ? " · health untouched" : ""}
        </span>
      </div>
      {/*
       * Squeezed in next to the stick there is no room for the full sentence,
       * so compact folds the promise into the damage line instead; the roomier
       * layouts still spell it out underneath.
       */}
      {!compact && (
        <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground/90">
          Health untouched — training damage is counted, never taken.
        </p>
      )}
    </div>
  );
}
