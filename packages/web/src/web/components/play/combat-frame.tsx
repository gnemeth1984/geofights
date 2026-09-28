import type * as React from "react";

/**
 * The landscape combat layout, shared by the training area and the battle pad.
 *
 * Turned sideways a phone is held in two hands, and the controls have to be
 * where the thumbs already are: the turn stick pinned bottom-left, the moves
 * stacked bottom-right, and the whole middle of the frame left empty so the
 * two characters squared up in it are actually visible. That is the entire
 * point of the rotation — a portrait pad eats the bottom third of the screen,
 * which is exactly where the fight is standing.
 *
 * It renders no controls of its own. Both modes hand it the same shared move
 * pad they use in portrait, so there is one move list, one set of buttons and
 * one place a move can come from, in either orientation.
 */

export function CombatFrame({
  stick,
  children,
  footer,
}: {
  /** The left-hand stick. Omitted, the left column collapses. */
  stick?: React.ReactNode;
  /** The right-hand column: the move pad and whatever labels it needs. */
  children: React.ReactNode;
  /** Sits under the right column — the pull handle goes here. */
  footer?: React.ReactNode;
}) {
  return (
    <div className="pointer-events-none flex flex-1 items-end justify-between gap-3">
      {stick ? <div className="flex flex-col items-center pb-4">{stick}</div> : <div aria-hidden />}
      <div className="pointer-events-auto flex max-h-full w-[min(56%,26rem)] flex-col gap-1.5">
        {children}
        {footer}
      </div>
    </div>
  );
}
