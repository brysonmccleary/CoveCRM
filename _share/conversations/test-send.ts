import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { sendSms } from "@/lib/twilio/sendSMS";

/**
 * POST /api/messages/test-send
 * Body: { to: string (E.164), body: string, leadId?: string }
 *
 * - Auth required.
 * - Ensures a Lead exists for the user/phone (creates a minimal one if missing) so
 *   the pre-queued Message row has a valid leadId (DB = source of truth).
 * - Uses the current user's Messaging Service routing via sendSms().
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const userEmail =
    typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!userEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { to, body, leadId } = (req.body || {}) as {
    to?: string;
    body?: string;
    leadId?: string;
  };

  if (!to || !body) {
    return res.status(400).json({ message: "Missing 'to' or 'body'." });
  }
  if (!to.startsWith("+")) {
    return res.status(400).json({
      message: "Recipient phone must be in E.164 format, e.g. +15551234567.",
    });
  }

  try {
    await dbConnect();

    const user = await User.findOne({ email: userEmail });
    if (!user?._id) {
      return res.status(404).json({ message: "User not found" });
    }

    // Ensure we have a Lead for this user+phone to satisfy Message.leadId (required)
    let leadDoc: any = null;
    if (leadId) {
      leadDoc = await Lead.findOne({ _id: leadId, userEmail });
      if (!leadDoc) {
        return res.status(404).json({ message: "Lead not found for this user" });
      }
    } else {
      const digits = (to || "").replace(/\D/g, "");
      const last10 = digits.slice(-10);
      leadDoc =
        (await Lead.findOne({ userEmail, Phone: { $regex: last10 } })) ||
        (await Lead.findOne({ userEmail, Phone: `+1${last10}` })) ||
        (await Lead.findOne({ userEmail, Phone: to }));

      if (!leadDoc) {
        leadDoc = await Lead.create({
          userEmail,
          Phone: to,
          Source: "test-send",
          Status: "New",
          "First Name": "Test",
          "Last Name": "SMS",
        });
        console.log(
          `🧪 Created test Lead for ${userEmail} -> ${to} leadId=${leadDoc._id}`
        );
      }
    }

    console.log(
      `📮 /api/messages/test-send user=${userEmail} to=${to} leadId=${leadDoc?._id || "n/a"}`
    );

    // Use the new object-form sender so we explicitly pass leadId (best source of truth)
    const result = await sendSms({
      to,
      body,
      userEmail,
      leadId: String(leadDoc?._id || ""),
    });

    // If suppressed (no SID), still return 200 with details for the UI
    if (!result.sid) {
      console.log(`⚠️ suppressed to=${to} messageId=${result.messageId}`);
      return res.status(200).json({
        message: "Suppressed (opt-out or policy)",
        suppressed: true,
        serviceSid: result.serviceSid,
        messageId: result.messageId,
        leadId: String(leadDoc?._id || ""),
      });
    }

    const payload: Record<string, any> = {
      message: result.scheduledAt ? "SMS scheduled" : "SMS accepted",
      sid: result.sid,
      serviceSid: result.serviceSid,
      messageId: result.messageId,
      leadId: String(leadDoc?._id || ""),
    };
    if (result.scheduledAt) payload.scheduledAt = result.scheduledAt;

    return res.status(200).json(payload);
  } catch (err: any) {
    console.error("❌ /api/messages/test-send error:", err?.message || err);
    return res.status(500).json({ message: err?.message || "Failed to send test SMS" });
  }
}
