# GeoFights — Combat System Upgrade: Plan

Scoped against the code as it stands today. No new REST routes, no new oRPC procedures — **every one of the ten items is client-side**. Confirmed by reading `src/api/routes/battle.ts`: the only server surface involved is `battle.attack`, `battle.useAbility`, `battle.updatePosition` and the feed, all already wired.

---

## What already exists (so we don't rebuild it)

| You asked for | Status today |
|---|---|
| Move vocabulary (Swipe, Bite, Tail Whip, Wing Gust, Spike Burst, Charge, Ground Slam, Elemental Burst) | **All 8 exist** as server move IDs in `creature-form.ts`, gated per body shape |
| Defensive moves (Shell Guard, Wing Shield, Parry, Absorb, Counter Stance, Dodge) | **All 6 exist** |
| Combined moves (Swipe→Bite, Charge→Slam, Gust→Spike, Dodge→Counter, Absorb→Burst) | **All 5 exist** as `COMBO_MOVES`, already built by chaining two existing curves on split time shares |
| Training damage calculated but not applied, "Training Hit" feedback | **Done.** `scoreTrainingHit` runs the real `computeDamage`, writes no health, bar is pinned full, badge reads "Training Hit / Training Combo" |
| Full-screen battle (chrome hidden, pad right, pull-handle) | **Done.** `fullscreenBattle` + `chromeHidden` + `RevealHandle` |
| Landscape: stick left, moves right, characters centred | **Done.** `CombatFrame` already lays out exactly those three zones, shared by training and battle |
| Bot attacks on a timer, reacts, player answers with a defence | **Done**, at 3–5s |
| Shockwave ring for slams/bursts | **Done.** `shock` channel + `shockRing` mesh already wired |
| Facing lock-on | **Mostly done.** `faceCombatants()` already points both bodies at each other and is re-applied after layout |
| Sound cues | 6 collapsed cues exist (`attack`, `hit`, `combo`, `training`, `guard`, `reaction`); you named 12 |

So the real work is: **the joystick, facing modes, richer move animation, bot polish, and sound granularity.**

---

## One design conflict to settle first

`turn-stick.tsx` carries an explicit statement in its own comments:

> *"It does not move the player. GeoFights is played standing still — the engine pauses combat above walking pace — so a locomotion stick would be a control that lies about what the game does."*

I traced that pause: `combatPaused` comes from **real-world GPS speed** (`movement.paused`, plus `TRAINING_MAX_SPEED_MPS = 1.2`). It's an anti-cheat/safety rule about the *phone* moving, not the character. So a virtual joystick that slides the character around the AR room does **not** trip it, and the two can coexist honestly.

But it leaves a UX question: the landscape frame has **one** stick slot, currently the turn stick (facing, ±120°, snaps back to squared-up).

**My recommendation:** keep one stick in the left slot and make it the **movement joystick**; fold turning into the facing logic (character faces where it walks, snaps to the enemy when it attacks), which is what item 1 and 2 describe anyway. The manual turn stick becomes redundant — its whole job was aiming a body that couldn't move. `aimYaw` stays in the stage as an offset so nothing else breaks.

Alternative if you want it: two sticks, movement bottom-left, turn above it. Cramped on a phone in landscape. Say the word and I'll do it.

---

## Build plan

### Phase 1 — Movement + facing (items 1, 2)

**`src/web/components/play/move-stick.tsx`** (new) — 2-axis thumbstick, same pointer-events/keyboard pattern as `turn-stick.tsx` (WASD + arrows for parity), reports a normalised `{x, y}` vector at up to ~60Hz, recentres on release.

**`stage.ts`** — new `setCharacterDrive(x, y)` (stores intent, no work) and a movement step inside the existing `tick()`:
- Translate `character.group.position` — **not** `rig`. Animation drives `rig`; moving `group` keeps the ground ring, health bar and speech bubble planted under the feet and lets combat animation keep working untouched.
- Camera-relative basis: stick-forward is away from the camera, so strafe reads correctly wherever the player is standing.
- `MOVE_SPEED_MPS = 1.1`, eased in/out, clamped to a radius around the placement anchor (`ROAM_RADIUS_M ≈ 2.5`) so the character can't walk out of frame or through the enemy. No physics, no collisions. Enemy stays anchored.
- `place()` and the framing constants (`FALLBACK_DISTANCE_M`, `RESTING_PITCH`, `SPAR_SIDE_M`) are not touched.

**Facing becomes a mode**, which is the part that genuinely doesn't exist yet:
- Walking → face the movement heading (smoothed, not snapped).
- Attack/defence/combo fires → snap to the opponent for the duration of the animation, then release back.
- Idle with an opponent present → lock on, i.e. today's `faceCombatants()`.
- Implemented as a small facing state inside `ARStage` so `faceCombatants()` stays the single writer of `rotation.y`.
- `facingProbe()` gains `drive` + `facingMode` + position, so the regression scripts can assert on movement without pixel diffs.

Two-player: both characters already get their own body and `faceCombatants()` already points them at each other. The local player drives their own; the remote one stays where `layoutSparring` seats it and re-centres when both are idle. **Note:** remote position is not synced — the opponent won't see you walk. Syncing it would need a new procedure or a payload change on `battle.updatePosition`, which your constraint rules out. Flagging rather than assuming.

### Phase 2 — Richer move animation (items 3, 4, 5)

All inside `character.ts`, all in the existing `MoveCurve`/`Channels` system. No new move IDs, no server change, no pad change.

- **Swipe+**: wind-up lean → arc across the body → follow-through overshoot → recovery.
- **Bite+**: head lunge → jaw snap (`headPush` drives `jaw.rotation.x` already) → recoil → `glowFlash` pulse on impact.
- **Tail Whip+**: segmented sweep — `tailSegments` already lag per index, so this is curve shaping plus a body counter-rotation and a `shock` scuff at the tip.
- **Wing Gust+**: double flap, downdraft crouch, forward push.
- **Spike Burst+**: spikes retract → flare → expanding ring.
- **Charge+**: crouch → dash forward on `push` → impact stop → dust ring.
- **Ground Slam+**: rear up → drop → `shock` shockwave → tremor settle.
- **Elemental Burst+**: charge glow → release flash → aura falloff via `glowDrain`.
- **Defences+**: Shell Guard+ (tuck, brace, shrug-off), Wing Shield+ (wrap, absorb flex, unfurl), Parry+ (deflect arc, counter-lean), Absorb+ (draw-in glow, pulse out), Counter Stance+ (coil, snap back).
- **Combos**: keep the existing two-part chaining but add a proper connective beat — the second half starts from the first's follow-through pose instead of from neutral, plus one impact accent on the seam.
- Likely needs 2–3 new channels (e.g. `dust`, `aura`) and a small aura/dust mesh in `mesh-blocks.ts`. Still procedural, still no GLTF.
- `DURATION` entries lengthen for the multi-beat moves; `PRIORITY` unchanged.

### Phase 3 — Bot upgrade (item 7)

In the existing timer in `play.tsx`:
- Interval 3–5s → **2–4s**.
- Occasional combo throw (weighted, from the bot's own `movesForForm` combos, so it can't throw a move its body doesn't have).
- Reacts to the player's hits: `hit_react` plus a glow pulse, a tail flick, and a wing twitch when the body has wings.
- Faces the player through the same facing logic, re-applied after each of its own animations.

### Phase 4 — Sound (item 10)

`sfx.ts` grows from 6 cues to the 12 you named: `swipe`, `bite`, `tail_whip`, `slam`, `gust`, `spike_burst`, `combo_impact`, `dodge`, `counter`, `training_hit`, `bot_growl`, `aura_pulse`. Still synthesised oscillators, no audio files, still fire-and-forget through `playCue` so it keeps recording to `window.__cues` in dev for the regression checks. `cueForMove()` gains a per-move branch table and keeps its old cues as fallbacks for anything unmapped.

### Phase 5 — Full-screen + landscape (items 8, 9)

Small, since the skeleton exists: swap the stick slot to the joystick in both `TrainingMode` and `BattlePad`, verify the middle of the frame stays clear at phone landscape sizes with both characters in it, and confirm the pull-handle still reaches the full HUD from both modes.

### Phase 6 — Verify

Keep the ten existing scripts in `/home/user/tmpcheck/` green, plus new ones for: joystick translation and roam clamp (via `facingProbe`), facing-mode switching during walk vs. attack, landscape three-zone layout at full-screen, and the new cues via `window.__cues`. Then `bun run typecheck` and `bun run build`.

---

## Decisions I need from you

1. **One stick or two?** My recommendation: one, the movement joystick, with facing automatic. Alternative: keep the turn stick too.
2. **Remote position sync** — leave the opponent's walk unsynced (visual only, local), or should I raise changing `battle.updatePosition`'s payload with you as an exception to the no-new-API rule?
3. **Roam radius** — 2.5 m around the placement anchor feels right for AR framing. Larger if you want the fight to move around more.
