// /pages/api/twilio-recording.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

export const config = { api: { bodyParser: false } };

const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  ""
).replace(/\/$/, "");
const ALLOW_DEV_TWILIO_TEST =
  process.env.ALLOW_LOCAL_TWILIO_TEST === "1" &&
  process.env.NODE_ENV !== "production";

function validateTwilio(req: NextApiRequest, rawBody: Buffer) {
  const signature = (req.headers["x-twilio-signature"] || "") as string;
  const fullUrl = `${BASE_URL}${req.url || ""}`;
  try {
    const ok = twilio.validateRequest(
      AUTH_TOKEN,
      signature,
      fullUrl,
      Object.fromEntries(new URLSearchParams(rawBody.toString()) as any),
    );
    return ok;
  } catch {
    return false;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  const raw = await buffer(req);
  const valid = validateTwilio(req, raw);
  if (!valid && !ALLOW_DEV_TWILIO_TEST) {
    console.warn("❌ Invalid Twilio signature on recording callback");
    res.status(403).end("Invalid signature");
    return;
  }
  if (!valid && ALLOW_DEV_TWILIO_TEST) {
    console.warn(
      "⚠️ Dev bypass: Twilio signature validation skipped (recording).",
    );
  }

  const params = Object.fromEntries(new URLSearchParams(raw.toString()));
  const {
    CallSid,
    RecordingUrl,
    RecordingSid,
    RecordingStatus,
    RecordingDuration,
  } = params as any;

  // Optional helpers (if appended as query params on the webhook URL)
  const urlObj = new URL(req.url || "", "http://localhost");
  const userEmail = (urlObj.searchParams.get("userEmail") || "").toLowerCase();
  const leadId = urlObj.searchParams.get("leadId") || undefined;

  if (!CallSid || !RecordingSid || !RecordingUrl) {
    res.status(400).end("Missing required fields");
    return;
  }

  try {
    await dbConnect();

    const fullMp3Url = `${RecordingUrl}.mp3`;
    const durationNum =
      typeof RecordingDuration === "string" && RecordingDuration !== ""
        ? Number(RecordingDuration)
        : undefined;

    // Idempotent upsert by callSid
    await Call.updateOne(
      { callSid: CallSid },
      {
        $setOnInsert: {
          callSid: CallSid,
          direction: "outbound", // default; refine elsewhere if needed
          startedAt: new Date(), // seed if we never saw call start
        },
        $set: {
          ...(userEmail ? { userEmail } : {}),
          ...(leadId ? { leadId } : {}),
          recordingSid: RecordingSid,
          recordingUrl: fullMp3Url,
          recordingDuration: durationNum,
          recordingStatus: RecordingStatus || "completed",
          // completedAt reflects when we received a final recording event
          ...(RecordingStatus ? { completedAt: new Date() } : {}),
        },
      },
      { upsert: true },
    );

    // Only trigger AI worker when the recording is ready
    if ((RecordingStatus || "").toLowerCase() === "completed") {
      try {
        // Fire-and-forget; do not await
        fetch(`${BASE_URL}/api/ai/call-worker`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-worker-secret": process.env.AI_WORKER_SECRET || "",
          },
          body: JSON.stringify({ callSid: CallSid }),
          // @ts-ignore - Next.js hint to avoid caching
          next: { revalidate: 0 },
        }).catch(() => {});
      } catch {
        // ignore
      }
    }

    res.status(200).end("ok");
    return;
  } catch (err) {
    console.error("Recording callback error:", err);
    // Always 200 for Twilio webhooks (prevents retries spinning)
    res.status(200).end("ok");
    return;
  }
}
