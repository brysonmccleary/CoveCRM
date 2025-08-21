// pages/api/twilio/amd-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import twilioClient from "@/lib/twilioClient";
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

// VM policy controls
// VM_POLICY = "hangup" | "play"   (default: hangup)
const VM_POLICY = (process.env.VM_POLICY || "hangup").toLowerCase();
// If VM_POLICY = "play", prefer URL, else TTS text
const VM_DROP_URL = process.env.VM_DROP_URL || "";
const VM_DROP_TEXT =
  process.env.VM_DROP_TEXT ||
  "Sorry I missed you—please give me a call back when you can.";

// Resolve user by owned number (Twilio DID or Messaging Service)
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

  // ---- Verify Twilio signature
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

    // ---- Common AMD fields
    const CallSid = params.get("CallSid") || "";
    const From = params.get("From") || params.get("Caller") || "";  // for outbound, this is our Twilio DID
    const To = params.get("To") || params.get("Called") || "";      // the lead number

    // Twilio sends various AnsweredBy values with DetectMessageEnd + amdStatusCallback:
    // 'human', 'machine_start', 'machine_end_beep', 'machine_end_silence', 'unknown'
    const AnsweredBy = (params.get("AnsweredBy") || "").toLowerCase();
    const MachineDetectionDuration = params.get("MachineDetectionDuration") || "";
    const MachineMessageEnd = (params.get("MachineMessageEnd") || "").toLowerCase(); // "true" when beep detected

    // ---- Resolve owning user (room) based on our number
    const owner =
      (await getUserByPhoneNumber(From)) ||
      (await getUserByPhoneNumber(To)) || // fallback if Twilio flips fields in some regions
      null;
    const userEmail =
      owner?.email?.toLowerCase?.() || (await resolveOwnerEmailByOwnedNumber(From)) || null;

    // ---- Emit to the user’s socket room so UI can show AMD state
    try {
      const io = (res.socket as any)?.server?.io;
      if (io && userEmail) {
        io.to(userEmail).emit("call:amd", {
          callSid: CallSid,
          from: From,
          to: To,
          answeredBy: AnsweredBy,
          durationMs: MachineDetectionDuration ? Number(MachineDetectionDuration) : null,
          messageEnd: MachineMessageEnd === "true",
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn("ℹ️ Socket emit (call:amd) failed:", (e as any)?.message || e);
    }

    // ---- Log for observability
    console.log(
      `🔎 AMD sid=${CallSid} answeredBy=${AnsweredBy} msgEnd=${MachineMessageEnd} from=${From} to=${To}`
    );

    // =========================
    // AMD Decision Tree
    // =========================

    // 1) HUMAN — no agent leg in this flow, so end cleanly.
    if (AnsweredBy.includes("human")) {
      try {
        await twilioClient.calls(CallSid).update({ status: "completed" as any });
        console.log("🙋 Human detected → call ended immediately.");
      } catch (e: any) {
        console.warn("⚠️ End-on-human failed:", e?.message || e);
      }
      res.status(200).end();
      return;
    }

    // 2) MACHINE pre-beep — park quietly; we'll wait for machine_end/beep.
    const isMachinePreBeep =
      AnsweredBy === "machine" ||
      AnsweredBy === "machine_start" ||
      (AnsweredBy.startsWith("machine") && !AnsweredBy.includes("end"));
    if (isMachinePreBeep && MachineMessageEnd !== "true") {
      // No action yet; /api/voice/lead-park is already pausing the leg.
      res.status(200).end();
      return;
    }

    // 3) MACHINE with beep detected — act per policy
    const beepDetected =
      AnsweredBy.includes("machine_end") || MachineMessageEnd === "true";
    if (beepDetected) {
      if (VM_POLICY === "play") {
        // Build TwiML for drop then hang up
        const vr = new twilio.twiml.VoiceResponse();
        if (VM_DROP_URL) vr.play(VM_DROP_URL);
        else vr.say({ voice: "Polly.Joanna" as any }, VM_DROP_TEXT);
        vr.hangup();

        try {
          await twilioClient.calls(CallSid).update({ twiml: vr.toString() });
          console.log("💾 VM drop played & call ended (play policy).");
        } catch (e: any) {
          console.warn("⚠️ Failed to play VM drop, falling back to hangup:", e?.message || e);
          try {
            await twilioClient.calls(CallSid).update({ status: "completed" as any });
          } catch {}
        }
      } else {
        // Default policy: hang up immediately (no dead air)
        try {
          await twilioClient.calls(CallSid).update({ status: "completed" as any });
          console.log("✂️  Machine beep detected → call ended (hangup policy).");
        } catch (e: any) {
          console.warn("⚠️ Hangup on machine failed:", e?.message || e);
        }
      }

      res.status(200).end();
      return;
    }

    // 4) Unknown/other — acknowledge
    res.status(200).end();
  } catch (err) {
    console.error("❌ AMD callback error:", err);
    // Always 200 for Twilio webhooks so Twilio doesn't retry endlessly
    res.status(200).end();
  }
}
