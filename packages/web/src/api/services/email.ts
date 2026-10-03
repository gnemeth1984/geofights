/**
 * Outbound transactional email.
 *
 * Exactly one thing sends mail in this game: the parental consent link for an
 * under-13 account. That makes provider choice almost irrelevant, so this is a
 * plain `fetch` against Resend's HTTP API rather than a dependency.
 *
 * Without `RESEND_API_KEY` the send reports itself as undeliverable instead of
 * throwing. That is deliberate: the consent record is already written, the
 * link already exists, and an operator can pass it on by hand. A missing
 * provider key must never be the reason a child's account ends up in a state
 * where the parent was told nothing — the UI shows the pending state either way.
 */

export type EmailResult =
  | { ok: true; via: "email"; id: string | null }
  | { ok: false; via: "manual"; error: string };

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress() {
  return process.env.EMAIL_FROM ?? "GeoFights <noreply@geofights.com>";
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, via: "manual", error: "RESEND_API_KEY is not set" };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        reply_to: input.replyTo,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, via: "manual", error: `${response.status} ${detail.slice(0, 200)}` };
    }
    const data = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, via: "email", id: data?.id ?? null };
  } catch (error) {
    return {
      ok: false,
      via: "manual",
      error: error instanceof Error ? error.message : "send failed",
    };
  }
}

/** Absolute base for links in mail. Falls back to the production domain. */
export { siteUrl } from "../lib/site-url";
