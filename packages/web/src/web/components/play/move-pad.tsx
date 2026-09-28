import { ArrowBigRightDash, PawPrint, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnimationState } from "@/ar/character";
import { MOVE_LABELS } from "../../../api/lib/creature-form";

/**
 * Move buttons.
 *
 * One component for every surface that offers a creature's moves — the
 * Character Lab, the training area and the full-screen battle HUD — because the
 * move list is a single source of truth (`movesForForm`) and three separate
 * renderings of it would drift within a week.
 *
 * What a press *means* is the caller's business: in the lab and in training it
 * plays an animation and nothing else, and in a battle it is the attack the
 * server resolves. What the button says, which moves exist for this body and
 * which are locked is decided here.
 */

export type MoveSet = {
  attacks: readonly AnimationState[];
  defenses: readonly AnimationState[];
  combos: readonly AnimationState[];
};

/**
 * See-through styling for the surfaces that sit over the camera.
 *
 * On top of a live AR scene the pad is competing with the thing the player
 * actually came to look at, so over the camera the buttons keep only as much
 * background as their text needs to stay readable — a thin tint and a blur,
 * not a panel. The text and border are pushed the other way to compensate:
 * white-ish and semi-bold, so a label survives being laid over a bright wall
 * or a dark floor without a solid block behind it.
 *
 * Off the camera — the Character Lab — the normal opaque buttons are correct,
 * because there is nothing behind them worth seeing.
 */
const GLASS_IDLE =
  "border-white/25 bg-background/25 text-foreground/95 backdrop-blur-sm " +
  "[text-shadow:0_1px_2px_rgb(0_0_0/0.55)] hover:bg-background/45";
const GLASS_ACTIVE =
  "border-primary/60 bg-primary/70 text-primary-foreground backdrop-blur-sm hover:bg-primary/80";

/**
 * The few moves that carry a glyph as well as a name.
 *
 * Almost nothing in here does, and that is on purpose: twenty labelled buttons
 * each with a picture on it is a toolbar, not a move pad, and the labels are
 * already the fastest thing to read. What earns a glyph is a move that does
 * something the others do not — the dashes are the only moves that move the
 * body across the ground, and an arrow says that before a label can be read.
 *
 * The solo dash gets the arrow and the claw, because it is the move being
 * introduced and it is both of those things. Its chains get the arrow alone:
 * the family stays recognisable at a glance, and a combo label is long enough
 * already without two glyphs in front of it.
 */
const MOVE_ICONS: Record<string, readonly LucideIcon[]> = {
  dash_strike: [ArrowBigRightDash, PawPrint],
  dash_bite: [ArrowBigRightDash],
  dash_whip: [ArrowBigRightDash],
  dash_slam: [ArrowBigRightDash],
};

/** One row of move buttons, labelled the way the feed labels them. */
export function MoveRow({
  title,
  states,
  active,
  onPlay,
  empty,
  disabled,
  disabledFor,
  emphasise,
  columns,
  glass,
  dense,
}: {
  title: string;
  states: readonly AnimationState[];
  active: AnimationState;
  onPlay: (state: AnimationState) => void;
  empty?: string;
  disabled?: boolean;
  /**
   * Which individual moves cannot be thrown right now, and why not, in a few
   * words for the tooltip.
   *
   * The whole row going dark says "not your turn". One button going dark says
   * something about *that move* — out of reach, too expensive to breathe
   * through — and that is a thing worth knowing before the press rather than
   * after the server refuses it.
   */
  disabledFor?: (state: AnimationState) => string | null;
  /**
   * Which moves are the right answer to what is happening. Used for the
   * defence that covers an incoming blow's kind: a ring around it, because a
   * read has to be made inside a windup and there is no time to remember a
   * table.
   */
  emphasise?: (state: AnimationState) => boolean;
  /** Fixed grid instead of wrapping — what the thumb-sized battle pad wants. */
  columns?: boolean;
  /** Sitting over the camera: translucent buttons instead of solid ones. */
  glass?: boolean;
  /**
   * Beside the stick rather than under it: half the width and a third of the
   * screen to fit every move into, so the gaps and headings lose their slack.
   * The buttons keep their height — that is the thumb target, and it is not
   * what the layout is allowed to spend.
   */
  dense?: boolean;
}) {
  return (
    <div>
      <span
        className={
          "font-semibold uppercase tracking-[0.12em] " +
          (glass
            ? `block text-[8px] ${dense ? "leading-none" : "leading-tight"} text-foreground/70 [text-shadow:0_1px_2px_rgb(0_0_0/0.55)]`
            : "text-[9px] text-muted-foreground")
        }
      >
        {title}
      </span>
      {states.length === 0 ? (
        <p
          className={
            "mt-1 text-[10px] " + (glass ? "text-foreground/60" : "text-muted-foreground/80")
          }
        >
          {empty ?? "This body cannot do any of these."}
        </p>
      ) : (
        // Three to a row rather than two: the labels are short enough for it,
        // and it buys back a third of the height the pad used to take out of
        // the middle of the screen.
        <div
          className={
            columns
              ? (glass
                  ? `mt-0.5 grid grid-cols-3 ${dense ? "gap-0.5" : "gap-1"}`
                  : "mt-1 grid grid-cols-3 gap-1")
              : "mt-1 flex flex-wrap gap-1"
          }
        >
          {states.map((state) => {
            const why = disabledFor?.(state) ?? null;
            const wanted = emphasise?.(state) === true;
            return (
            <Button
              key={state}
              size="sm"
              variant={active === state ? "default" : "outline"}
              title={why ?? undefined}
              className={[
                // Still a thumb target at 28px tall with the gap around it,
                // and the label truncates rather than forcing the row taller.
                // 28px stays 28px in either layout: the row spacing gives way
                // to fit the pad into a third of the screen, the thumb target
                // does not.
                columns ? "h-7 px-1 text-[10px]" : "h-6 px-1.5 text-[10px]",
                // The button variant pads itself out and spaces its children
                // generously the moment it finds an icon inside it. That is
                // right for a toolbar button and wrong for a 28px one in a
                // three-column grid, so both are pulled back to the padding
                // the row was built around.
                columns ? "gap-0.5 has-[>svg]:px-1" : "gap-0.5 has-[>svg]:px-1.5",
                "min-w-0 truncate leading-none",
                glass ? (active === state ? GLASS_ACTIVE : GLASS_IDLE) : "",
                wanted ? "ring-2 ring-accent ring-offset-0" : "",
              ].join(" ")}
              disabled={disabled || why !== null}
              onClick={() => onPlay(state)}
            >
              {/* The glyphs never shrink and never wrap — the label is what
                  gives way, because a truncated name beside an arrow still
                  reads as the dash, and a button that has grown a second line
                  breaks the row height the thumb is aiming at. */}
              {(MOVE_ICONS[state] ?? []).map((Icon, index) => (
                <Icon
                  key={index}
                  aria-hidden
                  className={columns ? "size-3 shrink-0" : "size-2.5 shrink-0"}
                />
              ))}
              <span className="min-w-0 truncate">{moveLabel(state)}</span>
            </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Attacks and combos, with defences optional. The combo row names the booster
 * level it is reading, because "why can I not see any combos" is always that.
 */
export function MovePad({
  moves,
  level,
  active,
  onPlay,
  onGuard,
  disabled,
  guardDisabled,
  disabledFor,
  emphasise,
  showDefences,
  defencesTitle,
  columns,
  glass,
  dense,
}: {
  moves: MoveSet | null;
  level: number;
  active: AnimationState;
  onPlay: (state: AnimationState) => void;
  /**
   * What a defence press means, when it means something different from a move
   * press.
   *
   * In a real fight it does: an attack is a swing the server resolves, and a
   * defence is a read committed against a blow already in the air — two
   * different procedures with two different answers. In the lab and in
   * training every press is just an animation, so this is left off and the
   * defences fall through to `onPlay` like everything else.
   */
  onGuard?: (state: AnimationState) => void;
  disabled?: boolean;
  /** The defence row alone, for when there is nothing in the air to read. */
  guardDisabled?: boolean;
  disabledFor?: (state: AnimationState) => string | null;
  emphasise?: (state: AnimationState) => boolean;
  showDefences?: boolean;
  /** Overrides the defence heading — a live read deserves to be named one. */
  defencesTitle?: string;
  columns?: boolean;
  /** Over the camera: translucent buttons, tighter rows, shorter headings. */
  glass?: boolean;
  /** Squeezed in beside the stick: 24px rows and hairline gaps. */
  dense?: boolean;
}) {
  return (
    <div className={glass ? (dense ? "space-y-0.5" : "space-y-1") : "space-y-2.5"}>
      <MoveRow
        title="Attacks"
        states={moves?.attacks ?? []}
        active={active}
        onPlay={onPlay}
        disabled={disabled}
        disabledFor={disabledFor}
        columns={columns}
        glass={glass}
        dense={dense}
        empty="No character on the stage yet."
      />
      {showDefences && (
        <MoveRow
          title={defencesTitle ?? "Defences"}
          states={moves?.defenses ?? []}
          active={active}
          onPlay={onGuard ?? onPlay}
          // A guard answers a blow rather than opening one, so it is not held
          // behind the attack cooldown — only behind its own.
          disabled={onGuard ? guardDisabled : disabled}
          disabledFor={disabledFor}
          emphasise={emphasise}
          columns={columns}
          glass={glass}
          dense={dense}
        />
      )}
      <MoveRow
        // Over the camera the row is named for what it holds and nothing else.
        // The booster level belongs on it — "why can I not see any combos" is
        // always that — but not at the cost of a heading that wraps to two
        // lines across a scene the player is trying to look at.
        title={glass ? `Combinations · lv ${level}` : `Combinations — booster lv ${level}`}
        states={moves?.combos ?? []}
        active={active}
        onPlay={onPlay}
        disabled={disabled}
        disabledFor={disabledFor}
        columns={columns}
        glass={glass}
        dense={dense}
        empty={
          glass
            ? "None unlocked at this booster level."
            : "No combinations unlocked for this body at this booster level."
        }
      />
    </div>
  );
}

export function moveLabel(state: string): string {
  return MOVE_LABELS[state as keyof typeof MOVE_LABELS] ?? state;
}
