// pages/api/funnel/send-otp.ts
// POST — sends a 6-digit OTP to a phone number for a hosted_funnel_otp campaign.
// No auth required (public endpoint — called from the hosted funnel page).
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FunnelOTPSession from "@/models/FunnelOTPSession";
import { sendSMS as platformSendSMS } from "@/lib/twilioClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { campaignId, phone } = req.body as { campaignId?: string; phone?: string };

  if (!campaignId) return res.status(400).json({ error: "campaignId is required" });
  if (!phone) return res.status(400).json({ error: "phone is required" });

  const phoneLast10 = String(phone).replace(/\D/g, "").slice(-10);
  if (phoneLast10.length !== 10) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  try {
    await mongooseConnect();

    const campaign = await (FBLeadCampaign as any)
      .findOne({ _id: campaignId })
      .select("campaignType webhookKey")
      .lean() as any;

    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.campaignType !== "hosted_funnel_otp") {
      return res.status(400).json({ error: "Campaign does not require phone verification" });
    }

    // Rate limit: max 3 OTP sends per phone per campaign per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await FunnelOTPSession.countDocuments({
      campaignId: String(campaignId),
      phoneLast10,
      createdAt: { $gte: oneHourAgo },
    });
    if (recentCount >= 3) {
      return res.status(429).json({ error: "Too many verification attempts. Try again in an hour." });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const session = await FunnelOTPSession.create({
      campaignId: String(campaignId),
      phoneLast10,
      codeHash,
      verified: false,
      attempts: 0,
      expiresAt,
    });

    await platformSendSMS({
      to: `+1${phoneLast10}`,
      body: `Your verification code is ${code}. It expires in 10 minutes.`,
    });

    return res.status(200).json({
      ok: true,
      sessionId: String(session._id),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err: any) {
    console.error("[send-otp] error:", err?.message);
    return res.status(500).json({ error: "Failed to send verification code" });
  }
}
