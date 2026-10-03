/**
 * The public site address, always with a protocol and no trailing slash.
 * WEBSITE_URL can arrive as a bare domain ("geofights.com") from the publish
 * settings; better-auth refuses to boot without a protocol, so add https.
 */
export function normalizeSiteUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

export function siteUrl(): string {
  return (
    normalizeSiteUrl(process.env.WEBSITE_URL) ??
    normalizeSiteUrl(process.env.RUNABLE_URL) ??
    "https://geofights.com"
  );
}
