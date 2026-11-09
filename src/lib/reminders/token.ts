// Signed one-click unsubscribe links: HMAC-SHA256(secret, "unsubscribe:" + userId), base64url.
// Only node:crypto, so it works in the Next server, the scheduled function and tests.
import { createHmac, timingSafeEqual } from "node:crypto";

export function unsubscribeToken(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:${userId}`).digest("base64url");
}

export function verifyUnsubscribe(userId: string, token: string, secret: string): boolean {
  if (!secret || !/^[0-9a-f-]{36}$/i.test(userId) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const a = Buffer.from(unsubscribeToken(userId, secret)), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function unsubscribeUrl(siteUrl: string, userId: string, secret: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/unsubscribe?u=${userId}&t=${unsubscribeToken(userId, secret)}`;
}
