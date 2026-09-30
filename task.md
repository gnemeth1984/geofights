# Fight hype layer (Tekken energy)

Ask: fights feel boring. Want cheering, esports announcer TTS, character trash-talk
bubbles, milestone callouts (FIRST BLOOD / COMBO / CRITICAL / FINISH). Both PvP and training.

## Plan
1. Assets: announcer VO (pre-rendered mp3, instant + free at runtime) in public/hype/,
   crowd cheer / gasp / bed sfx.
2. `src/web/lib/hype.ts` — pure: milestone detection from an exchange, combo tracker,
   banner text, VO file mapping, opponent heel-taunt bank. Shared by PvP + training.
3. `src/web/ar/hype.ts` — playback: announcer queue (one at a time, priority), crowd
   bed that swells with the fight, gasps on big hits. Uses the sfx module's audio graph.
4. `src/web/components/play/hype-banner.tsx` — big arcade callout + combo counter +
   commentary ticker (renders `event.message`, the AI line the server already writes).
5. Wire: play.tsx (avatar_damage / avatar_death / match_started) + training hits.
6. speech.ts: new combat contexts (taunt_landed / taunt_hurt / near_death) so the
   character trash-talks out of its own personality bank.

## Status
- [x] plan
- [x] assets — 18 mp3 in packages/web/public/hype (14 announcer calls, 4 crowd), ~272 KB
- [x] hype.ts (pure) — reducer, ranks, cooldowns, banners, taunt bank, exchangeLine
- [x] hype audio — shared graph via sfxGraph(), announcer queue-of-one, ducking, crowd bed
- [x] banner UI — callout + combo counter + commentary ticker, reduced-motion aware
- [x] wiring — useHype in play.tsx: match active / avatar_damage / match_finished / training hits
- [x] trash talk contexts — 3 new SPEECH_CONTEXTS (taunt_landed / taunt_hurt / near_death) with
      an ADDRESSEE map so combat lines are aimed across the ring instead of at the pilot,
      hand-written fallbacks for all 6 personalities, cooldowns + priority in use-avatar-voice.
      Only the player's own character speaks through it; the opponent keeps the deterministic
      bank in lib/hype.ts (never a model call on another player's behalf)
- [x] verify: typecheck / lint (4 pre-existing errors only) / build / playwright

## Verified in a real browser (scripts/verify-hype.py)
- all 14 announcer calls and 3 crowd one-shots fetch, decode and play; bed glides on heat
- cold-cache first call no longer swallowed (COLD_GRACE_MS retry)
- reducer sequence: FIRST BLOOD -> COMBO x2 -> COUNTER -> FINISH IT -> K.O., heat 0 -> 0.94
- hook end to end: FIGHT on active, banners self-clear on ttl, chain counter lapses after
  the combo window, PERFECT on an untouched win, server commentary line renders
- combat contexts: fallbacks cover 6 personalities x 9 contexts with no holes, schema accepts
  the 3 new ones and rejects junk; live model lines verified through the gateway — combat lines
  address the opponent, non-combat still address the pilot
- routing verified in-browser: light blow -> silence, my crit -> taunt_landed, heavy blow on me
  -> taunt_hurt, me under 20% health -> near_death, whiff -> silence

## Send the health ceiling with the blow

`avatar_damage` now carries `maxHealth` alongside `targetHealth`, at both emit
sites in `api/battle/engine.ts` — the attack path and the per-hit ability path
(whose `hits` rows carry the receiver's ceiling for it). `use-hype.ts` reads it
off the payload and keeps the roster lookup only as a fallback.

Why: DANGER, FINISH and the character's `near_death` line all need a fraction,
and the client used to get the ceiling from the match roster. A blow landing
before that roster answered was read as harmless and the call was dropped.

Verified in a browser with the roster deliberately empty (`scripts/verify-maxhealth.py`):

  - 12/100 with `maxHealth` on the payload -> FINISH IT
  - the same blow without it              -> NICE HIT (the old silent drop)
  - their crit leaving me on 9/120        -> `near_death` spoken
  - the same without it                   -> `taunt_hurt` only
  - an ability hit at 10/140              -> FINISH IT
  - a killing blow                        -> K.O., unchanged

Zero console errors. typecheck, lint (at the 4 pre-existing baseline errors) and
the web build all clean.
