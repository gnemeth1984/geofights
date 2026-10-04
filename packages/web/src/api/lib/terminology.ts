/**
 * GeoFights fighters are "characters" — procedural creatures of any shape —
 * never "robots". Generated copy is scrubbed so a model slip never reaches a
 * player.
 */
const SWAPS: Array<[RegExp, string]> = [
  [/\brobots\b/gi, "characters"],
  [/\brobotic\b/gi, "mechanical"],
  [/\brobot\b/gi, "character"],
  [/\b(?:war)?bots\b/gi, "characters"],
  [/\b(?:war)?bot\b/gi, "character"],
];

function matchCase(source: string, replacement: string) {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] === source[0]?.toUpperCase()) return replacement[0]!.toUpperCase() + replacement.slice(1);
  return replacement;
}

export function characterWording(text: string): string;
export function characterWording(text: string | null): string | null;
export function characterWording(text: string | null): string | null {
  if (text == null) return text;
  return SWAPS.reduce((out, [pattern, word]) => out.replace(pattern, (hit) => matchCase(hit, word)), text);
}
