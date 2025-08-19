// pages/api/twilio/sendSMS.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
// ⬇️ use the Twilio helper we updated earlier
import { sendSMS } from "@/lib/twilio/sendSMS";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed." });

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email)
      return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    const email = String(session.user.email).toLowerCase();
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const { to, body, leadId } = (req.body || {}) as {
      to?: string;
      body?: string;
      leadId?: string;
    };
    if (!to || !body?.trim() || !leadId) {
      return res
        .status(400)
        .json({ message: "Missing required fields (to, body, leadId)." });
    }

    // ✅ Find lead & verify ownership (ownerEmail OR userEmail)
    const lead = await Lead.findOne({
      _id: leadId,
      $or: [{ ownerEmail: email }, { userEmail: email }],
    });
    if (!lead)
      return res.status(404).json({ message: "Lead not found or not yours." });

    // ✅ Block sending of explicit opt-out keywords
    const lowerBody = body.trim().toLowerCase();
    const optOutKeywords = ["stop", "unsubscribe", "end", "quit", "cancel"];
    if (optOutKeywords.includes(lowerBody)) {
      return res
        .status(400)
        .json({ message: "Cannot send opt-out keyword as an outbound SMS." });
    }

    // ✅ A2P gating (relaxed if using approved shared service or DEV override)
    const usingSharedMG = !!process.env.TWILIO_MESSAGING_SERVICE_SID;
    const devOverride = process.env.DEV_ALLOW_UNAPPROVED === "1";
    if (!usingSharedMG && !devOverride) {
      // legacy/tenant-based flow: require user.a2pStatus or your own a2p flag
      const approved =
        (user as any).a2pStatus === "approved" ||
        (user as any)?.a2p?.messagingReady;
      if (!approved) {
        return res.status(403).json({
          message:
            "Your account is not A2P approved yet for tenant messaging. (Shared Messaging Service not configured.)",
        });
      }
    }

    // ✅ Send via Twilio (always through Messaging Service inside sendSMS)
    const { sid, serviceSid } = await sendSMS(to, body.trim(), user);

    // ✅ Append to lead's interaction history (best-effort)
    try {
      lead.interactionHistory = lead.interactionHistory || [];
      lead.interactionHistory.push({
        type: "outbound",
        text: body.trim(),
        date: new Date(),
        sid, // Twilio message SID
        fromServiceSid: serviceSid,
        to,
        sentAt: new Date(),
      } as any);
      lead.updatedAt = new Date();
      await lead.save();
    } catch (e) {
      console.warn("Failed to append to lead.interactionHistory:", e);
    }

    // ✅ Emit real-time socket event to update Conversations
    try {
      // @ts-ignore
      res.socket?.server?.io?.to(email).emit("message:new", {
        leadId: lead._id,
        text: body.trim(),
        type: "outbound",
        date: new Date().toISOString(),
        sid,
      });
    } catch (e) {
      console.warn("Socket emit failed:", e);
    }

    return res.status(200).json({ message: "SMS sent", sid });
  } catch (error: any) {
    console.error("❌ Outbound SMS error:", error);
    return res
      .status(500)
      .json({
        message: "Internal server error",
        error: error?.message || String(error),
      });
  }
}
