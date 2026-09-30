import { useCallback, useEffect, useState } from "react";
import {
  getInstallPrompt,
  isIosSafari,
  isStandalone,
  showInstallPrompt,
  subscribeToInstallPrompt,
} from "@/lib/pwa";

const DISMISSED_KEY = "geofights.install-dismissed";

export interface InstallState {
  /** Running from the home screen already — hide every install affordance. */
  installed: boolean;
  /** Chromium handed us an install event: a one-tap install is possible. */
  canPrompt: boolean;
  /** iOS, where the user has to go through Share → Add to Home Screen. */
  needsIosInstructions: boolean;
  /** The user closed the banner this browser; don't nag again. */
  dismissed: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
}

/**
 * Everything the UI needs to offer "install this game", across the two very
 * different install stories: Chromium's prompt event and iOS's manual flow.
 */
export function useInstall(): InstallState {
  const [installed, setInstalled] = useState(() => isStandalone());
  const [canPrompt, setCanPrompt] = useState(() => getInstallPrompt() !== null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => subscribeToInstallPrompt(() => setCanPrompt(getInstallPrompt() !== null)), []);

  useEffect(() => {
    const onInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstalled);

    // Installing from the browser UI switches display-mode without a reload.
    const standalone = window.matchMedia("(display-mode: standalone)");
    const onChange = () => setInstalled(isStandalone());
    standalone.addEventListener("change", onChange);

    return () => {
      window.removeEventListener("appinstalled", onInstalled);
      standalone.removeEventListener("change", onChange);
    };
  }, []);

  const install = useCallback(async () => {
    const outcome = await showInstallPrompt();
    if (outcome === "accepted") setInstalled(true);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Private mode with storage blocked: the banner just comes back.
    }
  }, []);

  return {
    installed,
    canPrompt,
    needsIosInstructions: !installed && isIosSafari(),
    dismissed,
    install,
    dismiss,
  };
}
