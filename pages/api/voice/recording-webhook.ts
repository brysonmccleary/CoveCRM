import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import User from "@/models/User";
import { getUserByPhoneNumber } from "@/lib/getUserByPhoneNumber";

export const config = { api: { bodyParser: false } };

const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const ALLOW_DEV_TWILIO_TEST = process.env.ALLOW_LOCAL_TWILIO_TEST === "1" && process.env.NODE_ENV !== "production";

// Optional global kill-switch; and we also require user.hasAI=true before doing any AI work
const CALL_AI_SUMMARY_ENABLED =
  (process.env.CALL_AI_SUMMARY_ENABLED || "").toLowerCase() === "1" ||
  (process.env.CALL_AI_SUMMARY_ENABLED || "").toLowerCase() === "true";

// Helper: resolve which user owns a Twilio number
async function resolveOwnerEmailByOwnedNumber(num: string): Promise<string | null> {
  if (!num) return null;
  const owner =
    (await User.findOne({ "numbers.phoneNumber": num })) ||
    (await User.findOne({ "numbers.messagingServiceSid": num }));
  return owner?.email?.toLowerCase?.() || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.status(405).end("Method Not Allowed"); return; }

  // ---- Verify Twilio signature (allow dev bypass)
  const raw = await buffer(req);
  const bodyStr = raw.toString("utf8");
  const params = new URLSearchParams(bodyStr);
  const signature = (req.headers["x-twilio-signature"] || "") as string;
  const requestUrl = `${BASE_URL}/api/voice/recording-webhook`;

  const valid = twilio.validateRequest(AUTH_TOKEN, signature, requestUrl, Object.fromEntries(params as any));
  if (!valid && !ALLOW_DEV_TWILIO_TEST) {
    console.warn("❌ Invalid Twilio signature on recording-webhook");
    res.status(403).end("Invalid signature");
    return;
  }
  if (!valid && ALLOW_DEV_TWILIO_TEST) {
    console.warn("⚠️ Dev bypass: Twilio signature validation skipped (recording-webhook).");
  }

  try {
    await dbConnect();

    // ---- Core Twilio fields
    const CallSid = params.get("CallSid") || "";
    const RecordingSid = params.get("RecordingSid") || "";
    const RecordingStatus = (params.get("RecordingStatus") || "").toLowerCase(); // completed | processing | failed | ...
    const RecordingUrlRaw = params.get("RecordingUrl") || ""; // often without extension
    const RecordingDurationStr = params.get("RecordingDuration") || ""; // seconds (string)
    const ConferenceName = params.get("ConferenceName") || params.get("conferenceName") || "";

    const From = params.get("From") || params.get("Caller") || "";
    const To = params.get("To") || params.get("Called") || "";
    const Timestamp = params.get("Timestamp") || undefined;

    // Normalize URL → prefer mp3
    const recordingUrl =
      RecordingUrlRaw
        ? (RecordingUrlRaw.endsWith(".mp3") || RecordingUrlRaw.endsWith(".wav"))
          ? RecordingUrlRaw
          : `${RecordingUrlRaw}.mp3`
        : "";
    const recordingDuration = RecordingDurationStr ? parseInt(RecordingDurationStr, 10) || undefined : undefined;
    const now = Timestamp ? new Date(Timestamp) : new Date();

    // ---- Resolve owner / user
    const inboundOwner = await getUserByPhoneNumber(To);
    const outboundOwner = await getUserByPhoneNumber(From);
    const direction: "inbound" | "outbound" = inboundOwner ? "inbound" : "outbound";
    const ownerNumber = inboundOwner ? To : From;
    const userEmail =
      (inboundOwner?.email?.toLowerCase?.() ||
       outboundOwner?.email?.toLowerCase?.() ||
       (await resolveOwnerEmailByOwnedNumber(ownerNumber)) ||
       undefined) as string | undefined;

    // ---- Find an existing Call doc by reliable keys (prefer CallSid)
    const callDoc =
      (CallSid && (await Call.findOne({ callSid: CallSid }))) ||
      (RecordingSid && (await Call.findOne({ recordingSid: RecordingSid }))) ||
      null;

    // ---- Build updates
    const setBase: any = {
      recordingSid: RecordingSid || undefined,
      recordingUrl: recordingUrl || undefined,
      recordingStatus: RecordingStatus || undefined,
      recordingDuration: recordingDuration,
    };

    // If Twilio marks as completed, update completion/timing if missing
    if (RecordingStatus === "completed") {
      setBase.completedAt = callDoc?.completedAt || now;
      if (typeof recordingDuration === "number" && recordingDuration >= 0) {
        // If duration not yet set on the call, use recordingDuration as fallback
        if (typeof (callDoc as any)?.duration !== "number") setBase.duration = recordingDuration;
      }
    }

    // ---- Upsert logic
    if (callDoc) {
      await Call.updateOne(
        { _id: callDoc._id },
        {
          $set: {
            ...setBase,
            userEmail: callDoc.userEmail || userEmail, // preserve if previously known
            direction: callDoc.direction || direction,
          },
        },
      );
    } else if (CallSid) {
      // Create or update by CallSid
      await Call.updateOne(
        { callSid: CallSid },
        {
          $setOnInsert: {
            callSid: CallSid,
            userEmail,
            direction,
            startedAt: now,
          },
          $set: setBase,
        },
        { upsert: true },
      );
    } else {
      // No reliable identifier—ack and bail
      console.warn("⚠️ Recording webhook without CallSid; skipping upsert.", { RecordingSid, ConferenceName });
      res.status(200).end();
      return;
    }

    // ---- Emit live update for UI
    try {
      const io = (res.socket as any)?.server?.io;
      if (io && userEmail) {
        io.to(userEmail).emit("call:updated", {
          callSid: CallSid || RecordingSid,
          status: RecordingStatus || "recorded",
          recordingUrl,
          recordingSid: RecordingSid || null,
          durationSec: recordingDuration || null,
          timestamp: now.toISOString(),
        });
      }
    } catch (e) {
      console.warn("ℹ️ Socket emit (call:updated) failed:", (e as any)?.message || e);
    }

    // ---- AI gate: only mark pending if env enabled AND the user has AI
    if (RecordingStatus === "completed" && recordingUrl) {
      try {
        const user =
          (userEmail && (await User.findOne({ email: userEmail }))) || null;
        const aiAllowed = !!(user?.hasAI && CALL_AI_SUMMARY_ENABLED);

        if (aiAllowed) {
          await Call.updateOne(
            { callSid: CallSid || (callDoc as any)?.callSid || undefined },
            { $set: { aiProcessing: "pending" } },
          );
          // (Optional) kick off your background summarizer here if you have a worker/cron
          // e.g. await fetch(`${BASE_URL}/api/ai/process-call`, { method: "POST", headers: {...}, body: JSON.stringify({ callSid: CallSid, url: recordingUrl }) });
        }
      } catch (e) {
        console.warn("ℹ️ Skipped AI queue:", (e as any)?.message || e);
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error("❌ Recording webhook error:", err);
    // Always 200 so Twilio doesn't retry infinitely
    res.status(200).end();
  }
}
