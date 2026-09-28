import * as React from "react";
import type { ARStage } from "@/ar/stage";
import { useSpeakAvatar } from "@/queries/play";
import type { SpeechContext } from "../../api/ai/speech";

/**
 * The avatar's voice.
 *
 * Lines are written server-side (`avatars.speak`, which knows the character's
 * personality); this hook decides *when* it is worth asking for one and pushes
 * the answer into the scene. That split matters because the triggers are
 * things that fire constantly in the field — a spawn drifting in and out of
 * range, damage events arriving in bursts, a safety verdict re-polled every
 * four seconds — and the server call costs a model round trip.
 *
 * So three gates, all client-side and all cheap:
 *   • one line at a time (`inflight`), so a burst produces one request;
 *   • a per-context cooldown, so the same observation is not narrated twice;
 *   • a floor between any two lines, which urgent contexts may jump.
 *
 * The server has its own throttle on top (and falls back to a hand-written
 * bank instead of calling the model when it trips), so the worst case here is
 * a line that does not appear — never a stalled frame or a runaway bill.
 */

export type { SpeechContext };

/** Minimum gap between any two lines. Urgent contexts ignore it. */
const FLOOR_MS = 4_000;

/** How long before the same observation is worth narrating again. */
const COOLDOWN_MS: Record<SpeechContext, number> = {
  booster_found: 25_000,
  booster_pickup: 6_000,
  battle_start: 20_000,
  victory: 10_000,
  hazard_warning: 30_000,
  idle: 75_000,
};

/** Above `URGENT_FROM` a line skips the floor: safety and winning cannot wait. */
const PRIORITY: Record<SpeechContext, number> = {
  idle: 0,
  booster_found: 1,
  booster_pickup: 2,
  battle_start: 2,
  victory: 3,
  hazard_warning: 4,
};
const URGENT_FROM = 3;

export type AvatarVoice = {
  /** Ask for a line. Silently dropped when a gate says now is not the time. */
  say: (context: SpeechContext, detail?: string) => void;
};

export function useAvatarVoice(stage: ARStage | null, avatarId: string | null): AvatarVoice {
  const speak = useSpeakAvatar();

  const speakRef = React.useRef(speak.mutateAsync);
  speakRef.current = speak.mutateAsync;
  const stageRef = React.useRef(stage);
  stageRef.current = stage;
  const avatarRef = React.useRef(avatarId);
  avatarRef.current = avatarId;

  const lastAt = React.useRef<Partial<Record<SpeechContext, number>>>({});
  const lastAnyAt = React.useRef(0);
  const inflight = React.useRef(false);

  // A different character is a different voice: it should not inherit the
  // cooldowns of the one the player just swapped out.
  React.useEffect(() => {
    lastAt.current = {};
    lastAnyAt.current = 0;
  }, [avatarId]);

  const say = React.useCallback((context: SpeechContext, detail?: string) => {
    const avatar = avatarRef.current;
    const target = stageRef.current;
    if (!avatar || !target || inflight.current) return;

    const now = Date.now();
    const urgent = PRIORITY[context] >= URGENT_FROM;
    if (!urgent && now - lastAnyAt.current < FLOOR_MS) return;
    if (now - (lastAt.current[context] ?? 0) < COOLDOWN_MS[context]) return;

    // Claim the slot before awaiting: the point of the gates is to survive a
    // burst, and a burst lands well inside one round trip.
    lastAt.current[context] = now;
    lastAnyAt.current = now;
    inflight.current = true;

    void speakRef
      .current({ avatarId: avatar, context, ...(detail ? { detail } : {}) })
      .then((result) => {
        // The character may have been swapped or the stage torn down mid-flight.
        if (avatarRef.current === avatar) stageRef.current?.sayCharacterLine(result.line);
      })
      .catch(() => {
        // Flavour text. A failure means the bubble stays empty, nothing more —
        // but let the next trigger try again rather than sitting out the
        // cooldown on a line that was never spoken.
        lastAt.current[context] = 0;
      })
      .finally(() => {
        inflight.current = false;
      });
  }, []);

  // Stable, so callers can put it straight in an effect's dependency list.
  return React.useMemo(() => ({ say }), [say]);
}
