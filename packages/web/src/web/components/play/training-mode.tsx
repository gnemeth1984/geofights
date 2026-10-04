import type * as React from "react";
import { Crosshair, Dumbbell, RefreshCw, RotateCcw, Swords, Trophy, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CombatFrame } from "@/components/play/combat-frame";
import { MovePad, moveLabel, type MoveSet } from "@/components/play/move-pad";
import type { AnimationState } from "@/ar/character";
import type { TrainingHit, TrainingOutcome } from "@/hooks/use-training-bout";

/**
 * The training area.
 *
 * Unclassified ground is not a dead screen: battles, pickups and progression
 * are off, but the character is on its floor, breathing, talking and able to
 * throw everything its body knows. So the chrome goes away — no safety strip,
 * no dock, no shop, no world markers — and what is left is the character, one
 * line saying where you are, and its moves.
 *
 * Sparring is a real bout: every hit goes through the engine's damage
 * formula and comes off the target's health bar, and the first body to zero
 * loses the round. It is still training — nothing is sent to the server, so a
 * knock-out costs no wins, coins or rating, and a rematch starts both full.
 */

export type { TrainingHit };

type BoutView = {
  myHp: number;
  myMax: number;
  partnerHp: number;
  partnerMax: number;
  outcome: TrainingOutcome;
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
  bout,
  onRematch,
  placed,
  onPlace,
  landscape,
  stick,
  footer,
  suggest,
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
  /** The last exchange: what it dealt, and to whom. */
  lastHit: TrainingHit | null;
  bout: BoutView;
  onRematch: () => void;
  placed: boolean;
  onPlace: () => void;
  /** Two-handed layout: stick on the left, moves on the right. */
  landscape?: boolean;
  stick?: React.ReactNode;
  /** Sits under the card, inside the bottom group — the pull handle goes here. */
  footer?: React.ReactNode;
  /** "Suggest a ground" — the way out of unclassified ground. Hidden mid-fight. */
  suggest?: React.ReactNode;
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

  /* Both bars while sparring; nothing to lose when shadow-boxing alone. */
  const health = fighting ? (
    <div className="mt-1.5 space-y-1">
      <HealthRow label="You" hp={bout.myHp} max={bout.myMax} tone="you" />
      <HealthRow label={partnerName ?? "Opponent"} hp={bout.partnerHp} max={bout.partnerMax} tone="them" />
    </div>
  ) : null;

  const result = fighting && bout.outcome && (
    <KnockOut outcome={bout.outcome} partnerName={partnerName} onRematch={onRematch} onNewPartner={onNewPartner} />
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
          {!fighting && suggest}
        </div>
      )}

      {landscape ? (
        <CombatFrame stick={placed ? stick : undefined} footer={footer}>
          {!placed ? (
            placePrompt
          ) : (
            <>
              {!fighting && suggest && <div className="flex justify-center">{suggest}</div>}
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
              {result}
              {fighting && (
                <div className="rounded-md border border-white/10 bg-background/60 px-2 py-1 backdrop-blur-sm">
                  {health}
                </div>
              )}
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
              {result}
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
                        ? `${partnerName} threw ${moveLabel(lastPartnerMove)}.`
                        : "Squaring up. Hits are real — first to zero loses the round."
                      : "Shadow-boxing: see what each move deals. Fight an opponent to take real damage."}
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

/** What the last exchange dealt, and whether it came off a bar. */
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
        {fighting ? "Squaring up — hits are real." : "Training · shadow-boxing"}
      </div>
    );
  }
  const who = hit.from === "you" ? "You" : (partnerName ?? "Opponent");
  const mine = hit.from === "you";
  return (
    <div
      className={`rounded-md border px-2 py-1 backdrop-blur-sm ${
        mine ? "border-primary/50 bg-primary/10" : "border-destructive/50 bg-destructive/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={mine ? "live" : "bad"}>{hit.combo ? "Combo" : hit.crit ? "Critical" : "Hit"}</Badge>
        <span className="min-w-0 truncate text-[10px] font-medium">
          {who} · {moveLabel(hit.move)}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {hit.applied ? "−" : "would deal "}
          {hit.damage}
          {hit.blocked ? " · guarded" : ""}
          {hit.crit && !hit.combo ? " · crit" : ""}
        </span>
      </div>
    </div>
  );
}

function HealthRow({
  label,
  hp,
  max,
  tone,
}: {
  label: string;
  hp: number;
  max: number;
  tone: "you" | "them";
}) {
  const ratio = Math.max(0, Math.min(1, hp / Math.max(1, max)));
  const colour = ratio > 0.5 ? "bg-emerald-500" : ratio > 0.25 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-1.5" aria-label={`${label} health ${hp} of ${max}`}>
      <span
        className={`w-14 shrink-0 truncate text-[9px] font-semibold uppercase tracking-[0.08em] ${
          tone === "you" ? "text-primary" : "text-sky-300"
        }`}
      >
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-[width] duration-300 ${colour}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted-foreground">
        {Math.ceil(hp)}/{max}
      </span>
    </div>
  );
}

function KnockOut({
  outcome,
  partnerName,
  onRematch,
  onNewPartner,
}: {
  outcome: Exclude<TrainingOutcome, null>;
  partnerName: string | null;
  onRematch: () => void;
  onNewPartner: () => void;
}) {
  const won = outcome === "won";
  return (
    <output
      className={`mb-1.5 block rounded-lg border p-2.5 backdrop-blur ${
        won ? "border-primary/60 bg-primary/15" : "border-destructive/60 bg-destructive/15"
      }`}
    >
      <div className="flex items-center gap-2">
        {won ? <Trophy className="size-4 text-primary" /> : <X className="size-4 text-destructive" />}
        <span className="text-sm font-bold uppercase tracking-wide">
          {won ? `K.O. — ${partnerName ?? "opponent"} is down` : "K.O. — you're down"}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        Training round · no wins, coins or rating change.
      </p>
      <div className="mt-2 flex gap-1.5">
        <Button size="sm" className="h-7 flex-1 text-[11px]" onClick={onRematch}>
          <RotateCcw className="size-3.5" />
          Rematch
        </Button>
        <Button size="sm" variant="outline" className="h-7 flex-1 text-[11px]" onClick={onNewPartner}>
          <RefreshCw className="size-3.5" />
          New opponent
        </Button>
      </div>
    </output>
  );
}
