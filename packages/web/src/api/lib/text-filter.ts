/**
 * The one filter every piece of player-written text passes through: chat
 * messages, usernames, team names, meet-up titles.
 *
 * Two jobs, and they are different problems:
 *
 *   1. **Personal information.** This is the one that actually matters in a
 *      game played by children in real parks. Phone numbers, emails, handles
 *      on other platforms, street addresses and links are redacted outright —
 *      a nine-year-old giving out their Snapchat to someone they met at a
 *      playground is the exact failure mode the whole design is arranged to
 *      prevent. Redaction is deliberately blunt and over-eager.
 *   2. **Abuse.** A word list gets the obvious cases and nothing more. It is a
 *      speed bump, not a solution: the real protection is that free text only
 *      exists between accepted friends and team-mates of the same age tier,
 *      that every message can be reported, and that three reporters hide an
 *      account automatically. This file never pretends otherwise.
 *
 * Nothing here is a moral judgement about a word — it decides whether a
 * message is delivered as typed, delivered redacted, or refused, and it
 * records which so the moderation queue can see the pattern.
 */

export type FilterVerdict = {
  /** What should be stored and shown. */
  text: string;
  /** True when the text was rewritten. */
  redacted: boolean;
  /** True when the message should not be sent at all. */
  blocked: boolean;
  /** Machine-readable reasons, for the moderation queue. */
  reasons: FilterReason[];
};

export type FilterReason =
  | "phone"
  | "email"
  | "url"
  | "handle"
  | "address"
  | "profanity"
  | "slur"
  | "sexual"
  | "meeting"
  | "empty"
  | "too_long";

const REDACTION = "[removed]";

/* ------------------------------------------------------- personal info nets */

/** 7+ digits with any of the separators people use, including spelled spaces. */
const PHONE = /(?:\+?\d[\s().-]?){7,}\d/g;
const EMAIL = /[\w.+-]+\s*(?:@|\(at\)|\sat\s)\s*[\w-]+\s*(?:\.|\(dot\)|\sdot\s)\s*[a-z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|co|uk|hu|de|gg|me|tv)\b/gi;
/** @name, and "my snap is x" style platform handoffs. */
const HANDLE = /(?:^|\s)@[\w.]{2,}/g;
const PLATFORM =
  /\b(?:snap(?:chat)?|insta(?:gram)?|tiktok|whats\s?app|telegram|discord|roblox|kik|skype|facebook|messenger)\b/gi;
/** "12 Oak Street", "flat 3 Rose Road" — a number followed by a street word. */
const ADDRESS =
  /\b\d{1,5}\s+[\w\s]{2,24}\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|close|court|utca|ut|tér)\b/gi;

/**
 * Attempts to arrange a private meeting away from the game's own meet-ups.
 * Not redacted — flagged, because the message still needs a human to read it.
 */
const MEETING =
  /\b(?:meet\s+me|come\s+(?:to|over)\s+my|my\s+(?:house|home|address)|alone|don'?t\s+tell|keep\s+(?:it|this)\s+secret|send\s+(?:me\s+)?a?\s*(?:pic|photo|selfie))\b/gi;

/* --------------------------------------------------------------- word lists */

/**
 * Short, obvious, and stemmed by `includes` on a de-leeted copy. English plus
 * the Hungarian ones, since the first parks are in Hungary.
 */
const PROFANITY = [
  "fuck",
  "shit",
  "bitch",
  "bastard",
  "asshole",
  "dickhead",
  "wanker",
  "cunt",
  "kurva",
  "picsa",
  "fasz",
  "geci",
  "buzi",
];

/** Zero tolerance: these block the message rather than redact a word. */
const SLURS = [
  "nigg",
  "faggot",
  "retard",
  "tranny",
  "kike",
  "spic",
  "chink",
  "paki",
  "cigany",
  "cigány",
];

/** Sexual content, blocked outright in a game with minors in it. */
const SEXUAL = ["porn", "nudes", "nude pic", "sexting", "horny", "rape"];

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  $: "s",
};

/** Lowercase, de-leeted, punctuation and repeats collapsed. */
function canonical(input: string) {
  const mapped = input
    .toLowerCase()
    .split("")
    .map((ch) => LEET[ch] ?? ch)
    .join("");
  return mapped.replace(/[^a-zÀ-ſ\s]/g, "").replace(/(.)\1{2,}/g, "$1$1");
}

/* ------------------------------------------------------------------ filters */

/**
 * Filters a free-text chat message.
 *
 * `maxLength` is short on purpose: this is a game of walking to a park, not a
 * messaging app, and a 200-character cap removes most of what a determined
 * adult would want to write to a child.
 */
export function filterMessage(input: string, maxLength = 200): FilterVerdict {
  const reasons: FilterReason[] = [];
  const trimmed = input.replace(/\s+/g, " ").trim();

  if (!trimmed) return { text: "", redacted: false, blocked: true, reasons: ["empty"] };
  if (trimmed.length > maxLength) {
    return { text: "", redacted: false, blocked: true, reasons: ["too_long"] };
  }

  const flat = canonical(trimmed);

  // Hard stops first — nothing about these is worth delivering redacted.
  if (SLURS.some((word) => flat.includes(word))) {
    return { text: "", redacted: false, blocked: true, reasons: ["slur"] };
  }
  if (SEXUAL.some((word) => flat.includes(word.replace(/\s/g, "")) || flat.includes(word))) {
    return { text: "", redacted: false, blocked: true, reasons: ["sexual"] };
  }

  let text = trimmed;
  const swap = (pattern: RegExp, reason: FilterReason) => {
    if (pattern.test(text)) {
      reasons.push(reason);
      text = text.replace(pattern, REDACTION);
    }
    pattern.lastIndex = 0;
  };

  // Order matters: emails and urls contain things the phone net would eat.
  swap(EMAIL, "email");
  swap(URL, "url");
  swap(PHONE, "phone");
  swap(HANDLE, "handle");
  swap(PLATFORM, "handle");
  swap(ADDRESS, "address");

  if (MEETING.test(text)) reasons.push("meeting");
  MEETING.lastIndex = 0;

  for (const word of PROFANITY) {
    if (canonical(text).includes(word)) {
      reasons.push("profanity");
      // Mask the visible form rather than the canonical one.
      text = text.replace(new RegExp(word, "gi"), "*".repeat(word.length));
    }
  }

  const stripped = text.replace(/\[removed\]/g, "").replace(/\*/g, "").trim();
  if (!stripped) return { text: "", redacted: true, blocked: true, reasons };

  return { text, redacted: reasons.length > 0, blocked: false, reasons };
}

/**
 * Filters a name a player chooses for themselves, their team or a meet-up.
 * Stricter than chat: a name is permanent and public to everyone who can see
 * the container, so anything flagged is refused rather than redacted.
 */
export function filterName(input: string, maxLength = 24): FilterVerdict {
  const trimmed = input.replace(/\s+/g, " ").trim();
  if (trimmed.length < 3) {
    return { text: "", redacted: false, blocked: true, reasons: ["empty"] };
  }
  if (trimmed.length > maxLength) {
    return { text: "", redacted: false, blocked: true, reasons: ["too_long"] };
  }
  const verdict = filterMessage(trimmed, maxLength);
  if (verdict.blocked || verdict.redacted) {
    return { text: "", redacted: false, blocked: true, reasons: verdict.reasons };
  }
  return { text: trimmed, redacted: false, blocked: false, reasons: [] };
}

/** One line for the moderation queue and for the error the player sees. */
export function filterExplanation(reasons: FilterReason[]): string {
  if (reasons.includes("slur")) return "That language is not allowed here.";
  if (reasons.includes("too_long")) return "That is too long.";
  if (reasons.includes("empty")) return "Nothing to send.";
  const personal = (["phone", "email", "url", "handle", "address"] as FilterReason[]).filter((r) =>
    reasons.includes(r),
  );
  if (personal.length > 0) {
    return "Personal details and links are removed — GeoFights keeps contact info out of chat.";
  }
  if (reasons.includes("profanity")) return "Some words were masked.";
  return "Message sent.";
}
