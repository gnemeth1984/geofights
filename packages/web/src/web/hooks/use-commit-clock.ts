import * as React from "react";

/**
 * The clock a fight is actually played on.
 *
 * Two jobs, and they are the same job seen from either end of a press.
 *
 * **When this body is free again.** The server stamps `recoverUntil` the
 * instant an attack commits and refuses *everything* until it passes — a guard
 * included. The client cannot learn that from the poll in time for it to be
 * any use: `myState` answers every two seconds, and the attack request itself
 * is held open for the length of its own windup, so by the time either of them
 * speaks, the window where the player was pressing a dead button has already
 * gone by. So the deadline is kept here, from the press, off the same profile
 * table the engine charges against. The poll is still read as a floor — a
 * parry adds a stagger the client never sees coming, and a landed hit cancels
 * the recovery early — and whichever is later wins.
 *
 * **Presses that arrive on the beat.** A player on rhythm presses *into* the
 * end of their own recovery rather than after it, because that is what
 * pressing on a beat feels like. Throwing those presses away is the single
 * loudest way a fight reads as unresponsive: the player pressed, nothing
 * happened, and nothing on screen said why. So the last stretch of every
 * recovery is live, and a press inside it is held rather than refused.
 */

/**
 * How early a press may land and still be honoured.
 *
 * Long enough to catch a press aimed at the beat, short enough that it can
 * never queue a move the player has changed their mind about: past this the
 * press is early, not late, and early presses are still dropped.
 */
export const INPUT_BUFFER_MS = 160;

export type CommitClock = {
  /** When anything at all may be thrown again — the recovery deadline. */
  readyAt: number;
  /** When the next swing may leave. */
  attackReadyAt: number;
  /** How much of the recovery is left, for the rows that grey on it. */
  recoverInMs: number;
  /** The same, for the attack row. */
  attackReadyInMs: number;
  /** What the local deadline currently says, for a press that wants to keep it. */
  commitUntil: number;
  /** Hold this body until a moment, or hand a deadline back after a refusal. */
  setCommitUntil: React.Dispatch<React.SetStateAction<number>>;
  /**
   * Throw this the moment the body allows it.
   *
   * Free now: straight through, which is every press that is not on the beat.
   * Inside the buffer window: held and thrown at the deadline. Earlier than
   * that: dropped, because a press that far ahead of the beat is the player
   * mashing, and honouring it would throw a move they had already stopped
   * meaning to throw.
   */
  onBeat: (readyAgainAt: number, throwIt: () => void) => void;
};

export function useCommitClock({
  polledReadyInMs,
  polledAttackReadyInMs,
  polledAt,
}: {
  /** `myState.readyInMs`, as the last poll reported it. */
  polledReadyInMs: number | null;
  /** `myState.attackReadyInMs`, likewise. */
  polledAttackReadyInMs: number | null;
  /** When that poll answered — `dataUpdatedAt`. */
  polledAt: number;
}): CommitClock {
  const [commitUntil, setCommitUntil] = React.useState(0);
  const [, tick] = React.useReducer((n: number) => n + 1, 0);

  /** What the server last said, as a moment rather than a countdown. */
  const polledReadyAt = polledReadyInMs == null ? 0 : polledAt + polledReadyInMs;
  const readyAt = Math.max(commitUntil, polledReadyAt);
  /**
   * When the next *swing* may leave. The same deadline the defence row reads,
   * and deliberately so: the engine gates every action on the one recovery and
   * charges no separate cooldown between attacks, so anything extra here would
   * be the pad refusing a press the server would have taken.
   */
  const polledAttackReadyAt = polledAttackReadyInMs == null ? 0 : polledAt + polledAttackReadyInMs;
  const attackReadyAt = Math.max(readyAt, polledAttackReadyAt);

  /**
   * Re-render on the next moment that changes what the pad may do: either
   * deadline landing, or the buffer window in front of it opening. So the rows
   * come back up with the animation instead of waiting for a poll to notice.
   */
  React.useEffect(() => {
    const now = Date.now();
    const next = [
      readyAt - INPUT_BUFFER_MS,
      readyAt,
      attackReadyAt - INPUT_BUFFER_MS,
      attackReadyAt,
    ]
      .filter((at) => at > now)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = window.setTimeout(tick, next - now + 30);
    return () => window.clearTimeout(timer);
  }, [readyAt, attackReadyAt]);

  /**
   * The press being held until the body is free, if there is one.
   *
   * A ref rather than state: it is written from inside a click and read from
   * inside a timer, and nothing on screen is drawn from it — the pad already
   * shows itself live for the window the press is caught in, so a re-render
   * would buy nothing but a frame of work.
   */
  const buffered = React.useRef<(() => void) | null>(null);
  const bufferTimer = React.useRef<number | null>(null);

  const onBeat = React.useCallback((readyAgainAt: number, throwIt: () => void) => {
    const left = readyAgainAt - Date.now();
    if (left <= 0) {
      throwIt();
      return;
    }
    if (left > INPUT_BUFFER_MS) return;
    buffered.current = throwIt;
    if (bufferTimer.current !== null) window.clearTimeout(bufferTimer.current);
    bufferTimer.current = window.setTimeout(() => {
      bufferTimer.current = null;
      const held = buffered.current;
      buffered.current = null;
      held?.();
    }, left);
  }, []);

  // A press held across a change of scene is a press into a fight that is no
  // longer there, so the hold dies with the page.
  React.useEffect(
    () => () => {
      if (bufferTimer.current !== null) window.clearTimeout(bufferTimer.current);
      buffered.current = null;
    },
    [],
  );

  const now = Date.now();
  return {
    readyAt,
    attackReadyAt,
    recoverInMs: Math.max(0, readyAt - now),
    attackReadyInMs: Math.max(0, attackReadyAt - now),
    commitUntil,
    setCommitUntil,
    onBeat,
  };
}
