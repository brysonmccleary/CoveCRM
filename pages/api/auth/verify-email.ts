import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { sendEmailVerificationCode } from "@/lib/email/sendEmail";

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      const sent = await sendEmailVerificationCode({
        to: email,
        name: (user as any).name,
        code: nextCode,
      });

      if (!sent.ok) {
        console.error("[verify-email] resend failed:", sent.error || "unknown");
        return res.status(500).json({ ok: false, error: "Verification email could not be sent" });
      }

      (user as any).emailVerificationCodeHash = hashVerificationCode(email, nextCode);
      (user as any).emailVerificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
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
