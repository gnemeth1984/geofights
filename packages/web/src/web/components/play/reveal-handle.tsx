import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The handle that hides and reveals the chrome in full-screen modes.
 *
 * A battle is watched, not read: the scene needs the whole screen and the HUD
 * needs to be one gesture away rather than permanently in front of it. So the
 * full UI lives behind a pull — drag up to bring it back, drag down to send it
 * away — with a tap doing the same thing for anyone who does not discover the
 * drag, and a real `<button>` underneath so it is reachable by keyboard.
 *
 * The gesture is deliberately handled here and not on the canvas: the canvas
 * owns drag-to-look, and stealing vertical drags from it would break aiming.
 */

/** Past this many pixels a vertical drag is a pull, below it a tap. */
const PULL_PX = 36;
const TAP_PX = 10;

export function RevealHandle({
  revealed,
  onChange,
  label,
}: {
  revealed: boolean;
  onChange: (revealed: boolean) => void;
  /** What the pull brings up, e.g. "battle HUD". */
  label: string;
}) {
  const startY = React.useRef<number | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    startY.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const from = startY.current;
    startY.current = null;
    if (from == null) return;
    const dy = event.clientY - from;
    if (Math.abs(dy) <= TAP_PX) {
      onChange(!revealed);
      return;
    }
    if (dy <= -PULL_PX) onChange(true);
    else if (dy >= PULL_PX) onChange(false);
  };

  return (
    <div className="pointer-events-none flex justify-center">
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          startY.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") onChange(true);
          if (event.key === "ArrowDown") onChange(false);
        }}
        aria-label={revealed ? `Hide the ${label}` : `Pull up for the ${label}`}
        className={cn(
          "pointer-events-auto flex touch-none select-none flex-col items-center gap-1 rounded-t-xl px-6 py-2",
          "border border-b-0 border-border bg-background/80 text-[10px] font-semibold uppercase",
          "tracking-[0.14em] text-muted-foreground backdrop-blur transition-colors hover:text-foreground",
        )}
      >
        <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/50" />
        <span className="inline-flex items-center gap-1">
          {revealed ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
          {revealed ? "pull down to hide" : `pull up for ${label}`}
        </span>
      </button>
    </div>
  );
}
