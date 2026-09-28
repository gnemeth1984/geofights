/** Geo helpers for the GPS nature system and AR combat range checks. */

const EARTH_RADIUS_M = 6_371_000;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in metres between two coordinates. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Uniformly random point inside a circle — used to scatter daily spawns. */
export function randomPointInRadius(center: LatLng, radiusM: number): LatLng {
  const r = radiusM * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  const dLat = (r * Math.cos(theta)) / EARTH_RADIUS_M;
  const dLng = (r * Math.sin(theta)) / (EARTH_RADIUS_M * Math.cos(toRad(center.lat)));
  return { lat: center.lat + toDeg(dLat), lng: center.lng + toDeg(dLng) };
}

/** Coarse bounding box for pre-filtering rows before the exact distance check. */
export function boundingBox(center: LatLng, radiusM: number) {
  const latDelta = toDeg(radiusM / EARTH_RADIUS_M);
  const lngDelta = toDeg(radiusM / (EARTH_RADIUS_M * Math.cos(toRad(center.lat))));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}
