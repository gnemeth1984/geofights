import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids } from "../lib/ids";
import { sendEmail } from "./email";

/**
 * Password resets. Better Auth mints the token and link; this delivers it and
 * keeps a record. With no email provider configured nothing is sent, and the
 * link waits in the admin console for an operator to forward to the account's
 * own address — never to anyone who merely asks for it.
 */

const TTL_MS = 24 * 3600 * 1000;

export async function sendPasswordReset({ user, url }: { user: { id: string; email: string; name?: string | null }; url: string }) {
  const delivery = await sendEmail({
    to: user.email,
    subject: "Reset your GeoFights password",
    text: [
      `Hi ${user.name || "there"},`,
      "",
      "Someone asked to reset the password for this GeoFights account. If it was you, open this link within 24 hours:",
      url,
      "",
      "If it wasn't you, ignore this email — your password stays the same.",
    ].join("\n"),
  });
  await db.insert(schema.passwordReset).values({
    id: ids.passwordReset(),
    userId: user.id,
    email: user.email,
    url,
    deliveredVia: delivery.via,
    deliveryError: delivery.ok ? null : delivery.error,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
}

export async function onPasswordReset(userId: string) {
  await db
    .update(schema.passwordReset)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.passwordReset.userId, userId), isNull(schema.passwordReset.usedAt)));
}

/** Open requests for the admin console, newest first. */
export async function openPasswordResets(limit = 50) {
  const rows = await db
    .select({
      id: schema.passwordReset.id,
      email: schema.passwordReset.email,
      url: schema.passwordReset.url,
      deliveredVia: schema.passwordReset.deliveredVia,
      deliveryError: schema.passwordReset.deliveryError,
      createdAt: schema.passwordReset.createdAt,
      expiresAt: schema.passwordReset.expiresAt,
      username: schema.player.username,
    })
    .from(schema.passwordReset)
    .leftJoin(schema.player, eq(schema.player.userId, schema.passwordReset.userId))
    .where(and(isNull(schema.passwordReset.usedAt), gt(schema.passwordReset.expiresAt, new Date())))
    .orderBy(desc(schema.passwordReset.createdAt))
    .limit(limit);
  return rows;
}
