#!/usr/bin/env bash
# End-to-end smoke test: sign up two players, generate avatars, buy/collect
# boosters, run a match through the battle engine, then trade on the market.
# Usage: bash scripts/smoke.sh [baseUrl]
#
# Note on the SSE check: the Vite dev middleware buffers responses
# (`await response.arrayBuffer()`), so an infinite event stream never flushes
# through `bun run dev`. The script therefore boots the production entry
# (packages/web/src/__server.ts) on SSE_PORT for that one check.
set -uo pipefail

BASE="${1:-http://localhost:4200}"
SSE_PORT="${SSE_PORT:-4299}"
SSE_BASE="http://localhost:$SSE_PORT"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@arbattle.test}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Passw0rd!23}"
STAMP=$(date +%s)
A_JAR=$(mktemp)
B_JAR=$(mktemp)
ADM_JAR=$(mktemp)
FAILED=0
SSE_PID=""

cleanup() { [ -n "$SSE_PID" ] && kill "$SSE_PID" 2>/dev/null; }
trap cleanup EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# rpc <cookie-jar> <procedure> [json]
# oRPC addresses nested routers with slashes: players.me -> players/me
rpc() {
  curl -s -m 60 -b "$1" -c "$1" -X POST "$BASE/api/rpc/${2//./\/}" \
    -H 'content-type: application/json' -d "${3:-{\}}"
}

signup() {
  curl -s -m 30 -c "$1" -X POST "$BASE/api/auth/sign-up/email" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$2\",\"password\":\"$3\",\"name\":\"$4\"}"
}

signin() {
  curl -s -m 30 -c "$1" -X POST "$BASE/api/auth/sign-in/email" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$2\",\"password\":\"$3\"}"
}

get() { printf '%s' "$1" | jq -r "$2" 2>/dev/null; }

check() { # check <label> <json> <jq-filter>
  local val
  val=$(get "$2" "$3")
  if [ -z "$val" ] || [ "$val" = "null" ]; then
    printf '  \033[31mFAIL\033[0m %s -> %s\n' "$1" "$(printf '%s' "$2" | head -c 300)"
    FAILED=$((FAILED + 1))
  else
    printf '  \033[32mok\033[0m   %s = %s\n' "$1" "$(printf '%s' "$val" | head -c 140)"
  fi
}

pass() { printf '  \033[32mok\033[0m   %s = %s\n' "$1" "$(printf '%s' "$2" | head -c 140)"; }
fail() {
  printf '  \033[31mFAIL\033[0m %s -> %s\n' "$1" "$(printf '%s' "$2" | head -c 300)"
  FAILED=$((FAILED + 1))
}

step "sign up two players"
signup "$A_JAR" "alpha+$STAMP@example.com" "Passw0rd!23" "Alpha" >/dev/null
signup "$B_JAR" "bravo+$STAMP@example.com" "Passw0rd!23" "Bravo" >/dev/null
# Sign-up is not finished until age band + area are on file; matches refuse otherwise.
rpc "$A_JAR" community.completeSignup '{"json":{"ageBand":"18plus","lat":53.35,"lng":-6.26}}' >/dev/null
rpc "$B_JAR" community.completeSignup '{"json":{"ageBand":"18plus","lat":53.35,"lng":-6.26}}' >/dev/null
ME_A=$(rpc "$A_JAR" players.me)
ME_B=$(rpc "$B_JAR" players.me)
check "player A" "$ME_A" '.json.username'
check "player B" "$ME_B" '.json.username'
check "A currency" "$ME_A" '.json.currency'
check "A starter boosters" "$(rpc "$A_JAR" boosters.inventory)" '.json[0].booster.name'
PID_A=$(get "$ME_A" '.json.id')
PID_B=$(get "$ME_B" '.json.id')

step "admin account (ADMIN_EMAILS) + currency grant"
signup "$ADM_JAR" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "Operator" >/dev/null
signin "$ADM_JAR" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" >/dev/null
check "admin role" "$(rpc "$ADM_JAR" players.me)" '.json.role'
# Fund A so the shop/upgrade path is not blocked by the starting balance.
check "grant currency to A" \
  "$(rpc "$ADM_JAR" admin.grantCurrency "{\"json\":{\"playerId\":\"$PID_A\",\"amount\":8000,\"note\":\"smoke test\"}}")" \
  '.json.currency'

step "avatars (AI-generated, 3 slots)"
AV_A=$(rpc "$A_JAR" avatars.generate '{"json":{"theme":"volcanic scrap mech"}}')
AV_B=$(rpc "$B_JAR" avatars.generate '{"json":{"theme":"arctic recon drone"}}')
check "A avatar" "$AV_A" '.json.name'
check "A rarity" "$AV_A" '.json.rarity'
check "A ability" "$AV_A" '.json.specialAbility'
check "B avatar" "$AV_B" '.json.name'
AVID_A=$(get "$AV_A" '.json.id')
AVID_B=$(get "$AV_B" '.json.id')

step "booster shop: buy + equip"
SHOP=$(rpc "$A_JAR" boosters.shop '{"json":{}}')
check "shop stocked" "$SHOP" '.json[0].name'
BID=$(get "$SHOP" '.json[0].id')
BUY=$(rpc "$A_JAR" boosters.buy "{\"json\":{\"boosterId\":\"$BID\"}}")
check "bought" "$BUY" '.json.instance.id'
INST=$(get "$BUY" '.json.instance.id')
EQ=$(rpc "$A_JAR" boosters.equip "{\"json\":{\"instanceId\":\"$INST\",\"avatarId\":\"$AVID_A\"}}")
check "equipped" "$EQ" '.json.equippedAvatarId'
STATS=$(rpc "$A_JAR" avatars.get "{\"json\":{\"avatarId\":\"$AVID_A\"}}")
check "base attack" "$STATS" '.json.base.attack'
check "effective attack (with booster)" "$STATS" '.json.effective.attack'
UP=$(rpc "$A_JAR" boosters.upgrade "{\"json\":{\"instanceId\":\"$INST\"}}")
check "upgraded to tier 2" "$UP" '.json.instance.id'
check "upgrade cost charged" "$UP" '.json.cost'
OLD_ID=$(get "$UP" '.json.supersededInstanceId')
check "old copy kept + tradable" "$(rpc "$A_JAR" boosters.inventory)" \
  "[.json[] | select(.id==\"$OLD_ID\")][0].tradable"

step "nature exploration (GPS spawns)"
REFRESH=$(curl -s -m 240 -X POST "$BASE/api/cron/daily-booster-spawn")
# A spawn pass walks every zone and runs ~2min, so the request above can give up
# before the job answers, and a run started by an earlier invocation (or by the
# in-process ticker) is often still in flight. Neither is a failure: an empty
# body is the curl timing out, `skipped: already running` is the lock doing its
# job. The spawn assertions below are what actually prove the job's output.
if [ -z "$REFRESH" ]; then
  printf '  \033[33mskip\033[0m spawn job still running when the request timed out\n'
else
  check "spawn job dispatched" "$REFRESH" '.job'
  if [ "$(get "$REFRESH" '.skipped')" = "already running" ]; then
    printf '  \033[33mskip\033[0m spawn job already in flight from an earlier run\n'
  else
    check "spawn job ran" "$REFRESH" '.status'
  fi
fi
ZONE=$(rpc "$A_JAR" nature.nearestZone '{"json":{}}')
check "zone resolved" "$ZONE" '.json.name'
Z_LAT=$(get "$ZONE" '.json.centerLat')
Z_LNG=$(get "$ZONE" '.json.centerLng')
rpc "$A_JAR" players.ping "{\"json\":{\"lat\":$Z_LAT,\"lng\":$Z_LNG}}" >/dev/null
NEAR=$(rpc "$A_JAR" nature.nearby "{\"json\":{\"lat\":$Z_LAT,\"lng\":$Z_LNG,\"radiusM\":20000}}")
check "spawns nearby" "$NEAR" '.json[0].id'
check "distance computed" "$NEAR" '.json[0].distanceM'
SPAWN_ID=$(get "$NEAR" '.json[0].id')
SPAWN_LAT=$(get "$NEAR" '.json[0].lat')
SPAWN_LNG=$(get "$NEAR" '.json[0].lng')
FAR=$(rpc "$A_JAR" nature.collect "{\"json\":{\"spawnPointId\":\"$SPAWN_ID\",\"lat\":0,\"lng\":0}}")
check "out-of-range rejected" "$FAR" '.json.message'
GOT=$(rpc "$A_JAR" nature.collect "{\"json\":{\"spawnPointId\":\"$SPAWN_ID\",\"lat\":$SPAWN_LAT,\"lng\":$SPAWN_LNG}}")
check "collected in range" "$GOT" '.json.instance.id'
check "pickup logged" "$(rpc "$A_JAR" players.collectionLog '{"json":{}}')" '.json[0].boosterName'

step "matchmaking"
MATCH=$(rpc "$A_JAR" matches.create "{\"json\":{\"avatarId\":\"$AVID_A\",\"lat\":$Z_LAT,\"lng\":$Z_LNG}}")
check "match created" "$MATCH" '.json.match.id'
MID=$(get "$MATCH" '.json.match.id')
# matches.open returns match rows with hostUsername/zoneName/players folded in.
OPEN=$(rpc "$B_JAR" matches.open '{"json":{}}')
check "open lobby listed" "$OPEN" "[.json[] | select(.id==\"$MID\")][0].id"
check "lobby player count" "$OPEN" "[.json[] | select(.id==\"$MID\")][0].players"
# Lobby snapshots only carry `players` once battle states are seeded at start,
# so joining is verified on the match row and the roster is checked after start.
JOIN=$(rpc "$B_JAR" matches.join "{\"json\":{\"matchId\":\"$MID\",\"avatarId\":\"$AVID_B\"}}")
check "B joined" "$JOIN" '.json.match.id'
check "B in roster" "$(rpc "$B_JAR" matches.open '{"json":{}}')" "[.json[] | select(.id==\"$MID\")][0].players"
START=$(rpc "$A_JAR" matches.start "{\"json\":{\"matchId\":\"$MID\"}}")
check "match active" "$START" '.json.match.status'
check "battle states seeded" "$START" '.json.players[1].maxHealth'

step "battle engine (server-authoritative)"
rpc "$A_JAR" battle.updatePosition "{\"json\":{\"matchId\":\"$MID\",\"lat\":$Z_LAT,\"lng\":$Z_LNG}}" >/dev/null
NEAR_LAT=$(python3 -c "print($Z_LAT + 0.00005)")
rpc "$B_JAR" battle.updatePosition "{\"json\":{\"matchId\":\"$MID\",\"lat\":$NEAR_LAT,\"lng\":$Z_LNG}}" >/dev/null
MY=$(rpc "$A_JAR" battle.myState "{\"json\":{\"matchId\":\"$MID\"}}")
check "own state" "$MY" '.json.currentHealth'
check "abilities loaded" "$MY" '.json.abilities[0].id'
ABILITY_ID=$(get "$MY" '.json.abilities[0].id')
ABIL=$(rpc "$A_JAR" battle.useAbility \
  "{\"json\":{\"matchId\":\"$MID\",\"abilityId\":\"$ABILITY_ID\",\"targetPlayerId\":\"$PID_B\"}}")
check "ability used" "$ABIL" '.json.ability.name'
check "ability narrated" "$ABIL" '.json.message'
rpc "$B_JAR" battle.updatePosition \
  "{\"json\":{\"matchId\":\"$MID\",\"lat\":$(python3 -c "print($Z_LAT + 0.02)"),\"lng\":$Z_LNG}}" >/dev/null
MISS=$(rpc "$A_JAR" battle.attack "{\"json\":{\"matchId\":\"$MID\",\"targetPlayerId\":\"$PID_B\"}}")
check "range enforced" "$MISS" '.json.message'
rpc "$B_JAR" battle.updatePosition "{\"json\":{\"matchId\":\"$MID\",\"lat\":$NEAR_LAT,\"lng\":$Z_LNG}}" >/dev/null
# battle.attack returns { damage, crit, targetHealth, killed, rangeM, message }.
HIT=""
LAST_OK=""
for _ in $(seq 1 40); do
  HIT=$(rpc "$A_JAR" battle.attack "{\"json\":{\"matchId\":\"$MID\",\"targetPlayerId\":\"$PID_B\"}}")
  [ "$(get "$HIT" '.json.damage')" != "null" ] && LAST_OK="$HIT"
  [ "$(get "$HIT" '.json.killed')" = "true" ] && break
  # A 4xx is the engine stating a rule (out of range, cooldown, already dead),
  # so stop and let the assertions read it. A 5xx is the hosted DB dropping a
  # connection under the loop's load — retry that instead of ending the fight on
  # it, and if it is not transient the loop runs out and the check still fails.
  if [ "$(get "$HIT" '.json.code')" != "null" ]; then
    [ "$(get "$HIT" '.json.status')" -lt 500 ] 2>/dev/null && break
    printf '  \033[33m..\033[0m   transient %s, retrying\n' "$(get "$HIT" '.json.status')"
  fi
  sleep 1.7
done
if [ -n "$LAST_OK" ]; then
  check "damage applied" "$LAST_OK" '.json.damage'
  check "hit narrated" "$LAST_OK" '.json.message'
else
  # The ability alone can finish a low-HP target, which is a valid knockout.
  pass "damage applied (via ability)" "$(get "$ABIL" '.json.hits[0].damage')"
fi
B_ALIVE=$(get "$(rpc "$A_JAR" matches.get "{\"json\":{\"matchId\":\"$MID\"}}")" \
  "[.json.players[] | select(.playerId==\"$PID_B\")][0].alive")
if [ "$B_ALIVE" = "false" ]; then
  pass "target knocked out" "alive=false"
else
  fail "target knocked out" "B still alive after 40 attacks: $HIT"
fi

step "finish + rewards"
# The engine settles the match itself once one player is left standing, so
# matches.finish is only called when the match is somehow still active.
SNAP=$(rpc "$A_JAR" matches.get "{\"json\":{\"matchId\":\"$MID\"}}")
if [ "$(get "$SNAP" '.json.match.status')" = "finished" ]; then
  pass "auto-finished on last standing" "$(get "$SNAP" '.json.match.status')"
else
  FIN=$(rpc "$A_JAR" matches.finish "{\"json\":{\"matchId\":\"$MID\"}}")
  check "finish call" "$FIN" '.json.match.status'
  SNAP=$(rpc "$A_JAR" matches.get "{\"json\":{\"matchId\":\"$MID\"}}")
fi
check "finished" "$SNAP" '.json.match.status'
check "winner" "$SNAP" '.json.match.winnerPlayerId'
check "AI summary" "$SNAP" '.json.match.summary'
EV=$(rpc "$A_JAR" battle.events "{\"json\":{\"matchId\":\"$MID\"}}")
FINEV=$(get "$EV" '[.json.events[] | select(.type=="match_finished")][0]')
check "xp reward" "$FINEV" '.payload.rewards[0].xp'
check "currency reward" "$FINEV" '.payload.rewards[0].currency'
check "event log" "$EV" '.json.events[0].type'
check "damage logged" "$EV" '.json.events | map(.type) | index("avatar_damage")'
check "death logged" "$EV" '.json.events | map(.type) | index("avatar_death")'
check "match_finished logged" "$EV" '.json.events | map(.type) | index("match_finished")'
check "A stats updated" "$(rpc "$A_JAR" players.stats)" '.json.wins'

step "marketplace (10% fee)"
INV=$(rpc "$A_JAR" marketplace.sellable '{"json":{}}')
check "sellable boosters" "$INV" '.json.boosters[0].itemId'
S_ID=$(get "$INV" '.json.boosters[0].itemId')
check "fee quote" "$(rpc "$A_JAR" marketplace.quote '{"json":{"price":200}}')" '.json.fee'
LIST=$(rpc "$A_JAR" marketplace.sell "{\"json\":{\"itemType\":\"booster\",\"itemId\":\"$S_ID\",\"price\":200}}")
check "listed" "$LIST" '.json.id'
LID=$(get "$LIST" '.json.id')
check "browsable" "$(rpc "$B_JAR" marketplace.browse '{"json":{}}')" '.json[0].id'
BOUGHT=$(rpc "$B_JAR" marketplace.buy "{\"json\":{\"listingId\":\"$LID\"}}")
check "sold" "$BOUGHT" '.json.listing.status'
check "fee taken" "$BOUGHT" '.json.fee'
check "seller netted" "$BOUGHT" '.json.sellerReceived'
check "double-buy rejected" "$(rpc "$B_JAR" marketplace.buy "{\"json\":{\"listingId\":\"$LID\"}}")" '.json.message'
check "ledger" "$(rpc "$A_JAR" players.transactions '{"json":{}}')" '.json[0].type'

step "admin panel data"
check "overview" "$(rpc "$ADM_JAR" admin.overview)" '.json.stats.players'
check "jobs" "$(rpc "$ADM_JAR" admin.jobs)" '.json.jobs[0].job'
check "economy" "$(rpc "$ADM_JAR" admin.economy)" '.json.currencyInCirculation'
check "battle log" "$(rpc "$ADM_JAR" admin.battleLog "{\"json\":{\"matchId\":\"$MID\"}}")" '.json[0].type'
check "listings" "$(rpc "$ADM_JAR" admin.listings '{"json":{}}')" '.json[0].id'
check "leaderboard" "$(rpc "$A_JAR" players.leaderboard '{"json":{}}')" '.json[0].username'
check "non-admin blocked" "$(rpc "$B_JAR" admin.overview)" '.json.code'

step "realtime SSE (streaming server on :$SSE_PORT)"
if ! curl -s -m 3 "$SSE_BASE/api/health" >/dev/null 2>&1; then
  DISABLE_CRON=1 PORT="$SSE_PORT" bun --env-file=.env packages/web/src/__server.ts \
    >/tmp/smoke-sse.log 2>&1 &
  SSE_PID=$!
  for _ in $(seq 1 20); do
    curl -s -m 2 "$SSE_BASE/api/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi
# Match reads carry fighter positions: outsiders get nothing.
ANON_SSE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 "$SSE_BASE/api/realtime/match/$MID")
if [ "$ANON_SSE" = "401" ]; then pass "sse refuses signed-out" "401"; else fail "sse refuses signed-out" "$ANON_SSE"; fi
ANON_GET=$(curl -s -m 30 -X POST "$BASE/api/rpc/matches/get" -H 'content-type: application/json' \
  -d "{\"json\":{\"matchId\":\"$MID\"}}")
if printf '%s' "$ANON_GET" | grep -q '"players"'; then fail "matches.get refuses signed-out" "$ANON_GET"; else pass "matches.get refuses signed-out" "ok"; fi
if printf '%s' "$SNAP" | grep -q '"position":{'; then fail "finished match hides positions" "$SNAP"; else pass "finished match hides positions" "ok"; fi
SSE=$(curl -s -b "$A_JAR" --max-time 4 --no-buffer -N "$SSE_BASE/api/realtime/match/$MID" 2>/dev/null | head -c 40000)
if printf '%s' "$SSE" | grep -q "^event:"; then
  pass "sse replays events" "$(printf '%s' "$SSE" | grep -c '^event:') frames"
else
  fail "sse" "$SSE"
fi
if printf '%s' "$SSE" | grep -q "^event: match_finished"; then
  pass "sse carries match_finished" "ok"
else
  fail "sse match_finished frame" "$(printf '%s' "$SSE" | head -c 200)"
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf '\033[32mAll smoke checks passed.\033[0m\n'
else
  printf '\033[31m%s check(s) failed.\033[0m\n' "$FAILED"
fi
exit "$FAILED"
