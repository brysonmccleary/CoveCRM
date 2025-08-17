// /pages/api/twilio/voice/call.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import twilioClient from "@/lib/twilioClient";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");

function e164(num: string) {
  if (!num) return "";
  const d = num.replace(/\D+/g, "");
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (num.startsWith("+")) return num;
  return `+${d}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, agentPhone: agentPhoneRaw, fromNumber: fromNumberRaw } = req.body || {};
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  await dbConnect();

  const userEmail = String(session.user.email).toLowerCase();
  const user = await getUserByEmail(userEmail);
  if (!user) return res.status(404).json({ message: "User not found" });

  const lead: any = await Lead.findOne({ _id: leadId, userEmail }).lean();
  if (!lead) return res.status(404).json({ message: "Lead not found" });

  const leadPhone = e164(lead.Phone || lead.phone || "");
  if (!leadPhone) return res.status(400).json({ message: "Lead has no phone number" });

  const ownedNumbers: any[] = Array.isArray((user as any).numbers) ? (user as any).numbers : [];
  const fromNumber =
    e164(fromNumberRaw || ownedNumbers?.[0]?.phoneNumber || process.env.TWILIO_CALLER_ID || "");
  if (!fromNumber) return res.status(400).json({ message: "No Twilio number on account (fromNumber)" });

  const agentPhone =
    e164(
      agentPhoneRaw ||
      (user as any).agentPhone ||
      (user as any).phone ||
      (user as any).profile?.phone ||
      (user as any).personalPhone ||
      ""
    );
  if (!agentPhone) {
    return res.status(400).json({
      message:
        "Missing agent phone. Pass agentPhone in body, or set it on your user profile (e.g., user.agentPhone).",
    });
  }

  try {
    // We call the agent first; TwiML then bridges to lead (To=<leadPhone>).
    const twimlUrl = `${BASE_URL}/api/twilio/voice/answer?To=${encodeURIComponent(
      leadPhone
    )}&From=${encodeURIComponent(fromNumber)}&leadId=${encodeURIComponent(leadId)}`;

    const call = await twilioClient.calls.create({
      to: agentPhone,
      from: fromNumber,
      url: twimlUrl,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["completed"],
    });

    return res.status(200).json({ ok: true, callSid: call.sid });
  } catch (err: any) {
    console.error("❌ voice/call error:", err?.message || err);
    return res.status(500).json({ message: "Failed to initiate call", error: err?.message });
  }
}
