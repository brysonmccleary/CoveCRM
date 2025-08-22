// pages/api/twilio/amd-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import twilioClient from "@/lib/twilioClient";
import mongooseConnect from "@/lib/mongooseConnect";
import { getUserByPhoneNumber } from "@/lib/getUserByPhoneNumber";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Call from "@/models/Call";

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
// VM_POLICY = "hangup" | "play" | "observe"   (default: observe)
//  - observe: take no automatic action; let the agent hear greeting+beep and speak
//  - play:    auto-play MP3/TTS after beep, then hang up
//  - hangup:  end immediately on beep (no dead air)
const VM_POLICY = (process.env.VM_POLICY || "observe").toLowerCase();

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
    const From = params.get("From") || params.get("Caller") || "";  // outbound: our Twilio DID
    const To = params.get("To") || params.get("Called") || "";      // the lead number

    // Values vary by region:
    // 'human', 'machine', 'machine_start', 'machine_end', 'machine_end_beep', 'machine_end_silence', 'unknown'
    const AnsweredBy = (params.get("AnsweredBy") || "").toLowerCase();
    const MachineDetectionDuration = params.get("MachineDetectionDuration") || "";
    const MachineMessageEnd = (params.get("MachineMessageEnd") || "").toLowerCase(); // "true" when beep detected

    // ---- Resolve owning user (room) based on our number
    const owner =
      (await getUserByPhoneNumber(From)) ||
      (await getUserByPhoneNumber(To)) || // fallback for regional flips
      null;
    const userEmail =
      owner?.email?.toLowerCase?.() || (await resolveOwnerEmailByOwnedNumber(From)) || null;

    // ---- Update Call doc with AMD telemetry
    const callDoc = await Call.findOneAndUpdate(
      { callSid: CallSid },
      {
        $set: {
          amd: {
            answeredBy: AnsweredBy,
            messageEnd: MachineMessageEnd === "true",
            durationMs: MachineDetectionDuration ? Number(MachineDetectionDuration) : undefined,
            at: new Date(),
          },
        },
      },
      { new: true },
    );

    const leadId = callDoc?.leadId || null;

    const emitAmd = async (payload: any) => {
      try {
        const io = (res.socket as any)?.server?.io;
        if (io && userEmail) {
          io.to(userEmail).emit("call:amd", payload);
        }
      } catch (e) {
        console.warn("ℹ️ Socket emit (call:amd) failed:", (e as any)?.message || e);
      }
    };

    const addLeadHistory = async (text: string, meta?: any) => {
      if (!leadId) return;
      try {
        await Lead.updateOne(
          { _id: leadId },
          {
            $push: {
              history: {
                type: "call",
                message: text,
                meta: meta || {},
                createdAt: new Date(),
              },
            },
          },
        );
      } catch (e) {
        console.warn("⚠️ Failed to write lead history from AMD:", (e as any)?.message || e);
      }
    };

    // Emit AMD snapshot for the UI
    await emitAmd({
      callSid: CallSid,
      from: From,
      to: To,
      answeredBy: AnsweredBy,
      durationMs: MachineDetectionDuration ? Number(MachineDetectionDuration) : null,
      messageEnd: MachineMessageEnd === "true",
      timestamp: new Date().toISOString(),
      leadId: leadId ? String(leadId) : null,
    });

    // =========================
    // Decision tree (phone-like behavior)
    // =========================

    // 1) HUMAN — do NOT hang up. Let the agent talk immediately.
    if (AnsweredBy.includes("human")) {
      if (leadId) {
        await Call.updateOne({ callSid: CallSid }, { $set: { disposition: "answered" } });
        await addLeadHistory("Call answered (AMD: human).", { amd: AnsweredBy, policy: "observe" });
      }
      // No Twilio action — keep the call alive for live conversation.
      res.status(200).end();
      return;
    }

    // 2) MACHINE pre-beep — keep the leg alive so agent hears greeting and waits for beep
    const isMachinePreBeep =
      AnsweredBy === "machine" ||
      AnsweredBy === "machine_start" ||
      (AnsweredBy.startsWith("machine") && !AnsweredBy.includes("end"));
    if (isMachinePreBeep && MachineMessageEnd !== "true") {
      // No action; agent/browsers are already joined to the conference and can listen.
      res.status(200).end();
      return;
    }

    // 3) MACHINE with beep — default to observe so agent can leave a voicemail manually
    const beepDetected =
      AnsweredBy.includes("machine_end") || MachineMessageEnd === "true";
    if (beepDetected) {
      if (VM_POLICY === "play") {
        // Optional auto-drop path (only if explicitly configured)
        const vr = new twilio.twiml.VoiceResponse();
        if (VM_DROP_URL) vr.play(VM_DROP_URL);
        else vr.say({ voice: "Polly.Joanna" as any }, VM_DROP_TEXT);
        vr.hangup();

        try {
          await twilioClient.calls(CallSid).update({ twiml: vr.toString() });
          if (leadId) {
            await Call.updateOne({ callSid: CallSid }, { $set: { disposition: "voicemail_drop_left" } });
            await addLeadHistory("Voicemail drop left (AMD auto-play).", { amd: AnsweredBy, policy: "play" });
          }
        } catch (e: any) {
          console.warn("⚠️ Failed to play VM drop; leaving call as-is for manual voicemail:", e?.message || e);
        }
        res.status(200).end();
        return;
      }

      if (VM_POLICY === "hangup") {
        // Explicit hangup policy (not recommended for your desired UX)
        try {
          await twilioClient.calls(CallSid).update({ status: "completed" as any });
        } catch {}
        if (leadId) {
          await Call.updateOne({ callSid: CallSid }, { $set: { disposition: "voicemail_detected" } });
          await addLeadHistory("Voicemail detected (hangup policy).", { amd: AnsweredBy, policy: "hangup" });
        }
        res.status(200).end();
        return;
      }

      // Default (observe): do nothing — agent can start speaking after the beep.
      if (leadId) {
        await Call.updateOne({ callSid: CallSid }, { $set: { disposition: "voicemail_beep" } });
        await addLeadHistory("Voicemail beep detected (observing).", { amd: AnsweredBy, policy: "observe" });
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
