// /pages/api/twilio/voice/call.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import twilioClient from "@/lib/twilioClient";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  ""
).replace(/\/$/, "");

function e164(num: string) {
  if (!num) return "";
  const d = num.replace(/\D+/g, "");
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (num.startsWith("+")) return num.trim();
  return `+${d}`;
}

function identityFromEmail(email: string) {
  return String(email || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 120);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const { leadId, fromNumber: fromNumberRaw } = req.body || {};
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  await dbConnect();

  const userEmail = String(session.user.email).toLowerCase();
  const user = await getUserByEmail(userEmail);
  if (!user) return res.status(404).json({ message: "User not found" });

  const lead: any = await Lead.findOne({ _id: leadId, userEmail }).lean();
  if (!lead) return res.status(404).json({ message: "Lead not found" });

  const leadPhone = e164(lead.Phone || lead.phone || "");
  if (!leadPhone) return res.status(400).json({ message: "Lead has no phone number" });

  // Pick a FROM caller ID (your Twilio DID)
  const ownedNumbers: any[] = Array.isArray((user as any).numbers) ? (user as any).numbers : [];
  const fromNumber = e164(
    fromNumberRaw ||
      ownedNumbers?.[0]?.phoneNumber ||
      process.env.TWILIO_CALLER_ID ||
      ""
  );
  if (!fromNumber) {
    return res.status(400).json({ message: "No Twilio number on account (fromNumber)" });
  }

  // We DO NOT call the agent's personal phone.
  // We call the Twilio Client in the browser ("client:<identity>") and immediately bridge to the lead.
  const clientIdentity = identityFromEmail(userEmail);

  try {
    const twimlUrl =
      `${BASE_URL}/api/twilio/voice/answer` +
      `?To=${encodeURIComponent(leadPhone)}` +
      `&From=${encodeURIComponent(fromNumber)}` +
      `&leadId=${encodeURIComponent(leadId)}`;

    const call = await twilioClient.calls.create({
      // Ring the browser client (not PSTN)
      to: `client:${clientIdentity}`,
      from: fromNumber, // still required; used as callerId for the bridge leg
      url: twimlUrl,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["completed"],
    });

    return res.status(200).json({ success: true, callSid: call.sid });
  } catch (err: any) {
    console.error("❌ voice/call error:", err?.message || err);
    return res.status(500).json({ message: "Failed to initiate call", error: err?.message });
  }
}
