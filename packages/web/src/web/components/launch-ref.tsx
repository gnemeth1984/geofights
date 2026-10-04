import { useEffect } from "react";
import { client } from "@/lib/api";
import { useSession } from "@/queries/session";

/**
 * Launch attribution. A promo link carries `?ref=ig` (or tt, x, press…).
 * We remember the tag in this browser, report the visit once per tag per
 * day, and when the person ends up signed in to a brand-new account we credit
 * that sign-up to the tag. The server ignores accounts older than two days,
 * so existing players clicking a link don't count as sign-ups.
 */
const KEY = "gf_ref";
const DONE = "gf_ref_attributed";
const PATTERN = /^[a-z0-9_-]{1,24}$/;

function store() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function LaunchRef() {
  const session = useSession();
  const userId = session.data?.user?.id ?? null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref")?.trim().toLowerCase();
    if (!ref || !PATTERN.test(ref)) return;
    const ls = store();
    ls?.setItem(KEY, ref);
    const sentKey = `gf_ref_sent_${ref}`;
    const today = new Date().toISOString().slice(0, 10);
    if (ls?.getItem(sentKey) === today) return;
    ls?.setItem(sentKey, today);
    client.launch.visit({ ref, path: window.location.pathname }).catch(() => ls?.removeItem(sentKey));
  }, []);

  useEffect(() => {
    if (!userId) return;
    const ls = store();
    const ref = ls?.getItem(KEY);
    if (!ref || ls?.getItem(DONE) === userId) return;
    client.launch
      .attribute({ ref })
      .then(() => ls?.setItem(DONE, userId))
      .catch(() => {
        // Profile not created yet; we'll try again on the next session change.
      });
  }, [userId]);

  return null;
}
