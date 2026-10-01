/**
 * Quick chat — the only thing an under-13 can say or hear.
 *
 * Every phrase is picked so it cannot be bent into a request for contact
 * details, a location outside the game's own approved parks, or a private
 * meeting. There is no "where do you live", no "how old are you", no free
 * slots to fill in. Ids are stored, not the words, so the wording can be fixed
 * or translated later without rewriting anyone's history.
 */

export const CHAT_PRESETS = {
  gg: "Good game!",
  nice_hit: "Nice hit!",
  rematch: "Rematch?",
  ready: "I'm ready.",
  wait: "Wait for me.",
  on_my_way: "On my way.",
  at_the_park: "I'm at the park.",
  cant_now: "Can't play right now.",
  later: "Later!",
  help: "Help me out?",
  thanks: "Thanks!",
  sorry: "Sorry!",
  nice_booster: "Nice booster.",
  good_luck: "Good luck.",
  team_up: "Team up?",
  training: "I'm training.",
} as const;

export type ChatPresetId = keyof typeof CHAT_PRESETS;

export const CHAT_PRESET_IDS = Object.keys(CHAT_PRESETS) as ChatPresetId[];

export function isChatPreset(value: string): value is ChatPresetId {
  return Object.hasOwn(CHAT_PRESETS, value);
}

export function presetText(id: ChatPresetId): string {
  return CHAT_PRESETS[id];
}
