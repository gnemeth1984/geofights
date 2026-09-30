# geofights.com launch batch (2026-09-30)

Ask: same as rotahr.com but on geofights.com; SEO so people find it; homepage = the game
(login, no dev info); location needed; free upgrades drop near parks/pitches/playgrounds;
lose a fight → lose an upgrade; winner uses or sells it; community with age verification.

## Decisions (user answered)
- Homepage: my call → crawlable game landing at `/` with login/signup up front; logged-in
  players go straight to `/play`. Dev overview moves to `/dev` (unlinked, noindex).
- Stake: loser loses one random booster **equipped on the avatar that fought**, it is
  destroyed; winner gets a fresh level-1 copy of the same booster definition.
- Loser has nothing equipped → loses nothing; winner gets a random booster instead.
- Equipped boosters are NOT protected.
- Free drops: a few per day per player with a cooldown.
- Location at signup: unanswered (field got the community ask) → ask again.
- Community + age verification: new scope → ask before building.

## My rules (flag to user)
- Stakes only on real results: `last_standing` (KO) and `opponent_left` (rage-quit forfeits).
  Not on `called` / reaper-abandoned.
- Anti-farm: one forfeit per winner/loser pair per 24h (alts feeding a main).
- Listed-on-marketplace instances can't be taken (they're in escrow).
- Personal drops: 3/day, 2h cooldown, only in APPROVED zones within 1.5 km, reserved to that
  player, 26h TTL, never placed on a hazard. Zone review gate stays — child safety.
- Deploy: stays on the Runable stack; domain connect is Runable UI (Publish → Domains).

## Status
- [x] schema: spawn_point.reserved_for_player_id, booster_forfeit table → db:push
- [x] stakes service + wire into finishMatch + rewards payload + client result copy
- [x] player Market panel (Buy / Sell / My listings) — API existed, UI did not
- [x] personal drops on nearby read (+ `nature.drops` allowance procedure)
- [x] verify: typecheck, lint baseline 4, build, check:combat 150, smoke, safety smoke,
      `packages/web/scripts/combat/stakes-check.ts` 44/44 (real DB, self-cleaning)
- [x] fix: drop hazard scan used 100m, now the safety layer's 250m
- [ ] commit + push
- [ ] ask: community/age verification + location strictness
- [ ] landing `/` + SEO (static crawlable HTML, robots, sitemap, JSON-LD, canonical), dev → `/dev`
- [ ] docs.tsx: `forfeits` in match_finished payload; UI for drop allowance

Run the stakes check: `cd packages/web && bun --env-file=../../.env scripts/combat/stakes-check.ts`
