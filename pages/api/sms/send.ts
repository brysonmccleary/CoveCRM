// pages/api/sms/send.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { LeadAIState } from "@/models/LeadAIState";
import { sendSMS } from "@/lib/twilio/sendSMS";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { to, body } = (req.body || {}) as { to?: string; body?: string };
  if (!to || !body) return res.status(400).json({ message: "Missing 'to' or 'body'." });

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const { sid, serviceSid, messageId, scheduledAt } = await sendSMS(
      to,
      body,
      user._id.toString()
    );

    // ✅ NEW: after HUMAN outbound, suppress AI proactive messages for N hours unless lead replies.
    try {
      const now = new Date();
      const last10 = String(to).replace(/\D/g, "").slice(-10);

      if (last10) {
        // Find the lead (same tenant) by phone ending
        const lead = await Lead.findOne({
          userEmail: user.email,
          $or: [
            { Phone: { $regex: last10 + "$" } },
            { phone: { $regex: last10 + "$" } },
            { ["Phone Number"]: { $regex: last10 + "$" } } as any,
            { PhoneNumber: { $regex: last10 + "$" } } as any,
            { Mobile: { $regex: last10 + "$" } } as any,
            { mobile: { $regex: last10 + "$" } } as any,
            { "phones.value": { $regex: last10 + "$" } } as any,
          ],
        })
          .select({ _id: 1 })
          .lean();

        if (lead?._id) {
          const hours =
            Math.max(1, parseInt(process.env.AI_NO_REPLY_COOLDOWN_HOURS || "72", 10)) || 72;
          const suppressedUntil = new Date(now.getTime() + hours * 60 * 60 * 1000);

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
            `🛑 AI suppression set user=${user.email} leadId=${String(lead._id)} until=${suppressedUntil.toISOString()}`
          );
        }
      }
    } catch (e: any) {
      console.warn("⚠️ /api/sms/send suppression update failed:", e?.message || e);
    }

    if (!sid) {
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
    return res.status(500).json({ message: err?.message || "Failed to send SMS" });
  }
}
