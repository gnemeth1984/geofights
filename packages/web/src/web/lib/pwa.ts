/**
 * Progressive-web-app plumbing: service-worker registration and the
 * platform sniffing the install UI needs.
 *
 * The worker itself is a static file (`public/sw.js`) rather than a bundled
 * module, so it is registered by URL and versioned inside that file.
 */

const SW_URL = "/sw.js";

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Service workers need a secure context. Browsers treat localhost as one,
  // so this still works in dev.
  if (!window.isSecureContext) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch((error) => {
      // A failed registration must never break the game.
      console.warn("[pwa] service worker registration failed", error);
    });
  });
}

/** True once the app is running from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    // iOS Safari's own flag — it never fires beforeinstallprompt.
    ("standalone" in window.navigator && Boolean(window.navigator.standalone))
  );
}

/** iOS and iPadOS, where installing means "Share → Add to Home Screen". */
export function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  // Chrome/Firefox on iOS cannot add to the home screen at all.
  return !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Chromium's install event, which the spec has not standardised yet. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/*
 * `beforeinstallprompt` can fire before React has mounted, and the event is
 * only usable if it was captured. So the listener is installed at module load
 * and the event parked here for whichever component asks for it later.
 */
let parked: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

function announce() {
  for (const notify of subscribers) notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress Chrome's own mini-infobar; the in-app prompt replaces it.
    event.preventDefault();
    parked = event as BeforeInstallPromptEvent;
    announce();
  });
  window.addEventListener("appinstalled", () => {
    parked = null;
    announce();
  });
}

export function subscribeToInstallPrompt(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return parked;
}

/** Fires the browser's install flow. Resolves to what the user chose. */
export async function showInstallPrompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = parked;
  if (!event) return "unavailable";
  await event.prompt();
  const { outcome } = await event.userChoice;
  // The event is single-use: Chrome fires a fresh one if it still applies.
  parked = null;
  announce();
  return outcome;
}
