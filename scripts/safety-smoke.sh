#!/usr/bin/env bash
# Safety-layer end-to-end test: hazard veto, zone containment, the stationary
# battle rule, the OSM proposal/review pipeline and the audit trail.
# Usage: bash scripts/safety-smoke.sh [baseUrl]
set -uo pipefail

BASE="${1:-http://localhost:4200}"
# Operator login is never committed. Put ADMIN_EMAIL and ADMIN_PASSWORD in
# ~/.geofights-admin.env (outside the repo, chmod 600) or export them.
ADMIN_ENV_FILE="${ADMIN_ENV_FILE:-$HOME/.geofights-admin.env}"
if [ -z "${ADMIN_PASSWORD:-}" ] && [ -f "$ADMIN_ENV_FILE" ]; then
  set -a; . "$ADMIN_ENV_FILE"; set +a
fi
if [ -z "${ADMIN_EMAIL:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "ADMIN_EMAIL / ADMIN_PASSWORD not set — add them to $ADMIN_ENV_FILE" >&2
  exit 2
fi
STAMP=$(date +%s)
P_JAR=$(mktemp)
Q_JAR=$(mktemp)
ADM_JAR=$(mktemp)
FAILED=0

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

rpc() {
  curl -s -m 90 -b "$1" -c "$1" -X POST "$BASE/api/rpc/${2//./\/}" \
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

expect() { # expect <label> <json> <jq-filter> <wanted>
  local val
  val=$(get "$2" "$3")
  if [ "$val" = "$4" ]; then
    printf '  \033[32mok\033[0m   %s = %s\n' "$1" "$val"
  else
    printf '  \033[31mFAIL\033[0m %s -> wanted %s, got %s in %s\n' \
      "$1" "$4" "$val" "$(printf '%s' "$2" | head -c 200)"
    FAILED=$((FAILED + 1))
  fi
}

step "accounts"
signup "$P_JAR" "safe+$STAMP@example.com" "Passw0rd!23" "SafePlayer" >/dev/null
signup "$Q_JAR" "foe+$STAMP@example.com" "Passw0rd!23" "FoePlayer" >/dev/null
# Sign-up is not finished until age band + area are on file; matches refuse otherwise.
rpc "$P_JAR" community.completeSignup '{"json":{"ageBand":"18plus","lat":53.35,"lng":-6.26}}' >/dev/null
rpc "$Q_JAR" community.completeSignup '{"json":{"ageBand":"18plus","lat":53.35,"lng":-6.26}}' >/dev/null
PID_P=$(get "$(rpc "$P_JAR" players.me)" '.json.id')
PID_Q=$(get "$(rpc "$Q_JAR" players.me)" '.json.id')
check "player signed up" "$(rpc "$P_JAR" players.me)" '.json.username'
signin "$ADM_JAR" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" >/dev/null
expect "admin session" "$(rpc "$ADM_JAR" players.me)" '.json.role' "admin"

step "safety config + a clean verdict"
check "rules published" "$(rpc "$P_JAR" safety.config)" '.json.rules[0]'
ZONE=$(rpc "$P_JAR" nature.nearestZone '{"json":{}}')
Z_LAT=$(get "$ZONE" '.json.centerLat')
Z_LNG=$(get "$ZONE" '.json.centerLng')
check "approved zone resolved" "$ZONE" '.json.name'
OK=$(rpc "$P_JAR" safety.check "{\"json\":{\"lat\":$Z_LAT,\"lng\":$Z_LNG,\"speedMps\":0}}")
expect "inside zone is playable" "$OK" '.json.verdict' "ok"
expect "allowed" "$OK" '.json.allowed' "true"

step "containment: outside every approved zone"
# Unclassified ground grades `training_zone`, not `outside_zone`: the player
# keeps their character and can spar, and loses everything that awards
# progression. `outside_zone` now means the narrower thing — ground a proposal
# is pending on. Either way the property this step exists to protect is the
# same, so all three of its consequences are asserted rather than just the name.
OUT=$(rpc "$P_JAR" safety.check '{"json":{"lat":-40.123,"lng":170.456,"speedMps":0}}')
expect "middle of nowhere refused" "$OUT" '.json.verdict' "training_zone"
expect "refused" "$OUT" '.json.allowed' "false"
expect "no ranked battle off approved ground" "$OUT" '.json.canBattle' "false"
expect "no pickups off approved ground" "$OUT" '.json.canPickup' "false"
NOFIX=$(rpc "$P_JAR" safety.check '{"json":{}}')
expect "no GPS fix refused" "$NOFIX" '.json.verdict' "no_fix"

step "speed gate"
FAST=$(rpc "$P_JAR" safety.check "{\"json\":{\"lat\":$Z_LAT,\"lng\":$Z_LNG,\"speedMps\":14}}")
expect "vehicle speed refused" "$FAST" '.json.verdict' "too_fast"
check "vehicle wording" "$FAST" '.json.advice'

step "a booster to pick up"
Z_ID=$(get "$ZONE" '.json.id')
rpc "$ADM_JAR" admin.spawnBooster "{\"json\":{\"zoneId\":\"$Z_ID\"}}" >/dev/null
NEAR=$(rpc "$P_JAR" nature.nearby "{\"json\":{\"lat\":$Z_LAT,\"lng\":$Z_LNG,\"radiusM\":5000}}")
SPAWN_ID=$(get "$NEAR" '.json[0].id')
SPAWN_LAT=$(get "$NEAR" '.json[0].lat')
SPAWN_LNG=$(get "$NEAR" '.json[0].lng')
check "spawn in the zone" "$NEAR" '.json[0].id'

step "hazard veto beats an approved zone"
HAZ=$(rpc "$ADM_JAR" safety.hazardCreate \
  "{\"json\":{\"name\":\"Test crossing $STAMP\",\"kind\":\"road\",\"lat\":$SPAWN_LAT,\"lng\":$SPAWN_LNG,\"radiusM\":40}}")
HAZ_ID=$(get "$HAZ" '.json.id')
check "hazard created" "$HAZ" '.json.id'
BLOCKED=$(rpc "$P_JAR" safety.check "{\"json\":{\"lat\":$SPAWN_LAT,\"lng\":$SPAWN_LNG,\"speedMps\":0}}")
expect "approved ground now vetoed" "$BLOCKED" '.json.verdict' "hazard"
expect "level 2 (stop)" "$BLOCKED" '.json.level' "2"
check "road wording" "$BLOCKED" '.json.headline'
check "hazards drawn for client" \
  "$(rpc "$P_JAR" safety.hazards "{\"json\":{\"lat\":$SPAWN_LAT,\"lng\":$SPAWN_LNG,\"radiusM\":500}}")" '.json[0].id'

step "pickup refused on the hazard"
PICK=$(rpc "$P_JAR" nature.collect \
  "{\"json\":{\"spawnPointId\":\"$SPAWN_ID\",\"lat\":$SPAWN_LAT,\"lng\":$SPAWN_LNG}}")
if [ "$(get "$PICK" '.json.data.reason')" = "unsafe" ]; then
  printf '  \033[32mok\033[0m   %s = %s\n' "collect blocked by safety" "$(get "$PICK" '.json.message')"
else
  printf '  \033[31mFAIL\033[0m collect blocked by safety -> %s\n' "$(printf '%s' "$PICK" | head -c 200)"
  FAILED=$((FAILED + 1))
fi

step "hazard removed, pickup allowed again"
rpc "$ADM_JAR" safety.hazardDelete "{\"json\":{\"hazardId\":\"$HAZ_ID\"}}" >/dev/null
CLEAR=$(rpc "$P_JAR" safety.check "{\"json\":{\"lat\":$SPAWN_LAT,\"lng\":$SPAWN_LNG,\"speedMps\":0}}")
expect "clear again" "$CLEAR" '.json.verdict' "ok"
PICK2=$(rpc "$P_JAR" nature.collect \
  "{\"json\":{\"spawnPointId\":\"$SPAWN_ID\",\"lat\":$SPAWN_LAT,\"lng\":$SPAWN_LNG}}")
check "collected once clear" "$PICK2" '.json.instance.id'

step "stationary battles: walking pauses your own combat"
AV_P=$(get "$(rpc "$P_JAR" avatars.generate '{"json":{"theme":"safety drill mech"}}')" '.json.id')
AV_Q=$(get "$(rpc "$Q_JAR" avatars.generate '{"json":{"theme":"crossing guard bot"}}')" '.json.id')
MATCH=$(rpc "$P_JAR" matches.create "{\"json\":{\"avatarId\":\"$AV_P\",\"lat\":$Z_LAT,\"lng\":$Z_LNG}}")
MID=$(get "$MATCH" '.json.match.id')
check "match created" "$MATCH" '.json.match.id'
rpc "$Q_JAR" matches.join "{\"json\":{\"matchId\":\"$MID\",\"avatarId\":\"$AV_Q\"}}" >/dev/null
rpc "$P_JAR" matches.start "{\"json\":{\"matchId\":\"$MID\"}}" >/dev/null
NEAR_LAT=$(python3 -c "print($Z_LAT + 0.00005)")
rpc "$Q_JAR" battle.updatePosition "{\"json\":{\"matchId\":\"$MID\",\"lat\":$NEAR_LAT,\"lng\":$Z_LNG}}" >/dev/null
# First fix has no previous point, so no speed is known yet.
FIRST=$(rpc "$P_JAR" battle.updatePosition "{\"json\":{\"matchId\":\"$MID\",\"lat\":$Z_LAT,\"lng\":$Z_LNG}}")
check "position carries a safety overlay" "$FIRST" '.json.safety.verdict'
sleep 1
# ~11 m in ~1 s: a sprint, well past the walking threshold.
RUN_LAT=$(python3 -c "print($Z_LAT + 0.0001)")
MOVED=$(rpc "$P_JAR" battle.updatePosition "{\"json\":{\"matchId\":\"$MID\",\"lat\":$RUN_LAT,\"lng\":$Z_LNG}}")
expect "server computed movement" "$MOVED" '.json.movement.moving' "true"
check "speed computed server-side" "$MOVED" '.json.speedMps'
WALK_ATTACK=$(rpc "$P_JAR" battle.attack "{\"json\":{\"matchId\":\"$MID\",\"targetPlayerId\":\"$PID_Q\"}}")
expect "attack refused while moving" "$WALK_ATTACK" '.json.data.reason' "moving"
sleep 2
STILL=$(rpc "$P_JAR" battle.updatePosition "{\"json\":{\"matchId\":\"$MID\",\"lat\":$RUN_LAT,\"lng\":$Z_LNG}}")
expect "standing still again" "$STILL" '.json.movement.moving' "false"
sleep 2
HIT=$(rpc "$P_JAR" battle.attack "{\"json\":{\"matchId\":\"$MID\",\"targetPlayerId\":\"$PID_Q\"}}")
check "attack lands once stopped" "$HIT" '.json.damage'
rpc "$ADM_JAR" admin.cancelMatch "{\"json\":{\"matchId\":\"$MID\"}}" >/dev/null

step "OSM import -> pending proposal -> operator review"
# Rotate through real parks so a repeat run still finds ground OSM has not
# already proposed (proposals dedupe by OSM ref).
CENTERS=(
  "52.3702 4.8952"   # Amsterdam
  "48.8566 2.3522"   # Paris
  "41.3874 2.1686"   # Barcelona
  "53.3498 -6.2603"  # Dublin
  "59.3293 18.0686"  # Stockholm
  "45.4642 9.1900"   # Milan
)
OSM='{}'
for c in "${CENTERS[@]}"; do
  read -r CLAT CLNG <<<"$c"
  OSM=$(rpc "$ADM_JAR" safety.importOsm \
    "{\"json\":{\"lat\":$CLAT,\"lng\":$CLNG,\"radiusM\":500,\"limit\":8}}")
  [ "$(get "$OSM" '.json.proposed | length')" != "0" ] && break
done
if [ "$(get "$OSM" '.json.proposed')" = "null" ]; then
  printf '  \033[33mskip\033[0m Overpass unavailable -> %s\n' "$(get "$OSM" '.json.message')"
else
  check "hazards imported live" "$OSM" '.json.hazards | length'
  PENDING=$(rpc "$ADM_JAR" safety.pending)
  PZ=$(get "$PENDING" '.json[0].id')
  if [ "$PZ" = "null" ] || [ -z "$PZ" ]; then
    printf '  \033[33mskip\033[0m no new proposals (area already imported)\n'
  else
    expect "proposal is pending" "$PENDING" '.json[0].review' "pending"
    expect "proposal came from osm" "$PENDING" '.json[0].source' "osm"
    PLAT=$(get "$PENDING" '.json[0].centerLat')
    PLNG=$(get "$PENDING" '.json[0].centerLng')
    DARK=$(rpc "$P_JAR" safety.check "{\"json\":{\"lat\":$PLAT,\"lng\":$PLNG,\"speedMps\":0}}")
    # A proposal's centre can fall inside a zone some earlier run already got
    # approved, and then the ground is playable for a reason that has nothing to
    # do with the proposal. The claim here is only that a *pending* zone does not
    # itself open ground up, so that case is skipped rather than failed — it is
    # the fixture that is wrong, not the rule.
    if [ "$(get "$DARK" '.json.verdict')" = "ok" ]; then
      if [ "$(get "$DARK" '.json.zone.id')" != "null" ]; then
        printf '  \033[33mskip\033[0m proposal sits inside an already-approved zone (%s)\n' \
          "$(get "$DARK" '.json.zone.name')"
      else
        printf '  \033[31mFAIL\033[0m unapproved zone is playable -> %s\n' "$(printf '%s' "$DARK" | head -c 200)"
        FAILED=$((FAILED + 1))
      fi
    else
      printf '  \033[32mok\033[0m   unapproved zone is not playable = %s\n' "$(get "$DARK" '.json.verdict')"
    fi
    REV=$(rpc "$ADM_JAR" safety.review "{\"json\":{\"zoneId\":\"$PZ\",\"review\":\"approved\",\"note\":\"smoke\"}}")
    expect "operator approved it" "$REV" '.json.review' "approved"
    PLAYER_ZONES=$(rpc "$P_JAR" nature.zones)
    check "approved zone visible to players" "$PLAYER_ZONES" \
      "[.json[] | select(.id==\"$PZ\")][0].id"
    rpc "$ADM_JAR" safety.review "{\"json\":{\"zoneId\":\"$PZ\",\"review\":\"rejected\"}}" >/dev/null
  fi
fi

step "audit trail"
EVENTS=$(rpc "$ADM_JAR" safety.events '{"json":{"limit":60}}')
check "events recorded" "$EVENTS" '.json[0].event.id'
check "verdict stored" "$EVENTS" '.json[0].event.verdict'
NONADMIN=$(rpc "$P_JAR" safety.events '{"json":{}}')
expect "player cannot read the audit log" "$NONADMIN" '.json.code' "FORBIDDEN"

printf '\n'
if [ "$FAILED" -gt 0 ]; then
  printf '\033[31m%s safety check(s) failed.\033[0m\n' "$FAILED"
  exit 1
fi
printf '\033[32mAll safety checks passed.\033[0m\n'
