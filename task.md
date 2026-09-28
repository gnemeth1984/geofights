# Character look pass — chibi armour

Goal: GeoFights characters read as the two reference figures — big rounded head
(~40% of height), small torso, short stubby limbs, wide stance, glossy
hard-surface armour with panel seams and glowing trim lines. Fully procedural,
zero downloads (no GLTF/GLB, ever), 60fps on a mid-range phone, applies to
every existing character.

## Decisions
- Chibi proportions apply to **every** character, including the serpentine,
  insectoid and orb body shapes — each shape is adapted to the proportions, none
  is dropped.
- **Hybrid surface**: armour plates are worn *over* the themed skin (scale, hide,
  fur, chitin, facets all stay). A dragon is scaled *under* armour, not replaced
  by it.
- Glow trim on every character, in that character's own accent colour — not one
  uniform colour across the roster.
- Say "character", never "robot".

## Constraint that shapes everything
`character.ts`'s update pass writes `position`/`rotation`/`scale` onto individual
`Object3D`s (segments, legs, arms, headGroup, wings, tailPivot, spikes). A
`THREE.Bone` IS an `Object3D`, so bones and pivots are driven by the same channel
code — every existing channel, curve and move keeps working, dash_strike
included. No animation rewrite, no move retuning.

## Done
- [x] Lighting rig (`lighting.ts`): PCFSoft shadow map, three-point key/fill/rim,
      ACES filmic tone mapping, shadow-catcher ground.
- [x] Procedural materials (`skin.ts`): canvas-generated normal/roughness/AO per
      theme (hide, scale, fur, carapace, crystal, feather, panel). Generated in
      code, cached by key, shared between characters.
- [x] Anatomy (`anatomy.ts`): neck, shoulder/hip masses, two-segment limbs with
      knee/elbow joints, spine curve — driven by the existing channels.
- [x] Armour shell (`shell.ts`): plates as bevelled ellipsoid patches with rolled
      edges, trim as tubes traced over the surface, merged to two meshes per part.
- [x] Chibi proportions: head ratio table, wide stance, near-cylindrical stubby
      limbs (`LEG_TAPER`/`ARM_TAPER`), torso width floored against the head radius
      so a big head never sits on a lollipop body.
- [x] Helmet fit: sized and centred on the cranium — the block head's bulkiest
      piece — off width and height only, so a snout no longer throws it off.
- [x] Plate and trim colour: plate is the body colour pulled a quarter toward the
      accent and held inside a lightness band; trim runs off the accent (not the
      near-white glow tint), floored so a low-glow theme still reads as lit and
      capped so it never clips back to white.
- [x] Rounded torso (`armorTorso`) and rounded chin, replacing the box crate and
      the box chin that read as a crate and a sticker.
- [x] Environment map: `RoomEnvironment` prefiltered once into a 256px PMREM and
      assigned to the scene at 0.42 intensity, with the hemisphere bed pulled down
      to compensate. This is what makes a plate read as lacquered armour instead
      of matte vinyl, and what stops a dark shell reading as a flat black hole.
- [x] Verify: typecheck, `skin-shot.py` across all six themes (no shader errors),
      `dash-check.py` (dash, combos, facing, cues all pass), draw cost probe.

## Cost, level 5 (heaviest loadout), from `cost-probe.ts`
| theme | meshes | triangles |
| --- | --- | --- |
| dragon | 105 | 14.9k |
| insect | 85 | 15.9k |
| beast | 55 | 11.0k |
| construct | 46 | 9.9k |
| bird | 43 | 8.5k |
| elemental | 39 | 6.7k |

Triangles are nowhere near a budget. Draw calls are the metric to watch: two
dragons in one fight is ~210 meshes a frame, which is the high end of what a
mid-range phone wants. Merging the per-part plate meshes further is the lever if
it ever needs pulling.

## Open
- [ ] Limbs on the four-legged themes still read as a stack of beads at the
      joints more than a moulded segment.
- [ ] Cheek plates cut a straight bottom edge across the jaw; a follow of the
      jawline would read better.
- [ ] Real on-device FPS pass (the sandbox renders in software, so its frame
      times say nothing about a phone).

---

# Movement pass — moves that flow out of each other

Goal: motion that reads athletic instead of stiff, where one move hands its
momentum to the next — a jump flows into a flip — and where how grounded a
character is follows from its body: a winged serpent flips, a six-legged insect
stays low.

## Constraint that shapes everything
**Every move's duration stays exactly as it is.** The `DURATION` table in
`character.ts` is not touched — only *how* a body moves through its window, never
how long the window is. `dash-check.py`'s timing assertions are the guard.

## Done
- [x] `tumble` channel: free, unbounded pitch for whole-body flips, kept separate
      from the bounded `lean` weight-shift channel so a flip cannot fight a lean.
- [x] Ballistic primitives: `ballistic`/`ballisticVelocity` (parabolic height plus
      signed vertical speed) and `leap()`, which writes a whole jump — load,
      lift, squash/stretch *derived from the vertical velocity*, optional full
      rotations, dust on both the load and the landing.
- [x] Agility from body shape: `SHAPE_AGILITY` per shape (lithe 1.0, serpentine
      0.86, upright 0.68, orb 0.42, bulky 0.24, insectoid 0.14), plus a wing
      bonus and a heavy penalty, resolved once per character and passed into
      every curve.
- [x] Curves **blend** on agility rather than switching: `celebrate`,
      `dash_strike`, `ground_slam`, `dodge` and `counter_stance` scale their
      grounded motion down and fade a `leap()` in as agility rises.
- [x] Momentum carry across a combo seam: pose channels are crossfaded and the
      outgoing velocity (finite difference at the seam) is carried in as a
      decaying term, so the second half of a combo inherits the first half's
      motion. Effect/progress channels (`shock`, `aura`, `dust`, `glowFlash`,
      `glowDrain`) are `max`'d instead of crossfaded, so an expanding ring can
      never run backwards.
- [x] Residual pose carry on a state change: the live pose is snapshotted every
      frame after the springs, and leaving any non-idle state hands that pose to
      the residual so the next state starts from where the body actually was, not
      from rest.
- [x] Secondary motion: per-limb under-damped springs (`TRAIL_TUNING`) on arms,
      head, wings, tail and spikes so parts overshoot and settle instead of
      snapping; a separate slower spring makes the head lag the body's lean. Fixed
      1/240s integration, capped step count, NaN/Infinity guarded.
- [x] Consumers wired to the new state: head reads the trailing lean, leg stride
      scales with `1 - airborne` and tucks in the air, the rig's pitch is
      `lean + tumble`, and the ground ring shrinks and fades while airborne.
- [x] Verify: typecheck, build, `dash-check.py` 26/26 three runs in a row,
      `skin-shot.py`, `part-probe`, `head-probe`, `cost-probe`, `glow-probe`,
      `proportion-probe`.
- [x] Verify motion specifically: `motion-probe.ts` (agility gating is real —
      serpent and cat peak at ~360 degrees of pitch on dodge/slam/celebrate,
      heavy beast and six-leg insect stay at 90 and never leave the floor; cost
      4.3-5.6 us a frame) and `motion-shot.py` (films a move as a strip of frames
      on a pinned render clock — the flips, the airborne ring shrink, the squash
      on landing and the monotonic slam ring all read correctly).

## Combat realism pass
Visual only, top to bottom: none of it decides an outcome. `blocked`, and for a
real match whether there was contact at all, arrive from the server already
settled — `registerImpact`'s `resolved` flag is what says so, and range is only
allowed to shape a hit that was already decided, never to overrule it. Training
has no server in the loop, so there a swing from too far away does find air.

- [x] Contact on the blow, not on a timer: per-move strike frames
      (`STRIKE_BEATS`/`strikeFrames`) fire the impact on the frame the move
      actually lands, and `strikeWeight` gives every move a weight everything
      below scales off.
- [x] Hitstop: both bodies freeze, scaled by that weight and cut short on a
      block. The freeze costs *movement* time, not a frame — a 45ms hold takes
      45ms off the step even on a 250ms frame, so nothing teleports when it
      lifts. The camera is the one thing that keeps moving through it.
- [x] Directional reactions and knockback: the struck body reels away from the
      bearing the blow arrived on, in its own local axes, and gives ground in
      room space. A blow landed mid-dash gives less (`KNOCKBACK_DASH_SCALE`), or
      the shove fights the lunge that threw it.
- [x] Camera impact kick and shake, scaled to the hit and harder for a blow
      taken than one dealt; direction deliberately arbitrary per hit, because
      the camera is a held phone and not a body in the fight.
- [x] Turning instead of snapping: facing eases onto the opponent over time, and
      only while something is asking it to change — easing every frame would
      have the body swivelling after the camera as the player pans.
- [x] Opponent footwork: `advance`/`retreat`/`circle`/`hold`, committed to for a
      beat at a time, bounded by a leash around the seat it was placed on, held
      still while a strike is mid-flight, and walked back to that seat once the
      exchange goes quiet.
- [x] Blocked reads differently from landed: guard spark and a shove against
      flinch and a flash, not just a different sound.
- [x] Range matters: `REACH_M` per move, measured past the close guard with a
      little forgiveness, and a whiff makes the body carry through and recover.
      Reaches are floored at 0.38 m so no move can miss from the distance the
      game itself seats a sparring pair at.
- [x] Dash phase is wall clock less the freeze it lived through, and each frame
      is charged for the *slice of the run it spanned* rather than for its own
      length. Sampling the phase once a frame dropped whole lunges on a slow
      renderer: the closing window is a few hundred ms and a frame can be
      longer than that, so the dash covered no ground at all.
- [x] Verify: typecheck clean; `dash-check.py` all 30 green twice in a row,
      `move-check.py`, `fight-check.py`, `sfx-check.py` all green;
      `authority-check.py` (new) drives the bodies out past every reach and
      confirms a `resolved` hit still lands at any distance while an undecided
      one whiffs out there and lands once it is in range.
- [x] Checks that read a single instant were the flaky ones, not the product:
      `move-check.py`'s hand-back to idle facing and `fight-check.py`'s re-face
      and bot-attack reads now poll, and `move-check.py` asserts the opponent
      stays on its leash and comes home rather than that it never moves.

## Landing recovery by weight
- [x] `heftFactor(agility)` — the other end of `airFactor`: ramps 1 to 0 as
      agility falls below 0.6, so the bodies that never leave the floor are
      exactly the ones that land hardest (insectoid 1.00, bulky 0.80, orb 0.40,
      upright/serpentine/lithe 0.00).
- [x] `leap()` takes a `heft` and spends it on the absorb, not on the clock: the
      landing beat's window stretches by `0.18 * (1 + heft * 1.7)` and touchdown
      is pulled *earlier* by `heft * 0.16` of the flight, so the extra
      knee-bend time comes out of the air the body was going to spend anyway.
      The move's own window is untouched and the beat's bias never moves with
      heft — lowering bias drags crest and release together, which made a heavy
      body release sooner on any landing already clamped to the window's end.
- [x] Heft only goes to the landing that *ends* the movement. `celebrate`'s first
      bounce is a rebound that becomes the next takeoff, so it stays at heft 0:
      stretching it crumpled the body mid-air, and deepening both landings
      stacked their squash into one channel and flattened the rig.
- [x] Only the landing term deepens (`landing * (0.3 + heft * 0.12)`); the crouch
      load does not, and dust scales on the landing alone. Constants came out of
      a sweep, not a guess — anything more put summed squash past the shipped
      envelope.
- [x] Verify: `DURATION` byte-identical before and after; typecheck clean;
      `dash-check.py`, `move-check.py`, `fight-check.py`, `sfx-check.py` all
      green. `heft_model.py` ports `beat`/`ballistic`/`leap` to Python and
      `heft-curve.py` asserts on it: heft 0 reproduces the shipped curve to
      1e-12 and never moves touchdown, ground time and sink depth are monotonic
      in heft, the absorb never runs past the move's end, nothing is still
      absorbing once `celebrate`'s second jump is airborne, summed squash never
      exceeds the shipped peak, and lift never goes through the floor.
- [x] Verify visually: `heft-shot.py` films `celebrate` on a pinned clock for a
      heavy insectoid against a light serpent — the heavy body touches down
      ~0.79 phase, holds its deepest bend through 0.84 and rises to standing by
      1.00, where the light body is already standing throughout. Note the four
      agility-gated `leap()` sites (`air > 0.05`) never fire for a heavy body,
      so `celebrate` is the only move where this reads.

## Test note
The sandbox renders at ~4fps in software (`fps-probe.py`), so any assertion that
samples state at one fixed offset into a move is a coin flip. `dash-check.py`
polls for extremes over a window instead, and `motion-shot.py` pins
`performance.now` so it can request an exact phase of a move regardless of the
real frame rate. Neither is a workaround for an animation bug — `chain-probe.py`
confirmed the dashes fire correctly and throw nothing.

## Open
- [ ] Real on-device feel pass. Software rendering can show the poses but not
      whether the springs feel right at 60fps on a phone.

## Rules
- Every existing avatar must still build (form comes from the modelId hash for
  ones minted before block sets existed).
- Move durations are fixed. Change the path through the window, never its length.
- Existing move curves must not need retuning.
- Perf: one shadow map, no post-processing chain, textures generated once and
  shared, environment prefiltered once.
