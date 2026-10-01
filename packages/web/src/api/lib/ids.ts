/** Short, sortable, collision-safe ids: `pfx_<base36 time><random>`. */
export function newId(prefix: string) {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${rand}`;
}

export const ids = {
  player: () => newId("plr"),
  avatar: () => newId("avt"),
  booster: () => newId("bst"),
  boosterInstance: () => newId("bsi"),
  item: () => newId("itm"),
  zone: () => newId("zon"),
  spawnPoint: () => newId("spn"),
  match: () => newId("mch"),
  matchPlayer: () => newId("mpl"),
  battleState: () => newId("bst"),
  battleEvent: () => newId("evt"),
  listing: () => newId("lst"),
  transaction: () => newId("trx"),
  cronRun: () => newId("crn"),
  leaderboard: () => newId("lbd"),
  dangerZone: () => newId("dgz"),
  safetyEvent: () => newId("sfe"),
  forfeit: () => newId("frf"),
  parentConsent: () => newId("pcs"),
  friendLink: () => newId("frd"),
  team: () => newId("tem"),
  teamMember: () => newId("tmb"),
  chatMessage: () => newId("msg"),
  meetup: () => newId("mtp"),
  meetupAttendee: () => newId("mta"),
  report: () => newId("rpt"),
  block: () => newId("blk"),
  moderationAction: () => newId("mod"),
};

/** No I, L, O, 0 or 1 — nothing a code can be misread as. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Human-transcribable share code — the invite code a player reads out or shows
 * as a QR, and the team join code. No I/O/0/1, so it survives being copied off
 * a phone screen by a 10-year-old.
 */
export function newShareCode(length = 8) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Normalises whatever the player typed: case, spaces and the dash people add
 * in the middle. Confusable characters are not in the alphabet at all, so
 * there is nothing to guess at here.
 */
export function normaliseShareCode(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
