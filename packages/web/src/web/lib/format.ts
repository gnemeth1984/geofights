/** Shared display helpers for the console — no formatting logic in components. */

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

const numberFmt = new Intl.NumberFormat("en-US");

export function num(value: number | null | undefined) {
  return numberFmt.format(Number(value ?? 0));
}

/** In-game currency, always prefixed so it is never mistaken for XP. */
export function coins(value: number | null | undefined) {
  return `⌁ ${num(value)}`;
}

export function pct(value: number | null | undefined) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

export function dateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "4m ago" / "in 2h" — compact enough for a table cell. */
export function relative(value: string | Date | null | undefined) {
  if (!value) return "never";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "never";
  const deltaMs = date.getTime() - Date.now();
  const abs = Math.abs(deltaMs);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 1000],
    ["minute", 60_000],
    ["hour", 3_600_000],
    ["day", 86_400_000],
  ];
  let unit: Intl.RelativeTimeFormatUnit = "day";
  let size = 86_400_000;
  for (const [candidate, ms] of units) {
    if (abs < ms * 60 || candidate === "day") {
      unit = candidate;
      size = ms;
      if (abs < ms * 60) break;
    }
  }
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
  return rtf.format(Math.round(deltaMs / size), unit);
}

export function duration(ms: number) {
  if (ms >= 86_400_000) return `${Math.round(ms / 86_400_000)}d`;
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`;
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

/** Cron/job detail columns store JSON or a raw error string. */
export function compactJson(value: string | null | undefined, max = 90) {
  if (!value) return "—";
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function titleCase(value: string) {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function errorMessage(error: unknown) {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  return String(error);
}
