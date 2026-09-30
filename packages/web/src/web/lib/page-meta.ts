import { useEffect } from "react";

/**
 * Per-route head tags for a client-rendered app. index.html ships the landing
 * page's tags (so crawlers that do not run JS still get them); every other
 * route overrides them here. Only `/` is meant to be found in search — the
 * game shell, the operator console and the developer pages are all noindex.
 */

export const SITE_URL = "https://geofights.com";

function setMeta(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = name;
    document.head.appendChild(tag);
  }
  tag.content = content;
}

function setCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

export function usePageMeta(meta: { title: string; path: string; index?: boolean }) {
  useEffect(() => {
    document.title = meta.title;
    setCanonical(`${SITE_URL}${meta.path}`);
    setMeta("robots", meta.index ? "index, follow" : "noindex, nofollow");
  }, [meta.title, meta.path, meta.index]);
}
