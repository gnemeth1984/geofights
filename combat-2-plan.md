# GeoFights — Combat II: making the fight a fight

The first combat pass was presentation, and it worked. This one is about the
part underneath it, because that is what is actually holding the game back.

## The problem, stated plainly

`battle.attack` takes `{ matchId, targetPlayerId }`. No move. The server runs
`computeDamage` — `attack × mitigation × random variance × random crit` — and
*then* `chooseMoves()` picks, from a seeded hash, which of the 19 moves to
animate. The pad's own code says it:

> *"The pad highlights what resolved, not what was pressed: the engine chose
> this move, and pretending otherwise would be a lie the feed contradicts a
> second later."*

So: nineteen buttons, one request. Defences are theatre — `defenseType` never
touches damage. One 1.5 s cooldown on everything, so no move trades against any
other. `REACH_M` is per-move and then floored at 0.38 m, which is below the gap
the game seats a sparring pair at, so nothing can ever whiff. Variance and crit
are invisible, which makes them read as arbitrary rather than tense.

The renderer is excellent and the match it renders was never in doubt.

## The six changes

1. **The move reaches the server.** `moveType` on `battle.attack`, validated
   against `movesForForm` for that body, and each move carries its own power,
   reach, stamina cost, windup and recovery.
2. **Defence becomes a timed read.** An attack telegraphs before it lands; the
   defender has that window to answer, and how well they time it decides
   whether it is a parry, a block, or a hit taken clean.
3. **Reach un-floored.** Real per-move reach, no 0.38 m floor, so spacing is a
   thing a player can win or lose. The whiff animation that already exists
   becomes reachable in a real match.
4. **Stamina instead of one global cooldown.** A shared pool with per-move
   costs, so choosing a move costs something.
5. **The room matters, once.** Backed against a real wall means nowhere to give
   ground, and a blow taken there hurts more.
6. **Randomness made visible.** Crit chance and the roll come back with the
   result and get named in the feed.

## Where the authority sits

The hard part is 2. A timed parry means the server has to know *when* the
defender answered, and the current rule is that the client reports intent and
nothing else.

**The design: pre-commit, server-clocked.** Neither of the two options I was
offered, because both are worse than this.

- The attacker's `battle.attack` stamps `strikeAt = now + windupMs` from the
  move's own strike frame, emits `avatar_windup` immediately, and only then
  resolves. Resolution is deferred inside the same request — windups are
  150–520 ms, so the handler waits out the telegraph and settles the damage
  when the blow actually lands.
- The defender answers with `battle.guard({ matchId, moveType })`. The server
  stamps that arrival itself. No client timestamp is trusted, or even sent.
- At `strikeAt`, the server has both its own timestamps and grades the gap.

This is authoritative *and* latency-tolerant, because the quantity being
measured is "did you read the telegraph", which is exactly what the windup
broadcast gives every client at the same moment. A laggy defender loses the
part of the window their latency ate — the same thing that happens in every
fighting game — rather than having their input thrown out by a strict window or
being trusted to self-report a timestamp they could lie about.

Costs, accepted: a request is held open for the length of a windup, and a
defender's guard is a second round trip. Both are fine at this scale, and the
client already swings optimistically on the tap so nothing *looks* delayed.

### Grading

`offset = guardAt - strikeAt`, in ms.

| offset | grade | effect |
|---|---|---|
| −520…−140 | `early` | guard is up: mitigation only, full stamina cost |
| −140…+40 | `parry` | blow turned: heavy mitigation, attacker staggered, punish window |
| +40…+180 | `late` | clipped: partial mitigation |
| no guard, or later | `clean` | full damage |

On top of the timing, the **matchup**: a dodge beats anything swung by a body
and does nothing against an area burst; a shell guard eats a heavy slam and
folds to an elemental burst; a parry is strongest against the fast light moves
and cannot turn a charge. So the read is *what* as well as *when*.

## Keeping stats meaningful

Binding constraint, and the thing that makes this different from bolting a
fighting game onto an RPG:

- `attack`/`defense` keep doing exactly what they do now inside
  `computeDamage`. Timing multiplies that number; it does not replace it.
- `speed` gets a second job: it raises stamina regen, so a fast build throws
  more moves per exchange.
- Boosters and levels are untouched. A better-equipped creature that reads the
  fight badly should lose to a worse-equipped one that reads it well — but only
  just, and never at a big enough stat gap.

## Reach, and whose metres they are

`ATTACK_RANGE_M = 30` is GPS. Per-move reach is in AR-room metres, where the
pair stands 1.05 m apart, and the server has no view of that space at all.

So the gap is **reported, and reported by both sides**. `battle.attack` carries
the attacker's measured gap; the defender's client keeps its own reported. The
server takes the **larger of the two**, so lying small to force a hit is
overruled by the target's own measurement, and lying large only ever costs the
liar a hit. Documented as what it is: a soft check where the incentive to cheat
points the safe way.

## Standing still, still

Nothing here needs the player to walk. The gap changes because of the move
stick, the opponent's footwork and the dash — all of which already move bodies
around the AR room while the phone holds still. The GPS walking pause is
untouched.

## Build order

1. `api/lib/move-combat.ts` — shared, no imports: per-move power, reach,
   stamina, windup/strike timing, recovery, defence profiles, the matchup
   table, the grader, stamina maths. Imported by server *and* client so the two
   can never drift.
2. Drift check: `DURATION` and `STRIKE_BEATS` stay exactly where they are in
   `character.ts` and are asserted against the shared table by a script, rather
   than being moved or rewritten.
3. Engine: `moveType`, deferred windup resolution, `guard`, stamina columns,
   per-move reach, whiffs, crit visibility, cornered.
4. Client: pad sends the move, a guard prompt that reads the telegraph, gap and
   space-behind reporting, reach un-floored in the stage.
5. Verify: the four existing suites stay green, plus new checks for grading,
   stamina, whiffs and the windup round trip.

## Status — server half done and verified

Steps 1-3 of the build order are implemented. `bun run typecheck` is clean
across all three packages, the schema is live, and `bun run check:combat` runs
two scripts that both pass:

- `scripts/combat/timing-check.ts` — imports `character.ts` itself and asserts
  the shared table against the real animation. **18 attacks, 6 defences, exact
  match.** This is the drift check step 2 asked for.
- `scripts/combat/logic-check.ts` — **141 checks** over the grading windows,
  the grade ordering, riposte/stagger conditions, stamina maths, reach,
  spacing, cornered, and the telegraph.

### The grading windows, concretely

Milliseconds relative to contact; negative is early. Both timestamps are the
server's own.

| window | ms from contact | outcome |
|---|---|---|
| before -520 | guard already dropped | `clean` — full damage |
| -520 to -141 | read it, not on the frame | `early` |
| -140 to +40 | on the frame | `parry` |
| +41 to +180 | a touch behind it | `late` |
| after +180 | never arrived | `clean` — full damage |

Wrong *kind* of answer inside any window grades `wrong` — 0.94x, so reading
the timing and misreading the move is worth almost nothing.

Verified consequence: every move's parry window opens **after** its telegraph
goes out, so nothing is unreadable by construction. The tightest read in the
game is `spike_burst` at **61 ms** after the telegraph.

### Two balance findings from writing the checks

1. **`attack_lurch` was the best move in the game.** The fallback — what a
   body with no form swings with — had power 1.0 on a 438 ms cadence, giving it
   the highest sustained output of any of the nineteen moves. Nothing should be
   gained by having no body, so it is now power 0.7 with 380 ms of recovery:
   the worst sustained option, and strictly weaker than `bite`, the one attack
   every form gets free. Its windup and duration are untouched because those
   are the real animation.
2. **Stamina is a power throttle, not a lockout.** Worth stating because it
   was not obvious until simulated: you are never barred from swinging with a
   full health bar, you just swing weaker, and heavy spam settles into a
   reduced-power equilibrium rather than running dry. The invariants now
   asserted are the ones that matter — no heavy move can be sustained at full
   power, and spamming a heavy never beats spamming a light on raw throughput.

Sustained output across the whole move list sits in a 1.0-2.2 power/second
band at both ends of the speed stat, and speed measurably buys throughput, so
the stat line and the boosters behind it still do their job.

## Status — all five steps done

Step 4 landed with the stick/pad join (`f9438d9`), and this section used to
still say it was untouched. What is actually in the client:

- **The pad sends the move.** `doAttack` passes the pressed `moveType`, after
  the stick has had its say — the button names the strike, the stick names the
  footwork it is thrown off, and `moveForFootwork` resolves the two into one
  blow. The swing animates on the tap and the reply only corrects it if the
  engine threw something else, so the round trip the server holds open for the
  windup is not paid twice.
- **The guard prompt reads the telegraph.** `avatar_windup` sets `incoming`;
  the pad names the blow and rings the defences that answer its kind, and the
  badge comes down on a timer set to `strikeAt + GUARD_WINDOW.lateToMs`. The
  far body starts its swing on the telegraph, which is the thing being read.
  `battle.guard` sends *what*, never when.
- **Reach is un-floored.** The stage's hand-copied 0.38 m-floored table is
  gone; it asks `ATTACK_PROFILE[move].reachM` and `REACH_SLACK_M` — the same
  table the hit check asks — so the eye and the server call the same whiff.
- **Both sides report the space.** `spacing()` sends `gapM` and
  `spaceBehindM` on every swing *and* every guard, and the engine takes the
  larger of the two gaps.

Step 5's suites are green as of this pass: `check:combat` 150/0, sculpt-check
24/0, `scripts/smoke.sh` and `scripts/safety-smoke.sh` both fully passing.
Fixing them turned up one real regression, unrelated to combat — `upgrade()`
refits were leaking into the shop listing and escalating its prices 1.8x a
time (`c3401fe`).

## Untouched

- `DURATION` and every existing move curve. Timing is *read* from them.
- The move list. Nineteen moves is plenty; they just have to mean something.
- Rendering, bodies, skins, placement, the GPS walking rule.
