import * as React from "react";

/**
 * The left-hand stick, in landscape: it walks the character.
 *
 * This replaces the turn stick, which rotated a body that could not move. Now
 * the body moves, so facing follows from what it is doing — it looks where it
 * is walking, and snaps onto its opponent for the length of a swing — and a
 * separate aiming control would only be a second way to say the same thing.
 *
 * What comes out is intent, not a position: a normalised vector where `y` is
 * "away from the camera" and `x` is "to the right of it". The stage turns that
 * into metres per second against the camera's own basis, so pushing away from
 * yourself always walks the character away from yourself, whichever way the
 * phone happens to be held.
 *
 * Pointer events only, so touch, pen and mouse are one path, and the gesture is
 * captured — a thumb sliding off the pad keeps walking instead of dropping the
 * nub. Keyboard parity on WASD and the arrows, because a control that needs a
 * thumb is not a control everyone has.
 */

/** Radius of the travel, in pixels — the nub cannot leave the ring. */
const RADIUS = 34;
/** Keys held right now, so two at once read as a diagonal. */
type Axis = { x: number; y: number };

const KEY_VECTORS: Record<string, Axis> = {
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: 1 },
  s: { x: 0, y: -1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

export function MoveStick({
  onDrive,
  label = "move",
}: {
  /**
   * Movement intent, each axis in -1..1, both zero when the stick is centred.
   * `y` is forward — away from the camera — and `x` is strafe.
   */
  onDrive: (x: number, y: number) => void;
  label?: string;
}) {
  const [nub, setNub] = React.useState({ x: 0, y: 0 });
  const active = React.useRef<number | null>(null);
  const origin = React.useRef({ x: 0, y: 0 });
  const held = React.useRef(new Set<string>());

  const centre = React.useCallback(() => {
    active.current = null;
    held.current.clear();
    setNub({ x: 0, y: 0 });
    onDrive(0, 0);
  }, [onDrive]);

  // A stick that keeps walking the character after the pad unmounts would
  // strand it mid-stride: dropping the component lets go of it.
  React.useEffect(() => () => onDrive(0, 0), [onDrive]);

  const move = (clientX: number, clientY: number) => {
    let dx = clientX - origin.current.x;
    let dy = clientY - origin.current.y;
    const length = Math.hypot(dx, dy);
    if (length > RADIUS) {
      dx = (dx / length) * RADIUS;
      dy = (dy / length) * RADIUS;
    }
    setNub({ x: dx, y: dy });
    // Screen-down is toward the player, which is backwards for the character.
    onDrive(dx / RADIUS, -dy / RADIUS);
  };

  const applyKeys = () => {
    let x = 0;
    let y = 0;
    for (const key of held.current) {
      const vector = KEY_VECTORS[key];
      if (!vector) continue;
      x += vector.x;
      y += vector.y;
    }
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    setNub({ x: x * RADIUS, y: -y * RADIUS });
    onDrive(x, y);
  };

  return (
    <div
      role="application"
      aria-label={`${label} your character`}
      tabIndex={0}
      className="pointer-events-auto relative size-[104px] shrink-0 touch-none select-none rounded-full border border-border bg-background/70 backdrop-blur"
      onPointerDown={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        origin.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        active.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (active.current !== event.pointerId) return;
        move(event.clientX, event.clientY);
      }}
      onPointerUp={centre}
      onPointerCancel={centre}
      onBlur={centre}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === " ") {
          centre();
          return;
        }
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        if (!(key in KEY_VECTORS)) return;
        event.preventDefault();
        held.current.add(key);
        applyKeys();
      }}
      onKeyUp={(event) => {
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        if (!held.current.delete(key)) return;
        applyKeys();
      }}
    >
      {/* The ring's own crosshair, so the centre is visible while dragging. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="size-[72px] rounded-full border border-dashed border-border/70" />
      </div>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 size-9 rounded-full border border-accent/70 bg-accent/25 shadow-sm transition-transform duration-75"
        style={{ transform: `translate(-50%, -50%) translate(${nub.x}px, ${nub.y}px)` }}
      />
      <span className="pointer-events-none absolute bottom-1.5 left-0 right-0 text-center text-[9px] uppercase tracking-[0.14em] text-muted-foreground [text-shadow:0_1px_2px_rgb(0_0_0/0.55)]">
        {label}
      </span>
    </div>
  );
}
