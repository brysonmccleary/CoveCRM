import { createHmac, timingSafeEqual } from "crypto";

export function createMetaOauthState(subject: string, secret: string): string {
  if (!subject || !secret) throw new Error("Meta OAuth state requires a subject and secret");
  const payload = Buffer.from(subject, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyMetaOauthState(state: string, subject: string, secret: string): boolean {
  if (!state || !subject || !secret) return false;
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra) return false;
  const expectedPayload = Buffer.from(subject, "utf8").toString("base64url");
  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  return payload === expectedPayload && received.length === expected.length && timingSafeEqual(received, expected);
}
