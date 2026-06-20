// pages/api/funnel/verify-otp.ts
// POST — verifies an OTP code and returns a signed verifiedToken if correct.
// No auth required (public endpoint — called from the hosted funnel page).
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import mongooseConnect from "@/lib/mongooseConnect";
import FunnelOTPSession from "@/models/FunnelOTPSession";

const MAX_ATTEMPTS = 5;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { sessionId, campaignId, phone, code } = req.body as {
    sessionId?: string;
    campaignId?: string;
    phone?: string;
    code?: string;
  };

  if (!sessionId || !campaignId || !phone || !code) {
    return res.status(400).json({ error: "sessionId, campaignId, phone, and code are required" });
  }

  const phoneLast10 = String(phone).replace(/\D/g, "").slice(-10);
  if (phoneLast10.length !== 10) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  try {
    await mongooseConnect();

    const session = await FunnelOTPSession.findOne({
      _id: sessionId,
      campaignId: String(campaignId),
      phoneLast10,
      verified: false,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      return res.status(400).json({ error: "Verification session not found or expired. Request a new code." });
    }

    if ((session as any).attempts >= MAX_ATTEMPTS) {
      return res.status(400).json({ error: "Too many incorrect attempts. Request a new code." });
    }

    await FunnelOTPSession.updateOne({ _id: session._id }, { $inc: { attempts: 1 } });

    const submittedHash = crypto.createHash("sha256").update(String(code).trim()).digest("hex");
    const expectedHash = Buffer.from((session as any).codeHash, "hex");
    const submittedHashBuf = Buffer.from(submittedHash, "hex");

    let match = false;
    try {
      match = crypto.timingSafeEqual(expectedHash, submittedHashBuf);
    } catch {
      match = false;
    }

    if (!match) {
      const attemptsLeft = MAX_ATTEMPTS - ((session as any).attempts + 1);
      return res.status(400).json({
        error: attemptsLeft > 0
          ? `Incorrect code. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining.`
          : "Too many incorrect attempts. Request a new code.",
      });
    }

    await FunnelOTPSession.updateOne({ _id: session._id }, { $set: { verified: true } });

    const secret = process.env.WEBHOOK_SECRET || process.env.NEXTAUTH_SECRET || "fallback";
    const payload = `${campaignId}:${phoneLast10}:${sessionId}`;
    const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const verifiedToken = Buffer.from(`${payload}:${sig}`).toString("base64");

    return res.status(200).json({ ok: true, verified: true, verifiedToken });
  } catch (err: any) {
    console.error("[verify-otp] error:", err?.message);
    return res.status(500).json({ error: "Verification failed" });
  }
}
