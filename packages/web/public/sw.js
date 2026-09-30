/*
 * GeoFights service worker.
 *
 * Deliberately conservative: this is a realtime multiplayer game, so nothing
 * that could serve a stale app shell or a cached API response is allowed.
 *
 *  - /api/* and anything non-GET: never touched, straight to the network. The
 *    realtime match stream is an open-ended SSE response and auth/RPC calls
 *    must never be replayed from cache.
 *  - navigations: network first, cache the shell as a fallback so a cold
 *    launch of the installed app works on a flaky connection.
 *  - hashed build assets, icons, audio, video: cache first (immutable names).
 *  - Google Fonts: stale-while-revalidate.
 *
 * Bump CACHE_VERSION on any change to this file to evict old caches.
 */

const CACHE_VERSION = "v1";
const SHELL_CACHE = `geofights-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `geofights-assets-${CACHE_VERSION}`;
const FONT_CACHE = `geofights-fonts-${CACHE_VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE, FONT_CACHE]);

// Enough to boot the shell offline. Everything else is cached on first use:
// the game bundle is code-split and its filenames are only known at build time.
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/favicon.ico"];

const IMMUTABLE_PREFIXES = ["/assets/", "/icons/", "/sfx/", "/videos/", "/fonts/", "/images/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 cannot fail the whole install.
      await Promise.all(
        SHELL_URLS.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !KEEP.has(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

function isImmutableAsset(url) {
  return IMMUTABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const revalidate = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  return hit ?? revalidate;
}

async function navigate(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    // Keep the shell fresh for the next cold launch.
    if (response.ok) cache.put("/", response.clone());
    return response;
  } catch (error) {
    const fallback = (await cache.match(request)) ?? (await cache.match("/"));
    if (fallback) return fallback;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // The API — RPC, auth and the open-ended realtime stream — is never cached
  // and never proxied through here.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;
  // Range requests (audio/video seeking) must reach the network untouched.
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }

  if (url.origin === self.location.origin && isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }
});
