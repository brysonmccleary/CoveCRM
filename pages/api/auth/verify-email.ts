import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { sendEmailVerificationCode } from "@/lib/email";

function makeVerificationCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashVerificationCode(email: string, code: string) {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.NEXTAUTH_SECRET || "covecrm";
  return crypto
    .createHmac("sha256", secret)
    .update(`${email.toLowerCase()}:${code}`)
    .digest("hex");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function signVerificationPayload(payload: string) {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.NEXTAUTH_SECRET || "covecrm";
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeEmailVerificationToken(email: string, expiresAt: Date) {
  const payload = base64UrlEncode(JSON.stringify({
    email: email.toLowerCase(),
    expiresAt: expiresAt.toISOString(),
  }));
  return `${payload}.${signVerificationPayload(payload)}`;
}

function verifyEmailVerificationToken(token: string, email: string): { ok: boolean; expiresAt?: number } {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return { ok: false };

  const expected = signVerificationPayload(payload);
  const matches =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!matches) return { ok: false };

  try {
    const data = JSON.parse(base64UrlDecode(payload)) as { email?: string; expiresAt?: string };
    if (String(data.email || "").toLowerCase() !== email.toLowerCase()) return { ok: false };

    const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
    if (!expiresAt || expiresAt < Date.now()) return { ok: false };

    return { ok: true, expiresAt };
  } catch {
    return { ok: false };
  }
}

function buildVerifyUrl(email: string, token: string) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://www.covecrm.com";
  return `${baseUrl}/api/auth/verify-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(
    token,
  )}`;
}

function redirectToVerifyError(res: NextApiResponse, email: string) {
  const suffix = email ? `?email=${encodeURIComponent(email)}&error=expired` : "?error=expired";
  return res.redirect(302, `/verify-email${suffix}`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const rawEmail = Array.isArray(req.query.email) ? req.query.email[0] : req.query.email;
    const rawToken = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
    const email = String(rawEmail || "").trim().toLowerCase();
    const token = String(rawToken || "").trim();

    if (!email || !token) return redirectToVerifyError(res, email);

    const verifiedToken = verifyEmailVerificationToken(token, email);
    if (!verifiedToken.ok) return redirectToVerifyError(res, email);

    try {
      await dbConnect();
      const user = await User.findOne({ email });
      if (!user) return redirectToVerifyError(res, email);

      (user as any).emailVerified = true;
      (user as any).emailVerificationCodeHash = null;
      (user as any).emailVerificationExpiresAt = null;
      await user.save();

      return res.redirect(302, `/billing?email=${encodeURIComponent(email)}&trial=1`);
    } catch (err: any) {
      console.error("[verify-email] link error:", err?.message || err);
      return redirectToVerifyError(res, email);
    }
  }

  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const code = String(req.body?.code || "").trim();
  const action = String(req.body?.action || "verify").trim().toLowerCase();

  if (!email) return res.status(400).json({ ok: false, error: "Email is required" });

  try {
    await dbConnect();
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    if (action === "resend") {
      const nextCode = makeVerificationCode();
      const nextExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
      const nextToken = makeEmailVerificationToken(email, nextExpiresAt);
      const sent = await sendEmailVerificationCode({
        to: email,
        name: (user as any).name,
        code: nextCode,
        verifyUrl: buildVerifyUrl(email, nextToken),
      });

      if (!sent.ok) {
        console.error("[verify-email] resend failed:", sent.error || "unknown");
        return res.status(500).json({ ok: false, error: "Verification email could not be sent" });
      }

      (user as any).emailVerificationCodeHash = hashVerificationCode(email, nextCode);
      (user as any).emailVerificationExpiresAt = nextExpiresAt;
      await user.save();
      return res.status(200).json({ ok: true });
    }

    if (!code) return res.status(400).json({ ok: false, error: "Verification code is required" });
    if ((user as any).emailVerified === true) return res.status(200).json({ ok: true });

    const expiresAt = (user as any).emailVerificationExpiresAt
      ? new Date((user as any).emailVerificationExpiresAt).getTime()
      : 0;
    if (!expiresAt || expiresAt < Date.now()) {
      return res.status(400).json({ ok: false, error: "Verification code expired" });
    }

    const expected = String((user as any).emailVerificationCodeHash || "");
    const actual = hashVerificationCode(email, code);
    const matches =
      expected.length === actual.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));

    if (!matches) {
      return res.status(400).json({ ok: false, error: "Invalid verification code" });
    }

    (user as any).emailVerified = true;
    (user as any).emailVerificationCodeHash = null;
    (user as any).emailVerificationExpiresAt = null;
    await user.save();

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("[verify-email] error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Email verification failed" });
  }
}
