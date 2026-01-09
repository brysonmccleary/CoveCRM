// pages/api/sms/send.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { LeadAIState } from "@/models/LeadAIState";
import { sendSMS } from "@/lib/twilio/sendSMS";

/**
 * POST /api/sms/send
 * Body: { to: string (E.164), body: string }
 *
 * - Auth required.
 * - Sends via the user's Messaging Service SID if available (A2P path).
 *
 * ✅ NEW behavior (only for AI suppression control):
 * - After a HUMAN outbound message, suppress AI proactive messages for N hours
 *   unless the lead replies inbound.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const { to, body } = (req.body || {}) as { to?: string; body?: string };

  if (!to || !body) {
    return res.status(400).json({ message: "Missing 'to' or 'body'." });
  }
  if (!to.startsWith("+")) {
    return res
      .status(400)
      .json({ message: "Recipient phone must be in E.164 format, e.g. +15551234567." });
  }

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    console.log(`📮 /api/sms/send user=${user.email} to=${to}`);

    const { sid, serviceSid, messageId, scheduledAt } = await sendSMS(
      to,
      body,
      user._id.toString()
    );

    // ✅ NEW: update AI suppression window after a HUMAN outbound
    // This prevents AI from "jumping in" after the agent has texted,
    // unless the lead replies.
    try {
      const now = new Date();

      const last10 = String(to).replace(/\D/g, "").slice(-10);
      if (last10) {
        const lead = await Lead.findOne({
          phone: { $regex: last10 + "$" },
          // If your Lead schema has userEmail, this narrows it safely.
          // If it does not, Mongo will ignore it if field doesn't exist in docs.
          userEmail: user.email,
        }).select({ _id: 1, phone: 1, userEmail: 1 }).lean();

        if (lead?._id) {
          const COOLDOWN_HOURS =
            Math.max(1, parseInt(process.env.AI_NO_REPLY_COOLDOWN_HOURS || "72", 10)) || 72;

          const suppressedUntil = new Date(now.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000);

          await LeadAIState.updateOne(
            { userEmail: user.email, leadId: lead._id },
            {
              $set: {
                userEmail: user.email,
                leadId: lead._id,
                phoneLast10: last10,
                lastHumanOutboundAt: now,
                aiSuppressedUntil: suppressedUntil,
              },
            },
            { upsert: true }
          );

          console.log(
            `🛑 AI suppression set leadId=${String(lead._id)} until=${suppressedUntil.toISOString()}`
          );
        }
      }
    } catch (e: any) {
      console.warn("⚠️ /api/sms/send suppression update failed:", e?.message || e);
      // do NOT fail the send flow
    }

    // If suppressed (no SID), still return 200 with details for the UI
    if (!sid) {
      console.log(`⚠️ suppressed to=${to} messageId=${messageId}`);
      return res.status(200).json({
        message: "Suppressed (opt-out or policy)",
        suppressed: true,
        serviceSid,
        messageId,
      });
    }

    const payload: Record<string, any> = {
      message: scheduledAt ? "SMS scheduled" : "SMS accepted",
      sid,
      serviceSid,
      messageId,
    };
    if (scheduledAt) payload.scheduledAt = scheduledAt;

    return res.status(200).json(payload);
  } catch (err: any) {
    console.error("❌ /api/sms/send error:", err);
    const msg = err?.message || "Failed to send SMS";
    return res.status(500).json({ message: msg });
  }
}
