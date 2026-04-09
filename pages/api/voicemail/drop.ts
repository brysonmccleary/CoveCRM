// pages/api/voicemail/drop.ts
// POST — initiate a Twilio call to a lead with AMD; play voicemail when machine detected
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCallingAllowed } from "@/lib/billing/checkCallingAllowed";
import VoicemailDrop from "@/models/VoicemailDrop";
import User from "@/models/User";
import Lead from "@/models/Lead";
import twilio from "twilio";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  const billingCheck = await checkCallingAllowed(userEmail);
  if (!billingCheck.allowed) return res.status(402).json({ error: billingCheck.reason });

  const { toPhone, dropId, leadId } = req.body as { toPhone?: string; dropId?: string; leadId?: string };
  if (!toPhone) return res.status(400).json({ error: "toPhone required" });

  // Get voicemail drop (or default)
  let drop: any = null;
  if (dropId) {
    drop = await VoicemailDrop.findOne({ _id: dropId, userEmail }).lean();
  }
  if (!drop) {
    drop = await VoicemailDrop.findOne({ userEmail, isDefault: true }).lean();
  }
  if (!drop) {
    return res.status(404).json({ error: "No voicemail drop configured. Create one in Settings." });
  }

  // Get user's Twilio credentials
  const user = await User.findOne({ email: userEmail }).lean();
  const fromPhone = (user as any)?.numbers?.[0]?.phoneNumber;
  if (!fromPhone) return res.status(400).json({ error: "No phone number on account" });

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return res.status(500).json({ error: "Twilio not configured" });

  const client = twilio(accountSid, authToken);

  const twimlUrl = `${process.env.NEXTAUTH_URL}/api/twilio/voicemail-twiml?dropId=${drop._id}`;

  try {
    const call = await client.calls.create({
      to: toPhone,
      from: fromPhone,
      url: twimlUrl,
      machineDetection: "DetectMessageEnd",
      asyncAmd: "true",
      asyncAmdStatusCallback: twimlUrl + "&event=amd",
    });

    // Track drop count
    await VoicemailDrop.updateOne({ _id: drop._id }, { $inc: { dropCount: 1 } });

    // Log to lead history if leadId provided
    if (leadId) {
      try {
        const lead = await Lead.findById(leadId);
        if (lead && String(lead.userEmail || "").toLowerCase() === userEmail) {
          const droppedAt = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
          lead.history = lead.history || [];
          lead.history.push({
            type: "voicemail",
            message: `📱 Voicemail dropped at ${droppedAt} ET using "${drop.name}"`,
            userEmail,
            timestamp: new Date(),
            meta: { dropId: String(drop._id), callSid: call.sid },
          });
          await lead.save();
        }
      } catch (histErr: any) {
        console.warn("[voicemail-drop] Failed to log history:", histErr?.message);
      }
    }

    return res.status(200).json({ ok: true, callSid: call.sid });
  } catch (err: any) {
    console.error("[voicemail-drop] Twilio error:", err?.message);
    return res.status(500).json({ error: err?.message || "Failed to initiate call" });
  }
}
