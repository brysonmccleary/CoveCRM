// pages/api/twilio/amd-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import mongooseConnect from "@/lib/mongooseConnect";
import { getUserByPhoneNumber } from "@/lib/getUserByPhoneNumber";
import User from "@/models/User";

export const config = { api: { bodyParser: false } };

const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  ""
).replace(/\/$/, "");
const ALLOW_DEV_TWILIO_TEST =
  process.env.ALLOW_LOCAL_TWILIO_TEST === "1" &&
  process.env.NODE_ENV !== "production";

async function resolveOwnerEmailByOwnedNumber(num: string): Promise<string | null> {
  if (!num) return null;
  const owner =
    (await User.findOne({ "numbers.phoneNumber": num })) ||
    (await User.findOne({ "numbers.messagingServiceSid": num }));
  return owner?.email?.toLowerCase?.() || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  // Verify Twilio signature
  const raw = await buffer(req);
  const bodyStr = raw.toString("utf8");
  const params = new URLSearchParams(bodyStr);
  const signature = (req.headers["x-twilio-signature"] || "") as string;
  const requestUrl = `${BASE_URL}/api/twilio/amd-callback`;

  const valid = twilio.validateRequest(
    AUTH_TOKEN,
    signature,
    requestUrl,
    Object.fromEntries(params as any),
  );
  if (!valid && !ALLOW_DEV_TWILIO_TEST) {
    console.warn("❌ Invalid Twilio signature on amd-callback");
    res.status(403).end("Invalid signature");
    return;
  }
  if (!valid && ALLOW_DEV_TWILIO_TEST) {
    console.warn("⚠️ Dev bypass: Twilio signature validation skipped (amd-callback).");
  }

  try {
    await mongooseConnect();

    // Common AMD fields
    const CallSid = params.get("CallSid") || "";
    const From = params.get("From") || params.get("Caller") || "";  // our Twilio DID on outbound
    const To = params.get("To") || params.get("Called") || "";      // the lead
    const AnsweredBy = (params.get("AnsweredBy") || "").toLowerCase(); 
    // Possible values include: human, machine_start, machine_end_beep, machine_end_silence, unknown

    // Resolve owning user (room) based on our number (From)
    const owner =
      (await getUserByPhoneNumber(From)) ||
      (await getUserByPhoneNumber(To)) || // fallback if Twilio flips fields in some regions
      null;
    const userEmail =
      owner?.email?.toLowerCase?.() || (await resolveOwnerEmailByOwnedNumber(From)) || null;

    // Emit to the user’s socket room so the UI can show precise AMD state if desired
    try {
      const io = (res.socket as any)?.server?.io;
      if (io && userEmail) {
        io.to(userEmail).emit("call:amd", {
          callSid: CallSid,
          from: From,
          to: To,
          answeredBy: AnsweredBy, // e.g., 'machine_end_beep' means voicemail beep detected
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn("ℹ️ Socket emit (call:amd) failed:", (e as any)?.message || e);
    }

    // Log for observability
    console.log(`🔎 AMD: ${AnsweredBy} (From ${From} → To ${To}) [CallSid=${CallSid}]`);

    // Always 200 for Twilio webhooks
    res.status(200).end();
  } catch (err) {
    console.error("❌ AMD callback error:", err);
    res.status(200).end();
  }
}
