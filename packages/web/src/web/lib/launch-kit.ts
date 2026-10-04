/**
 * The launch kit: press copy, downloadable assets and ready-to-post social
 * content. The /press page and the admin Launch tab both read from here, so
 * edit copy in one place. Operator progress on each post (posted? where?)
 * lives in the `launch_item` table, keyed by `LaunchPost.key`.
 *
 * Every outbound link carries `?ref=<channel>` so the Launch tab can count
 * visits and sign-ups per channel.
 */

export const SITE = "https://www.geofights.com";

/** Channel tags used in `?ref=`. Keep short; they show up in the admin table. */
export const CHANNELS = {
  ig: "Instagram",
  tt: "TikTok",
  x: "X",
  press: "Press",
  yt: "YouTube",
  fb: "Facebook",
} as const;
export type ChannelRef = keyof typeof CHANNELS;

export const refLink = (ref: ChannelRef, path = "/") => `${SITE}${path}?ref=${ref}`;

/** Where press enquiries go. Set up this mailbox (or forwarding) before sharing the press page. */
export const PRESS_CONTACT = "press@geofights.com";

export const PRESS = {
  oneLiner: "GeoFights is a free augmented-reality battle game you play outdoors, in parks and playgrounds near you.",
  short:
    "Walk to an approved park, pitch or playground, collect upgrades that drop there just for you, and fight other players in AR on the grass you're standing on. It runs in the phone's browser, with no download and nothing to buy.",
  boilerplate:
    "GeoFights turns local parks into arenas. Players build a procedural character, walk to a reviewed park, pitch or playground near them, and pick up free upgrades that appear inside it. Placing their character in augmented reality, they battle other players nearby; the winner takes one of the loser's upgrades. The game is free, has no real-money purchases and plays in any modern phone browser. Safety is built in: play areas are checked against roads, railways and water, the game pauses above walking pace, adults and under-18s are never matched or put in chat together, a player's location is never shown on a map, and younger players need a parent or guardian to take part.",
  facts: [
    ["Genre", "Location-based AR battle game"],
    ["Platform", "Mobile web (any modern phone browser); installable to the home screen"],
    ["Price", "Free. No real-money purchases"],
    ["Where", "Reviewed parks, sports pitches and playgrounds"],
    ["Players", "All ages, with age-banded matchmaking and parent controls"],
    ["Website", "geofights.com"],
  ] as const,
  features: [
    "Procedural characters: every fighter is built from parts, so no two look the same.",
    "Free upgrades drop inside nearby play areas, visible only to you.",
    "Real-time AR fights on the grass you're standing on, with attacks, defences and combos.",
    "Winner takes one: beat an opponent and claim one of their upgrades.",
    "Players can suggest new grounds; each one is checked against roads, rail and water first.",
    "A training mode to practise against a partner without risking anything.",
  ],
  safety: [
    "Play only happens in reviewed areas, never on roads, railways or water.",
    "Collecting and fighting pause above walking pace.",
    "Adults and under-18s are never matched or put in chat together.",
    "Location is never shown on a map; only a current opponent sees it, for the length of the fight.",
    "Under-16s need a parent or guardian; under-13s need a parent to confirm by email, and their ground suggestions go to that parent for approval.",
  ],
} as const;

export type PressAsset = { label: string; href: string; detail: string; preview?: string };

export const PRESS_ASSETS: PressAsset[] = [
  { label: "App icon", href: "/press/geofights-icon-1024.png", detail: "PNG · 1024×1024", preview: "/icons/icon-512.png" },
  { label: "Logo banner", href: "/og-image.png", detail: "PNG · 1200×630", preview: "/og-image.png" },
  { label: "Trailer", href: "/videos/geofights-trailer.mp4", detail: "MP4 · 1080×1920 · 9:16 · 28 s" },
  { label: "Trailer (wide)", href: "/videos/geofights-trailer-wide.mp4", detail: "MP4 · 1920×1080 · 16:9 · 28 s" },
];

export const SCREENSHOTS: Array<{ src: string; caption: string; orientation: "portrait" | "landscape" }> = [
  { src: "/press/screens/fight-portrait.png", caption: "A training fight, portrait", orientation: "portrait" },
  { src: "/press/screens/place-portrait.png", caption: "Placing your character on the grass", orientation: "portrait" },
  { src: "/press/screens/landing-mobile.png", caption: "The home page on a phone", orientation: "portrait" },
  { src: "/press/screens/fight-landscape.png", caption: "A training fight, landscape", orientation: "landscape" },
  { src: "/press/screens/landing-desktop.png", caption: "geofights.com on desktop", orientation: "landscape" },
];

export type LaunchPost = {
  key: string;
  channel: ChannelRef;
  title: string;
  /** Asset to upload with the post (served from /public). */
  asset: string;
  assetKind: "image" | "video";
  caption: string;
};

const IG_TAGS = "#GeoFights #ARgame #augmentedreality #outdoorgames #mobilegames #getoutside";

export const LAUNCH_POSTS: LaunchPost[] = [
  {
    key: "ig-1-launch",
    channel: "ig",
    title: "Instagram · launch post",
    asset: "/press/social/ig-1-launch.png",
    assetKind: "image",
    caption: `Your local park is the arena.\n\nGeoFights is a free AR battle game you play outdoors. Walk to a park, pitch or playground near you, grab the upgrades that drop there just for you, and fight other players on the grass you're standing on.\n\nNo download. It runs in your phone's browser. Link in bio.\n\n${IG_TAGS}`,
  },
  {
    key: "ig-2-how",
    channel: "ig",
    title: "Instagram · how it works",
    asset: "/press/social/ig-2-how-it-works.png",
    assetKind: "image",
    caption: `How GeoFights works:\n\n01 Walk to an approved park\n02 Grab free upgrades that drop just for you\n03 Place your character in AR and fight players nearby\n04 Win, and take one of their upgrades\n\nFree to play, nothing to buy. Link in bio.\n\n${IG_TAGS}`,
  },
  {
    key: "ig-3-safety",
    channel: "ig",
    title: "Instagram · safety (for parents)",
    asset: "/press/social/ig-3-safety.png",
    assetKind: "image",
    caption: `Built safe from day one.\n\nGeoFights only plays in reviewed parks, pitches and playgrounds, never on roads, rail or water. It pauses above walking pace. Adults and under-18s are never matched or in chat together, and nobody's location is ever shown on a map.\n\nUnder-13? A parent confirms the account by email.\n\n#GeoFights #parenting #kidsoutdoors #screentimebalance #outdoorplay`,
  },
  {
    key: "ig-reel-trailer",
    channel: "ig",
    title: "Instagram · Reel (trailer)",
    asset: "/videos/geofights-trailer.mp4",
    assetKind: "video",
    caption: `The park down the road just became an arena.\n\nFree AR fights in your phone's browser. Link in bio.\n\n${IG_TAGS} #reels`,
  },
  {
    key: "tt-trailer",
    channel: "tt",
    title: "TikTok · trailer",
    asset: "/videos/geofights-trailer.mp4",
    assetKind: "video",
    caption:
      "POV: the park down the road is a battle arena. Free AR fights, right in your phone's browser. geofights.com #GeoFights #ARgame #gaming #outdoors #fyp",
  },
  {
    key: "x-1-launch",
    channel: "x",
    title: "X · launch post",
    asset: "/press/social/x-1-duel.png",
    assetKind: "image",
    caption: `GeoFights is live.\n\nWalk to a park, place your character in AR and fight whoever's nearby. Free, in your phone's browser, nothing to buy.\n\n${refLink("x")}`,
  },
  {
    key: "x-2-how",
    channel: "x",
    title: "X · walk, collect, fight",
    asset: "/press/social/x-3-walk-collect-fight.png",
    assetKind: "image",
    caption: `Walk. Collect. Fight.\n\nFree upgrades drop inside approved parks just for you. Power up your character, then battle players nearby in AR. Winner takes one of the loser's upgrades.\n\n${refLink("x")}`,
  },
  {
    key: "x-3-safety",
    channel: "x",
    title: "X · safety",
    asset: "/press/social/x-2-safety.png",
    assetKind: "image",
    caption: `An outdoor game for kids has to be safe by design:\n\n• Reviewed parks only\n• Pauses above walking pace\n• Adults and under-18s never mix\n• No one's location on a map\n• Parents confirm under-13s\n\n${refLink("x")}`,
  },
  {
    key: "x-4-trailer",
    channel: "x",
    title: "X · trailer",
    asset: "/videos/geofights-trailer-wide.mp4",
    assetKind: "video",
    caption: `Your local park is the arena. Half a minute of GeoFights:\n\n${refLink("x")}`,
  },
];

/** One-off launch chores the Launch tab tracks alongside the posts. */
export const LAUNCH_TASKS: Array<{ key: string; title: string; detail: string }> = [
  { key: "task-publish", title: "Re-publish the site in Runable", detail: "Pushes the press page, SEO tags and fixes live." },
  { key: "task-press-mailbox", title: `Set up ${PRESS_CONTACT}`, detail: "The press page lists it. Forward it to your inbox." },
  { key: "task-bio-links", title: "Put ref links in bios", detail: `Instagram: ${refLink("ig")} · TikTok: ${refLink("tt")}` },
  { key: "task-search-console", title: "Submit the sitemap to Google Search Console", detail: `${SITE}/sitemap.xml` },
  { key: "task-resend", title: "Add RESEND_API_KEY", detail: "Until then, parent and password-reset emails are forwarded by hand from the Moderation tab." },
];
