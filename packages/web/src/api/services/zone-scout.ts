import { ORPCError } from "@orpc/server";
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { boundingBox, distanceM } from "../lib/geo";
import { createZone } from "./nature";
import {
  type OverpassElement,
  elementCenter,
  overpass,
  radiusFromBounds,
  scanHazardsAround,
} from "./safety";

/**
 * Operator tooling for placing new zones: where players signed up, which
 * playgrounds and parks OpenStreetMap knows about around there, and what the
 * hazard layer already says about each one. Nothing here is visible to
 * players; the only write is `createZoneWithHazardScan`.
 */

/** Smallest radius `admin.createZone` accepts. */
const MIN_ZONE_RADIUS_M = 50;
/** Parks can be huge; a suggestion never claims more than this. */
const MAX_SUGGESTED_RADIUS_M = 600;
/** Extra ring scanned for hazards beyond a zone's edge. */
const HAZARD_MARGIN_M = 60;
/** Hazards closer than this to a candidate mean the area has been scanned. */
const SCANNED_NEAR_M = 400;

const PLAYGROUND_QUERY = `nwr["leisure"="playground"];`;
const PARK_QUERY = `way["leisure"="park"];relation["leisure"="park"];`;

type CandidateKind = "playground" | "park";

/** Sign-up locations, already coarsened to 2 dp (~1 km) at registration. */
export async function signupAreas() {
  const minor = sql<number>`sum(case when ${schema.player.ageBand} in ('under13','13to15','16to17') then 1 else 0 end)`;
  const rows = await db
    .select({
      lat: schema.player.homeLat,
      lng: schema.player.homeLng,
      players: sql<number>`count(*)`,
      minors: minor,
    })
    .from(schema.player)
    .where(and(isNotNull(schema.player.homeLat), isNotNull(schema.player.homeLng)))
    .groupBy(schema.player.homeLat, schema.player.homeLng)
    .orderBy(sql`count(*) desc`)
    .limit(50);
  return rows.map((r) => ({
    lat: r.lat!,
    lng: r.lng!,
    players: Number(r.players),
    minors: Number(r.minors ?? 0),
  }));
}

/** Hazard rows inside a box, for drawing on the operator map. */
export async function hazardsInArea(lat: number, lng: number, radiusM: number) {
  const box = boundingBox({ lat, lng }, radiusM);
  return db
    .select({
      id: schema.dangerZone.id,
      name: schema.dangerZone.name,
      kind: schema.dangerZone.kind,
      centerLat: schema.dangerZone.centerLat,
      centerLng: schema.dangerZone.centerLng,
      radiusM: schema.dangerZone.radiusM,
    })
    .from(schema.dangerZone)
    .where(
      and(
        eq(schema.dangerZone.isActive, true),
        gte(schema.dangerZone.centerLat, box.minLat),
        lte(schema.dangerZone.centerLat, box.maxLat),
        gte(schema.dangerZone.centerLng, box.minLng),
        lte(schema.dangerZone.centerLng, box.maxLng),
      ),
    )
    .limit(4_000);
}

function contains(el: OverpassElement, point: { lat: number; lng: number }) {
  const b = el.bounds;
  if (!b) return false;
  return point.lat >= b.minlat && point.lat <= b.maxlat && point.lng >= b.minlon && point.lng <= b.maxlon;
}

/**
 * Live OpenStreetMap lookup. Read-only: candidates are returned, never
 * inserted, so browsing the map leaves no rows behind.
 */
export async function playgroundsNear(input: {
  lat: number;
  lng: number;
  radiusM: number;
  includeParks: boolean;
}) {
  // Parks are always fetched: an unnamed playground is named after the park
  // it sits in, which is how a parent would describe where it is.
  const elements = await overpass(PLAYGROUND_QUERY + PARK_QUERY, input.lat, input.lng, input.radiusM, "bb");
  const parks = elements.filter((el) => el.tags?.leisure === "park");
  const origin = { lat: input.lat, lng: input.lng };

  const raw = elements
    .filter((el) => input.includeParks || el.tags?.leisure === "playground")
    .map((el) => {
      const point = elementCenter(el);
      if (!point) return null;
      const tags = el.tags ?? {};
      const kind: CandidateKind = tags.leisure === "park" ? "park" : "playground";
      const sizeM = radiusFromBounds(el, 15);
      const parent = kind === "playground" ? parks.find((p) => p.tags?.name && contains(p, point)) : undefined;
      const name =
        tags.name ??
        (parent?.tags?.name ? `Playground in ${parent.tags.name}` : undefined) ??
        (tags["addr:street"] ? `Playground on ${tags["addr:street"]}` : undefined) ??
        (kind === "park" ? "Unnamed park" : "Unnamed playground");
      return {
        osmRef: `${el.type}/${el.id}`,
        kind,
        name: name.slice(0, 60),
        named: Boolean(tags.name),
        lat: point.lat,
        lng: point.lng,
        sizeM,
        suggestedRadiusM: Math.min(MAX_SUGGESTED_RADIUS_M, Math.max(MIN_ZONE_RADIUS_M, sizeM)),
        distanceM: Math.round(distanceM(origin, point)),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => (a.kind === b.kind ? a.distanceM - b.distanceM : a.kind === "playground" ? -1 : 1))
    .slice(0, 80);

  if (raw.length === 0) return { center: origin, radiusM: input.radiusM, candidates: [] };

  // Zones already covering a candidate, matched by OSM id or by overlap.
  const reach = input.radiusM + MAX_SUGGESTED_RADIUS_M;
  const box = boundingBox(origin, reach);
  const [zones, linked, hazards] = await Promise.all([
    db
      .select()
      .from(schema.zone)
      .where(
        and(
          gte(schema.zone.centerLat, box.minLat),
          lte(schema.zone.centerLat, box.maxLat),
          gte(schema.zone.centerLng, box.minLng),
          lte(schema.zone.centerLng, box.maxLng),
        ),
      ),
    db
      .select()
      .from(schema.zone)
      .where(inArray(schema.zone.osmRef, raw.map((c) => c.osmRef))),
    hazardsInArea(input.lat, input.lng, reach),
  ]);

  const candidates = raw.map((c) => {
    const byRef = linked.find((z) => z.osmRef === c.osmRef);
    const overlap = zones.find((z) => distanceM(c, { lat: z.centerLat, lng: z.centerLng }) <= z.radiusM);
    const existing = byRef ?? overlap;
    const kinds = new Map<string, number>();
    let nearestHazardM = Number.POSITIVE_INFINITY;
    for (const h of hazards) {
      const d = distanceM(c, { lat: h.centerLat, lng: h.centerLng });
      nearestHazardM = Math.min(nearestHazardM, d);
      if (d <= c.suggestedRadiusM + h.radiusM) kinds.set(h.kind, (kinds.get(h.kind) ?? 0) + 1);
    }
    return {
      ...c,
      existingZone: existing
        ? {
            id: existing.id,
            name: existing.name,
            review: existing.review,
            linked: Boolean(byRef),
          }
        : null,
      /** Hazard points whose buffer reaches into the suggested circle. */
      hazardsInside: Object.fromEntries(kinds) as Record<string, number>,
      /** False when no hazard has ever been imported nearby — the layer is blind here. */
      hazardsScanned: nearestHazardM <= SCANNED_NEAR_M,
    };
  });

  return { center: origin, radiusM: input.radiusM, candidates };
}

/**
 * Create a zone only after the hazard layer around it is filled in. If
 * OpenStreetMap is unreachable the zone is not created at all: a zone that
 * goes live with no roads or water mapped around it is the failure the whole
 * safety layer exists to prevent.
 */
export async function createZoneWithHazardScan(input: {
  name: string;
  description?: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  spawnWeight: number;
  terrain?: string;
  osmRef?: string;
}) {
  if (input.osmRef) {
    const [dupe] = await db
      .select({ id: schema.zone.id, name: schema.zone.name, review: schema.zone.review })
      .from(schema.zone)
      .where(eq(schema.zone.osmRef, input.osmRef));
    if (dupe) {
      throw new ORPCError("CONFLICT", {
        message: `"${dupe.name}" is already a zone (${dupe.review}). Review it in the Safety tab instead.`,
      });
    }
  }

  const scan = await scanHazardsAround(input.centerLat, input.centerLng, input.radiusM + HAZARD_MARGIN_M);
  const zone = await createZone(input);

  const near = await hazardsInArea(zone.centerLat, zone.centerLng, zone.radiusM + 60);
  const overlapping = near.filter(
    (h) =>
      distanceM({ lat: zone.centerLat, lng: zone.centerLng }, { lat: h.centerLat, lng: h.centerLng }) <=
      zone.radiusM + h.radiusM,
  );
  const overlapKinds: Record<string, number> = {};
  for (const h of overlapping) overlapKinds[h.kind] = (overlapKinds[h.kind] ?? 0) + 1;

  return { ...zone, hazardScan: { ...scan, overlapping: overlapping.length, overlapKinds } };
}
