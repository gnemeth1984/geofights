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
};
