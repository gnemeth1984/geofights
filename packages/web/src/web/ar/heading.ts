/**
 * Compass heading, plus the iOS permission dance.
 *
 * World-scale AR needs to know which way is north, or every GPS-anchored
 * marker sits at the wrong bearing. Three sources, best first:
 *   1. `webkitCompassHeading` (iOS) — true heading, degrees clockwise from north.
 *   2. `deviceorientationabsolute` / `absolute: true` — `360 - alpha`.
 *   3. The GPS course from a moving fix — only valid while actually walking.
 *
 * iOS requires a user gesture to unlock motion sensors, so `requestMotionAccess`
 * must be called from a click handler.
 */

export type HeadingSource = "compass" | "absolute" | "gps" | "manual" | "none";

export type HeadingSample = { headingDeg: number; source: HeadingSource; accuracyDeg: number | null };

type IOSDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

type CompassEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};

export function motionPermissionNeeded(): boolean {
  if (typeof DeviceOrientationEvent === "undefined") return false;
  return typeof (DeviceOrientationEvent as IOSDeviceOrientationEvent).requestPermission === "function";
}

export async function requestMotionAccess(): Promise<boolean> {
  const api = DeviceOrientationEvent as IOSDeviceOrientationEvent | undefined;
  if (!api || typeof api.requestPermission !== "function") return true;
  try {
    return (await api.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/** Subscribe to heading updates. Returns an unsubscribe function. */
export function watchHeading(onSample: (sample: HeadingSample) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handle = (event: Event) => {
    const orientation = event as CompassEvent;
    const compass = orientation.webkitCompassHeading;
    if (typeof compass === "number" && Number.isFinite(compass)) {
      onSample({
        headingDeg: (compass + 360) % 360,
        source: "compass",
        accuracyDeg: orientation.webkitCompassAccuracy ?? null,
      });
      return;
    }
    if (orientation.absolute && typeof orientation.alpha === "number") {
      onSample({
        headingDeg: (360 - orientation.alpha) % 360,
        source: "absolute",
        accuracyDeg: null,
      });
    }
  };

  window.addEventListener("deviceorientationabsolute", handle, true);
  window.addEventListener("deviceorientation", handle, true);
  return () => {
    window.removeEventListener("deviceorientationabsolute", handle, true);
    window.removeEventListener("deviceorientation", handle, true);
  };
}

export const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function compassPoint(headingDeg: number): string {
  const index = Math.round(((headingDeg % 360) + 360) % 360 / 45) % 8;
  return COMPASS_POINTS[index]!;
}
