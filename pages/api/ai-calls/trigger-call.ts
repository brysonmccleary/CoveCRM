import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "https://www.covecrm.com"
).replace(/\/$/, "");

function normalizeE164(value: any) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return String(value || "").startsWith("+") ? String(value || "") : "";
}

function ownedNumbers(user: any) {
  if (Array.isArray(user?.twilio?.phoneNumbers)) return user.twilio.phoneNumbers;
  if (Array.isArray(user?.numbers)) return user.numbers;
  return [];
}

function isOwnedNumber(user: any, fromNumber: string) {
  const from = normalizeE164(fromNumber);
  return ownedNumbers(user).some((entry: any) => {
    const phone = normalizeE164(entry?.phoneNumber || entry?.number || "");
    return phone && phone === from;
  });
}

async function validateFromInActiveAccount(client: any, fromNumber: string) {
  const found = await client.incomingPhoneNumbers.list({
    phoneNumber: fromNumber,
    limit: 1,
  });
  return Array.isArray(found) && found.length > 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const token = String(req.headers["x-api-secret"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.COVECRM_API_SECRET || token !== process.env.COVECRM_API_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { userEmail, leadId, leadPhone, scriptKey, fromNumber } = req.body || {};
  const email = String(userEmail || "").trim().toLowerCase();
  const to = normalizeE164(leadPhone);
  const from = normalizeE164(fromNumber);

  if (!email || !to || !from) {
    return res.status(400).json({ ok: false, error: "userEmail, leadPhone, and fromNumber are required" });
  }

  await mongooseConnect();

  const user = await User.findOne({ email }).lean<any>();
  if (!user || !isOwnedNumber(user, from)) {
    return res.status(403).json({ ok: false, error: "Cannot place call — user-owned number required" });
  }

  const { client } = await getClientForUser(email);
  const activeAccountHasNumber = await validateFromInActiveAccount(client, from);
  if (!activeAccountHasNumber) {
    return res.status(409).json({ ok: false, error: "Outbound number/account mismatch" });
  }

  const twimlUrl = new URL("/api/ai-calls/voice-twiml", BASE_URL);
  if (leadId) twimlUrl.searchParams.set("leadId", String(leadId));
  twimlUrl.searchParams.set("userEmail", email);
  if (scriptKey) twimlUrl.searchParams.set("scriptKey", String(scriptKey));

  const statusUrl = new URL("/api/ai-calls/status", BASE_URL);
  statusUrl.searchParams.set("userEmail", email);

  const call = await client.calls.create({
    to,
    from,
    url: twimlUrl.toString(),
    statusCallback: statusUrl.toString(),
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    record: true,
  });

  return res.status(200).json({ ok: true, callSid: call.sid, to });
}
