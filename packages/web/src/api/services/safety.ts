/**
 * GeoFights safety layer.
 *
 * The game sends 8-16 year olds outdoors, so "is this a legal place to play"
 * is a server decision, not a client one. Two independent checks:
 *
 *  1. Containment — you must be inside an operator-APPROVED safe zone.
 *  2. Hazard veto — a danger zone (road, rail, water edge, private land)
 *     overrides any safe zone it overlaps. Roads win over parks, always.
 *
 * Plus a speed gate: moving faster than a walk means you are in a vehicle or
 * running into traffic, and play is suspended either way.
 *
 * Zones arrive from OpenStreetMap as PENDING proposals. Nothing an importer
 * creates can be played on until a human approves it in the console.
 */

import { ORPCError } from "@orpc/server";
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { boundingBox, distanceM } from "../lib/geo";
import { ids } from "../lib/ids";

/** Above a brisk walk: assume wheels. Battles suspend, pickups are refused. */
export const MAX_PLAY_SPEED_MPS = 2.5;
/** Sustained speed that looks like a moving vehicle rather than a jog. */
export const VEHICLE_SPEED_MPS = 8;
/** How far out we look for hazards when judging a single point. */
const HAZARD_SCAN_RADIUS_M = 250;

export type SafetyVerdict =
  | "ok"
  | "outside_zone"
  | "training_zone"
  | "hazard"
  | "too_fast"
  | "no_fix";

export interface SafetyAssessment {
  verdict: SafetyVerdict;
  /**
   * Whether *full* play is permitted right now. Kept as the headline flag, but
   * it is no longer the whole story: a training zone allows exploring while
   * refusing battles and pickups, so gates must read the specific capability
   * they care about rather than this.
   */
  allowed: boolean;
  /** Battle actions: start a match, attack, cast an ability. */
  canBattle: boolean;
  /** Picking up a booster spawn found in the world. */
  canPickup: boolean;
  /**
   * Walking around, viewing your character, animations, personality lines.
   * Only false where the client must stop showing the world entirely.
   */
  canExplore: boolean;
  /** Headline shown in the AR overlay. Short — it is read at a glance. */
  headline: string;
  /** One line of plain guidance for a child. */
  advice: string;
  zone: { id: string; name: string; distanceM: number } | null;
  hazards: Array<{
    id: string;
    name: string;
    kind: (typeof schema.DANGER_KINDS)[number];
    distanceM: number;
    inside: boolean;
  }>;
  speedMps: number | null;
  /** Escalation level for the client overlay: 0 clear, 1 caution, 2 stop. */
  level: 0 | 1 | 2;
}

/* ------------------------------------------------------------------ hazards */

/** Active hazards near a point, nearest first. */
export async function hazardsNear(lat: number, lng: number, radiusM = HAZARD_SCAN_RADIUS_M) {
  const box = boundingBox({ lat, lng }, radiusM);
  const rows = await db
    .select()
    .from(schema.dangerZone)
    .where(
      and(
        eq(schema.dangerZone.isActive, true),
        gte(schema.dangerZone.centerLat, box.minLat),
        lte(schema.dangerZone.centerLat, box.maxLat),
        gte(schema.dangerZone.centerLng, box.minLng),
        lte(schema.dangerZone.centerLng, box.maxLng),
      ),
    );

  return rows
    .map((row) => {
      const d = distanceM({ lat, lng }, { lat: row.centerLat, lng: row.centerLng });
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        // Geometry is published on purpose: a client can only draw a no-go
        // boundary in the world if it knows where the boundary is. Hazards are
        // operator-curated public safety data, not player data.
        centerLat: row.centerLat,
        centerLng: row.centerLng,
        radiusM: row.radiusM,
        distanceM: Math.round(d),
        /** Inside the buffered hazard itself. */
        inside: d <= row.radiusM,
        /** Within one buffer-width of it — close enough to warn. */
        near: d <= row.radiusM * 2 + 10,
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** The approved safe zone containing a point, if any. */
export async function containingZone(lat: number, lng: number) {
  const rows = await db
    .select()
    .from(schema.zone)
    .where(
      and(
        eq(schema.zone.isActive, true),
        eq(schema.zone.review, "approved"),
        gte(schema.zone.centerLat, lat - 0.5),
        lte(schema.zone.centerLat, lat + 0.5),
      ),
    );
  let best: { id: string; name: string; distanceM: number } | null = null;
  for (const row of rows) {
    const d = distanceM({ lat, lng }, { lat: row.centerLat, lng: row.centerLng });
    if (d <= row.radiusM && (!best || d < best.distanceM)) {
      best = { id: row.id, name: row.name, distanceM: Math.round(d) };
    }
  }
  return best;
}

/**
 * The PENDING zone containing a point, if any.
 *
 * A pending zone is ground an importer proposed and no human has ruled on. It
 * is not playable, but it is also not unknown ground: telling a player "this
 * park is waiting on review" is a different message from "we have no idea what
 * is here", and it is what separates `outside_zone` from `training_zone`.
 */
export async function containingPendingZone(lat: number, lng: number) {
  const rows = await db
    .select()
    .from(schema.zone)
    .where(
      and(
        eq(schema.zone.review, "pending"),
        gte(schema.zone.centerLat, lat - 0.5),
        lte(schema.zone.centerLat, lat + 0.5),
      ),
    );
  let best: { id: string; name: string; distanceM: number } | null = null;
  for (const row of rows) {
    const d = distanceM({ lat, lng }, { lat: row.centerLat, lng: row.centerLng });
    if (d <= row.radiusM && (!best || d < best.distanceM)) {
      best = { id: row.id, name: row.name, distanceM: Math.round(d) };
    }
  }
  return best;
}

/* --------------------------------------------------------------- assessment */

/**
 * The single source of truth for "can this player act here". Every gated
 * action funnels through it so the rules cannot drift between features.
 */
export async function assess(input: {
  lat?: number | null;
  lng?: number | null;
  speedMps?: number | null;
}): Promise<SafetyAssessment> {
  const { lat, lng } = input;
  const speedMps = input.speedMps ?? null;

  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      verdict: "no_fix",
      allowed: false,
      canBattle: false,
      canPickup: false,
      canExplore: true,
      headline: "No GPS signal",
      advice: "Step into the open so your device can find you.",
      zone: null,
      hazards: [],
      speedMps,
      level: 1,
    };
  }

  const [hazards, zone] = await Promise.all([hazardsNear(lat, lng), containingZone(lat, lng)]);
  const inside = hazards.filter((h) => h.inside);
  const near = hazards.filter((h) => h.near && !h.inside);

  // Hazard veto first: a road inside a park is still a road.
  if (inside.length > 0) {
    const worst = inside[0]!;
    return {
      verdict: "hazard",
      allowed: false,
      canBattle: false,
      canPickup: false,
      // A hazard is the one case where the client stops showing the world:
      // the point is to get the phone out of the player's face.
      canExplore: false,
      headline: HAZARD_HEADLINE[worst.kind],
      advice: HAZARD_ADVICE[worst.kind],
      zone,
      hazards,
      speedMps,
      level: 2,
    };
  }

  if (speedMps != null && speedMps > MAX_PLAY_SPEED_MPS) {
    const vehicle = speedMps > VEHICLE_SPEED_MPS;
    return {
      verdict: "too_fast",
      allowed: false,
      canBattle: false,
      canPickup: false,
      // On foot but moving: the world stays on screen and the player keeps
      // exploring. In a vehicle it does not — the phone goes down.
      canExplore: !vehicle,
      headline: vehicle ? "You are moving too fast" : "Slow down",
      advice: vehicle
        ? "GeoFights does not work in a car, bus or train. Play on foot."
        : "Come to a stop to battle. You can walk around while exploring.",
      zone,
      hazards,
      speedMps,
      level: 2,
    };
  }

  if (!zone) {
    // No approved zone and no hazard underfoot. The remaining question is
    // whether this ground is *known* — a proposal waiting on review — or
    // unclassified. Unclassified ground becomes a training zone: the player
    // keeps their character, the animations and the voice, and loses combat
    // and pickups. That is friendlier than a dead screen and it still means
    // nothing that awards progression can happen off approved ground.
    const pending = await containingPendingZone(lat, lng);
    if (!pending) {
      return {
        verdict: "training_zone",
        allowed: false,
        canBattle: false,
        canPickup: false,
        canExplore: true,
        headline: "Training Area",
        advice:
          "Spar an opponent here — hits are real and a K.O. ends the round, but nothing is ranked. Find an approved play area for ranked battles and pickups, or suggest a nearby playground as a fighting ground.",
        zone: null,
        hazards,
        speedMps,
        level: 1,
      };
    }
    return {
      verdict: "outside_zone",
      allowed: false,
      canBattle: false,
      canPickup: false,
      canExplore: true,
      headline: "Outside a play area",
      advice: `${pending.name} is still waiting on review. Check your map for an approved area.`,
      zone: null,
      hazards,
      speedMps,
      level: 1,
    };
  }

  return {
    verdict: "ok",
    allowed: true,
    canBattle: true,
    canPickup: true,
    canExplore: true,
    headline: near.length > 0 ? `Careful — ${near[0]!.name} nearby` : `Playing in ${zone.name}`,
    advice:
      near.length > 0
        ? "Stay inside the play area and keep looking up."
        : "Look up often. Watch for people around you.",
    zone,
    hazards,
    speedMps,
    level: near.length > 0 ? 1 : 0,
  };
}

const HAZARD_HEADLINE: Record<(typeof schema.DANGER_KINDS)[number], string> = {
  road: "Stop — you are on a road",
  rail: "Stop — railway",
  water: "Stop — water edge",
  private: "Private property",
  cliff: "Stop — steep drop",
  other: "Unsafe area",
};

const HAZARD_ADVICE: Record<(typeof schema.DANGER_KINDS)[number], string> = {
  road: "Put your phone down and get back to the path.",
  rail: "Move away from the tracks now.",
  water: "Step back from the edge.",
  private: "This is not a public play area. Head back.",
  cliff: "Move away from the edge.",
  other: "Leave this area to keep playing.",
};

/** Record a safety decision. Fire-and-forget; never blocks gameplay. */
export async function logSafety(input: {
  playerId: string;
  kind: string;
  verdict: string;
  lat?: number | null;
  lng?: number | null;
  speedMps?: number | null;
  detail?: string;
}) {
  try {
    await db.insert(schema.safetyEvent).values({
      id: ids.safetyEvent(),
      playerId: input.playerId,
      kind: input.kind,
      verdict: input.verdict,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      speedMps: input.speedMps ?? null,
      detail: input.detail ?? null,
    });
  } catch {
    // Telemetry must never break play.
  }
}

/**
 * Assert a location is playable, or throw the reason. Used by pickup and
 * battle actions so a modified client cannot opt out of the safety layer.
 */
export async function requireSafe(input: {
  playerId: string;
  kind: string;
  lat?: number | null;
  lng?: number | null;
  speedMps?: number | null;
  /**
   * Which capability the caller actually needs. A training zone permits
   * exploring but not battling, so logging "blocked" on the strict `allowed`
   * flag would file a safety event every time a player simply walks around
   * unclassified ground.
   */
  need?: "battle" | "pickup" | "explore";
}) {
  const result = await assess(input);
  const permitted =
    input.need === "battle"
      ? result.canBattle
      : input.need === "pickup"
        ? result.canPickup
        : input.need === "explore"
          ? result.canExplore
          : result.allowed;
  if (!permitted) {
    await logSafety({
      playerId: input.playerId,
      kind: `block_${input.kind}`,
      verdict: result.verdict,
      lat: input.lat,
      lng: input.lng,
      speedMps: input.speedMps,
      detail: result.headline,
    });
  }
  return result;
}

/**
 * The error a blocked action throws. `reason` is the machine-readable branch
 * the client switches on: a training zone is a distinct product state (explore
 * freely, no combat) rather than a generic "unsafe", so it gets its own reason
 * instead of being folded into one.
 */
export function unsafeError(safety: SafetyAssessment) {
  return new ORPCError("BAD_REQUEST", {
    message: `${safety.headline}. ${safety.advice}`,
    data: {
      reason: safety.verdict === "training_zone" ? "training_zone" : "unsafe",
      verdict: safety.verdict,
      hazards: safety.hazards,
    },
  });
}

/**
 * Assert battles are permitted where the player is standing, or throw.
 *
 * Without coordinates there is nothing to judge, so the gate passes — matches
 * opened from a lobby list carry no fix and are already gated per action once
 * combat starts.
 */
export async function requireBattleGround(input: {
  playerId: string;
  kind: string;
  lat?: number | null;
  lng?: number | null;
  speedMps?: number | null;
}) {
  if (input.lat == null || input.lng == null) return null;
  const safety = await requireSafe({ ...input, need: "battle" });
  if (!safety.canBattle) throw unsafeError(safety);
  return safety;
}

/* ---------------------------------------------------- OSM import (proposals) */

export interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  center?: { lat: number; lon: number };
  lat?: number;
  lon?: number;
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  geometry?: { lat: number; lon: number }[];
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_AGENT = "GeoFights/1.0 (safety zone importer; https://geofights.com)";

/** Safe-zone candidates: open green space a child can stand in. */
const SAFE_QUERY = `
  way["leisure"="park"];
  way["leisure"="playground"];
  way["leisure"="recreation_ground"];
  way["leisure"="pitch"];
  way["landuse"="grass"];
  way["landuse"="village_green"];
  way["natural"="beach"];
  way["natural"="wood"];
  way["leisure"="nature_reserve"];
`;

/** Hazard candidates: anything that hurts a distracted 10 year old. */
const DANGER_QUERY = `
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service)$"];
  way["railway"~"^(rail|light_rail|subway|tram)$"];
  way["natural"="water"];
  way["waterway"~"^(river|canal|stream)$"];
  way["landuse"~"^(industrial|military|quarry)$"];
`;

/**
 * Overpass answers a `bb` request with bounds and no `center`, and a `center`
 * request with no bounds. Ways therefore need their midpoint derived; nodes
 * already carry lat/lon.
 */
export function elementCenter(el: OverpassElement) {
  const lat = el.center?.lat ?? el.lat ?? (el.bounds && (el.bounds.minlat + el.bounds.maxlat) / 2);
  const lng = el.center?.lon ?? el.lon ?? (el.bounds && (el.bounds.minlon + el.bounds.maxlon) / 2);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

export function radiusFromBounds(el: OverpassElement, fallback: number) {
  if (!el.bounds) return fallback;
  const { minlat, minlon, maxlat, maxlon } = el.bounds;
  const h = distanceM({ lat: minlat, lng: minlon }, { lat: maxlat, lng: minlon });
  const w = distanceM({ lat: minlat, lng: minlon }, { lat: minlat, lng: maxlon });
  // Inscribed radius, so a zone never claims more ground than it covers.
  return Math.max(30, Math.round(Math.min(h, w) / 2));
}

function hazardKind(tags: Record<string, string>): (typeof schema.DANGER_KINDS)[number] {
  if (tags.highway) return "road";
  if (tags.railway) return "rail";
  if (tags.natural === "water" || tags.waterway) return "water";
  if (tags.landuse) return "private";
  return "other";
}

/**
 * `bb` returns each way's bounding box (enough to size a zone), `geom` returns
 * its full node list (needed to trace a road rather than guess its midpoint).
 * Overpass will not return both in one statement.
 */
export async function overpass(
  query: string,
  lat: number,
  lng: number,
  radiusM: number,
  mode: "bb" | "geom" = "bb",
) {
  return overpassRequest(
    `[out:json][timeout:25];(${query.replace(/;/g, `(around:${radiusM},${lat},${lng});`)});out tags ${mode};`,
  );
}

/** One Overpass QL request, with the agent string and a single busy retry. */
export async function overpassRequest(body: string): Promise<OverpassElement[]> {
  // The public instance sheds load with 429/504 or a 200 carrying an HTML
  // "too busy" page; one short retry clears most of those.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // Overpass answers 406 to anonymous clients; its usage policy wants a
        // contactable agent string on every request.
        "user-agent": OVERPASS_AGENT,
      },
      body: `data=${encodeURIComponent(body)}`,
    });
    const text = await res.text().catch(() => "");
    const busy =
      res.status === 429 || res.status === 504 || (res.ok && !text.trimStart().startsWith("{"));
    if (busy && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    if (!res.ok || busy) {
      throw new ORPCError("BAD_GATEWAY", {
        message: `OpenStreetMap is busy right now (${res.status}). Try again in a minute.`,
      });
    }
    const json = JSON.parse(text) as { elements?: OverpassElement[] };
    return json.elements ?? [];
  }
}

/** Largest radius a single hazard scan covers. */
export const HAZARD_SCAN_MAX_M = 1_500;

/**
 * Pull roads, rail and water around a point into `danger_zone`, nearest ways
 * first so the per-scan cap never drops the street beside a playground in
 * favour of one a kilometre away. Run before any zone goes live: a zone in an
 * area nobody has scanned would have no hazards protecting it.
 */
export async function scanHazardsAround(lat: number, lng: number, radiusM: number) {
  const scanRadiusM = Math.min(Math.max(100, Math.round(radiusM)), HAZARD_SCAN_MAX_M);
  const ways = await overpass(DANGER_QUERY, lat, lng, scanRadiusM, "geom");
  const nearest = (el: OverpassElement) => {
    const pts = el.geometry?.length ? el.geometry : [];
    let best = Number.POSITIVE_INFINITY;
    for (const g of pts) best = Math.min(best, distanceM({ lat, lng }, { lat: g.lat, lng: g.lon }));
    if (best === Number.POSITIVE_INFINITY) {
      const c = elementCenter(el);
      if (c) best = distanceM({ lat, lng }, c);
    }
    return best;
  };
  const sorted = ways
    .map((el) => ({ el, d: nearest(el) }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.el);
  const inserted = await insertHazards(sorted);
  return {
    scanRadiusM,
    waysFound: ways.length,
    hazardsAdded: inserted.length,
    /** The zone reaches past what one scan covers; outer hazards may be missing. */
    partial: radiusM > HAZARD_SCAN_MAX_M,
  };
}

/**
 * Scan an area of OpenStreetMap and file proposals. Safe zones land as
 * `pending` for review; hazards are inserted active immediately, because a
 * false hazard only costs playable ground while a missed one costs a child.
 */
export async function importFromOsm(input: {
  lat: number;
  lng: number;
  radiusM?: number;
  limit?: number;
}) {
  const radiusM = input.radiusM ?? 1500;
  const limit = input.limit ?? 40;

  const [safeEls, dangerEls] = await Promise.all([
    overpass(SAFE_QUERY, input.lat, input.lng, radiusM, "bb"),
    overpass(DANGER_QUERY, input.lat, input.lng, radiusM, "geom"),
  ]);

  const proposed = await insertZoneProposals(safeEls.slice(0, limit));
  const hazards = await insertHazards(dangerEls.slice(0, limit * 4));
  return { scannedAround: { lat: input.lat, lng: input.lng, radiusM }, proposed, hazards };
}

async function insertZoneProposals(elements: OverpassElement[]) {
  const candidates = elements
    .map((el) => {
      const point = elementCenter(el);
      if (!point) return null;
      const { lat, lng } = point;
      const tags = el.tags ?? {};
      const terrain = tags.leisure ?? tags.natural ?? tags.landuse ?? "open ground";
      return {
        osmRef: `${el.type}/${el.id}`,
        name: tags.name ?? `Unnamed ${terrain.replace(/_/g, " ")}`,
        terrain: terrain.replace(/_/g, " "),
        lat,
        lng,
        radiusM: radiusFromBounds(el, 120),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (candidates.length === 0) return [];
  const existing = await db
    .select({ osmRef: schema.zone.osmRef })
    .from(schema.zone)
    .where(
      inArray(
        schema.zone.osmRef,
        candidates.map((c) => c.osmRef),
      ),
    );
  const seen = new Set(existing.map((e) => e.osmRef));
  const fresh = candidates.filter((c) => !seen.has(c.osmRef));
  if (fresh.length === 0) return [];

  return db
    .insert(schema.zone)
    .values(
      fresh.map((c) => ({
        id: ids.zone(),
        name: c.name,
        description: `Proposed from OpenStreetMap (${c.terrain}). Needs operator review before play.`,
        centerLat: c.lat,
        centerLng: c.lng,
        radiusM: c.radiusM,
        spawnWeight: 1,
        terrain: c.terrain,
        // Dark until a human says otherwise.
        isActive: true,
        review: "pending" as const,
        source: "osm" as const,
        osmRef: c.osmRef,
      })),
    )
    .returning();
}

/** Spacing between traced hazard points; tighter than a road's 20 m radius so
 * the circles overlap into a continuous barrier instead of a dotted line. */
const HAZARD_TRACE_SPACING_M = 25;
const MAX_TRACE_POINTS_PER_WAY = 80;
const MAX_HAZARDS_PER_SCAN = 2_500;
const DB_CHUNK = 150;

function hazardRadius(kind: (typeof schema.DANGER_KINDS)[number], el: OverpassElement) {
  if (kind === "road") return 20;
  if (kind === "rail") return 40;
  return radiusFromBounds(el, 25);
}

/**
 * Walk a way's node list and emit a point every `HAZARD_TRACE_SPACING_M`. A
 * road collapsed to its midpoint would leave the rest of the street playable,
 * which is exactly the failure this module exists to prevent.
 */
function traceWay(el: OverpassElement) {
  const geom = el.geometry?.filter((g) => g?.lat != null && g?.lon != null) ?? [];
  if (geom.length < 2) {
    const point = elementCenter(el);
    return point ? [point] : [];
  }
  const points: { lat: number; lng: number }[] = [];
  let carried = 0;
  points.push({ lat: geom[0]!.lat, lng: geom[0]!.lon });
  for (let i = 1; i < geom.length; i++) {
    const a = { lat: geom[i - 1]!.lat, lng: geom[i - 1]!.lon };
    const b = { lat: geom[i]!.lat, lng: geom[i]!.lon };
    const segment = distanceM(a, b);
    if (segment === 0) continue;
    let travelled = HAZARD_TRACE_SPACING_M - carried;
    while (travelled < segment && points.length < MAX_TRACE_POINTS_PER_WAY) {
      const t = travelled / segment;
      points.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      travelled += HAZARD_TRACE_SPACING_M;
    }
    carried = (carried + segment) % HAZARD_TRACE_SPACING_M;
    if (points.length >= MAX_TRACE_POINTS_PER_WAY) break;
  }
  return points;
}

async function insertHazards(elements: OverpassElement[]) {
  const candidates: {
    osmRef: string;
    name: string;
    kind: (typeof schema.DANGER_KINDS)[number];
    lat: number;
    lng: number;
    radiusM: number;
  }[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const kind = hazardKind(tags);
    const name = tags.name ?? DEFAULT_HAZARD_NAME[kind];
    const radiusM = hazardRadius(kind, el);
    // Areas (water, restricted land) are one circle; lines are traced.
    const points = kind === "water" || kind === "private" ? traceWay(el).slice(0, 1) : traceWay(el);
    points.forEach((point, index) => {
      if (candidates.length >= MAX_HAZARDS_PER_SCAN) return;
      candidates.push({
        osmRef: `${el.type}/${el.id}#${index}`,
        name,
        kind,
        lat: point.lat,
        lng: point.lng,
        radiusM,
      });
    });
    if (candidates.length >= MAX_HAZARDS_PER_SCAN) break;
  }

  if (candidates.length === 0) return [];

  // Chunked, because SQLite caps the number of bound parameters per statement.
  const seen = new Set<string>();
  for (let i = 0; i < candidates.length; i += DB_CHUNK) {
    const refs = candidates.slice(i, i + DB_CHUNK).map((c) => c.osmRef);
    const existing = await db
      .select({ osmRef: schema.dangerZone.osmRef })
      .from(schema.dangerZone)
      .where(inArray(schema.dangerZone.osmRef, refs));
    for (const row of existing) if (row.osmRef) seen.add(row.osmRef);
  }
  const fresh = candidates.filter((c) => !seen.has(c.osmRef));
  if (fresh.length === 0) return [];

  const inserted: (typeof schema.dangerZone.$inferSelect)[] = [];
  for (let i = 0; i < fresh.length; i += DB_CHUNK) {
    const rows = await db
      .insert(schema.dangerZone)
      .values(
        fresh.slice(i, i + DB_CHUNK).map((c) => ({
          id: ids.dangerZone(),
          name: c.name,
          kind: c.kind,
          centerLat: c.lat,
          centerLng: c.lng,
          radiusM: c.radiusM,
          source: "osm" as const,
          osmRef: c.osmRef,
        })),
      )
      .returning();
    inserted.push(...rows);
  }
  return inserted;
}

const DEFAULT_HAZARD_NAME: Record<(typeof schema.DANGER_KINDS)[number], string> = {
  road: "Road",
  rail: "Railway",
  water: "Water",
  private: "Restricted land",
  cliff: "Steep drop",
  other: "Hazard",
};

/* ----------------------------------------------------------------- review */

export async function reviewZone(input: {
  zoneId: string;
  review: (typeof schema.ZONE_REVIEW)[number];
  note?: string;
}) {
  if (input.review === "approved") {
    // An under-13's suggestion is the parent's call, not ours to wave through.
    const [waiting] = await db
      .select({ id: schema.zoneSuggestion.id })
      .from(schema.zoneSuggestion)
      .where(and(eq(schema.zoneSuggestion.zoneId, input.zoneId), eq(schema.zoneSuggestion.status, "awaiting_parent")))
      .limit(1);
    if (waiting) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message: "A parent still has to approve this ground. It can't be approved until they do.",
      });
    }
  }
  const [row] = await db
    .update(schema.zone)
    .set({ review: input.review, reviewNote: input.note ?? null, reviewedAt: new Date() })
    .where(eq(schema.zone.id, input.zoneId))
    .returning();
  return row ?? null;
}

/** Zones awaiting a human decision, closest to review-worthy first. */
export async function pendingZones(limit = 100) {
  return db
    .select()
    .from(schema.zone)
    .where(eq(schema.zone.review, "pending"))
    .orderBy(schema.zone.createdAt)
    .limit(limit);
}

/**
 * One traced road becomes dozens of hazard points, so the console lists
 * features rather than points: every point sharing an OSM ref is folded into a
 * single row keyed by that ref. Manual hazards are their own feature.
 */
const FEATURE_KEY = sql<string>`
  case
    when ${schema.dangerZone.osmRef} is null then ${schema.dangerZone.id}
    when instr(${schema.dangerZone.osmRef}, '#') > 0
      then substr(${schema.dangerZone.osmRef}, 1, instr(${schema.dangerZone.osmRef}, '#') - 1)
    else ${schema.dangerZone.osmRef}
  end`;

export async function listHazards(limit = 300) {
  return db
    .select({
      // The delete handle: a hazard id for manual entries, an OSM ref for traced ones.
      id: sql<string>`${FEATURE_KEY}`.as("feature_key"),
      name: sql<string>`min(${schema.dangerZone.name})`.as("name"),
      kind: schema.dangerZone.kind,
      source: schema.dangerZone.source,
      points: sql<number>`count(*)`.as("points"),
      centerLat: sql<number>`avg(${schema.dangerZone.centerLat})`.as("center_lat"),
      centerLng: sql<number>`avg(${schema.dangerZone.centerLng})`.as("center_lng"),
      radiusM: sql<number>`max(${schema.dangerZone.radiusM})`.as("radius_m"),
      createdAt: sql<number>`max(${schema.dangerZone.createdAt})`.as("created_at"),
    })
    .from(schema.dangerZone)
    .where(eq(schema.dangerZone.isActive, true))
    .groupBy(FEATURE_KEY, schema.dangerZone.kind, schema.dangerZone.source)
    .orderBy(sql`max(${schema.dangerZone.createdAt}) desc`)
    .limit(limit);
}

export async function createHazard(input: {
  name: string;
  kind: (typeof schema.DANGER_KINDS)[number];
  lat: number;
  lng: number;
  radiusM: number;
}) {
  const [row] = await db
    .insert(schema.dangerZone)
    .values({
      id: ids.dangerZone(),
      name: input.name,
      kind: input.kind,
      centerLat: input.lat,
      centerLng: input.lng,
      radiusM: input.radiusM,
      source: "manual",
    })
    .returning();
  return row!;
}

/**
 * Removes a hazard by id, or every traced point of an OSM feature by its ref —
 * deleting one point of a road would reopen a 25 m hole in the barrier.
 */
export async function deleteHazard(idOrFeature: string) {
  const removed = await db
    .delete(schema.dangerZone)
    .where(or(eq(schema.dangerZone.id, idOrFeature), eq(FEATURE_KEY, idOrFeature)))
    .returning({ id: schema.dangerZone.id });
  return { id: idOrFeature, removed: removed.length };
}

/** Recent safety blocks, for the console's safety tab. */
export async function recentSafetyEvents(limit = 60) {
  return db
    .select({
      event: schema.safetyEvent,
      username: schema.player.username,
    })
    .from(schema.safetyEvent)
    .leftJoin(schema.player, eq(schema.player.id, schema.safetyEvent.playerId))
    .orderBy(sql`${schema.safetyEvent.createdAt} desc`)
    .limit(limit);
}
