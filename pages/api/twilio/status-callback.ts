import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import mongooseConnect from "@/lib/mongooseConnect";
import { getUserByPhoneNumber } from "@/lib/getUserByPhoneNumber";
import { trackUsage } from "@/lib/billing/trackUsage";
import User from "@/models/User";
import Message from "@/models/Message";
import Call from "@/models/Call";

export const config = { api: { bodyParser: false } };

// Voice: $0.02/min ≈ $0.000333/second
const CALL_COST_PER_SECOND = 0.000333;

const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const ALLOW_DEV_TWILIO_TEST = process.env.ALLOW_LOCAL_TWILIO_TEST === "1" && process.env.NODE_ENV !== "production";

// Terminal states (for rollups/billing). We purposely do NOT include "sent".
const TERMINAL_SMS_STATES = new Set(["delivered","failed","undelivered","canceled"]);
const TERMINAL_VOICE_STATES = new Set(["completed","busy","failed","no-answer","canceled"]);

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
  const requestUrl = `${BASE_URL}/api/twilio/status-callback`;

  const valid = twilio.validateRequest(AUTH_TOKEN, signature, requestUrl, Object.fromEntries(params as any));
  if (!valid && !ALLOW_DEV_TWILIO_TEST) {
    console.warn("❌ Invalid Twilio signature on status-callback");
    res.status(403).end("Invalid signature");
    return;
  }
  if (!valid && ALLOW_DEV_TWILIO_TEST) {
    console.warn("⚠️ Dev bypass: Twilio signature validation skipped (status-callback).");
  }

  try {
    await mongooseConnect();

    // Common fields
    const To = params.get("To") || params.get("Called") || "";
    const From = params.get("From") || params.get("Caller") || "";
    const MessagingServiceSid = params.get("MessagingServiceSid") || "";

    // ---- SMS fields
    const MessageSid = params.get("MessageSid") || params.get("SmsSid") || "";
    const rawSmsStatus = (params.get("MessageStatus") || params.get("SmsStatus") || "").toLowerCase();
    const MessageStatus = rawSmsStatus || "";
    const ErrorCode = params.get("ErrorCode") || undefined;

    // ---- Voice fields
    const CallSid = params.get("CallSid") || "";
    const callStatusRaw = (params.get("CallStatus") || "").toLowerCase(); // initiated | ringing | in-progress | completed | busy | failed | no-answer | canceled
    // Normalize for UI: treat "in-progress" exactly like "answered"
    const CallStatus = callStatusRaw === "in-progress" ? "answered" : callStatusRaw;

    const CallDurationStr = params.get("CallDuration"); // seconds (string) - present on completed
    const Timestamp = params.get("Timestamp") || undefined;

    // =========================
    // A) SMS status callbacks
    // =========================
    if (MessageSid && MessageStatus) {
      try {
        // Fetch current doc first so we can detect first terminal transition (avoid double-counting)
        const prev = await Message.findOne({ sid: MessageSid });
        const priorStatus = (prev?.status || "").toString().toLowerCase();

        // Build updates based on state transitions
        const now = new Date();
        const updates: any = { status: MessageStatus };
        if (ErrorCode) updates.errorCode = ErrorCode;

        // Record key timestamps
        if ((MessageStatus === "accepted" || MessageStatus === "sending" || MessageStatus === "sent") && !prev?.sentAt) {
          updates.sentAt = now;
        }
        if (MessageStatus === "scheduled" && !prev?.scheduledAt) {
          updates.scheduledAt = now; // may also be set pre-send for quiet hours
        }
        if (MessageStatus === "delivered") {
          updates.deliveredAt = now;
        }
        if (MessageStatus === "failed" || MessageStatus === "undelivered" || MessageStatus === "canceled") {
          updates.failedAt = now;
        }

        const msg = await Message.findOneAndUpdate({ sid: MessageSid }, { $set: updates }, { new: true });

        // Figure out which user to notify
        let userEmail: string | null = msg?.userEmail || null;
        if (!userEmail) {
          const userByFrom =
            (await User.findOne({ "numbers.phoneNumber": From })) ||
            (await User.findOne({ "numbers.messagingServiceSid": MessagingServiceSid }));
          if (userByFrom) userEmail = userByFrom.email?.toLowerCase?.() || null;
        }

        // Emit socket event for UI
        try {
          const io = (res.socket as any)?.server?.io;
          if (io && userEmail) {
            io.to(userEmail).emit("message:status", {
              leadId: msg?.leadId?.toString?.() || null,
              sid: MessageSid,
              status: MessageStatus,
              errorCode: ErrorCode || null,
              to: To,
              from: From,
            });
          }
        } catch (e) { console.warn("ℹ️ Socket emit (message:status) failed:", (e as any)?.message || e); }

        // Per-number usage rollup when entering a terminal state for the **first** time
        if (TERMINAL_SMS_STATES.has(MessageStatus) && !TERMINAL_SMS_STATES.has(priorStatus)) {
          const ownerUser =
            (await User.findOne({ "numbers.phoneNumber": From })) ||
            (await User.findOne({ "numbers.messagingServiceSid": MessagingServiceSid }));
          if (ownerUser) {
            const numberEntry = (ownerUser as any).numbers?.find((n: any) => n.phoneNumber === From);
            if (numberEntry) {
              numberEntry.usage = numberEntry.usage || { callsMade: 0, callsReceived: 0, textsSent: 0, textsReceived: 0, cost: 0 };
              numberEntry.usage.textsSent = (numberEntry.usage.textsSent || 0) + 1;
              await (ownerUser as any).save();
            }
          }
        }

        if (ErrorCode) {
          console.warn(`❗ SMS cb status=${MessageStatus} code=${ErrorCode} from=${From} -> to=${To} sid=${MessageSid}`);
        } else {
          const emoji =
            MessageStatus === "delivered" ? "✅" :
            MessageStatus === "failed" || MessageStatus === "undelivered" || MessageStatus === "canceled" ? "❌" :
            "📬";
          console.log(`${emoji} SMS cb status=${MessageStatus} from=${From} -> to=${To} sid=${MessageSid}`);
        }
      } catch (e) {
        console.warn("⚠️ SMS status-callback handling error:", (e as any)?.message || e);
      }
      // Always 200 for Twilio
      res.status(200).end();
      return;
    }

    // =========================
    // B) Voice lifecycle
    // =========================
    if (CallSid) {
      // Determine direction + owner number
      let direction: "inbound" | "outbound" = "outbound";
      let ownerNumber = From;
      let otherNumber = To;

      const inboundOwner = await getUserByPhoneNumber(To);
      const outboundOwner = await getUserByPhoneNumber(From);
      if (inboundOwner) { direction = "inbound"; ownerNumber = To; otherNumber = From; }
      else if (outboundOwner) { direction = "outbound"; ownerNumber = From; otherNumber = To; }

      const ownerUser = direction === "inbound" ? inboundOwner : outboundOwner;
      const userEmail =
        ownerUser?.email?.toLowerCase?.() ||
        (await resolveOwnerEmailByOwnedNumber(ownerNumber));

      const now = Timestamp ? new Date(Timestamp) : new Date();
      const durationSec = CallDurationStr ? parseInt(CallDurationStr, 10) || 0 : undefined;

      // ---- Emit FIRST so UI can react even if DB is unhappy
      try {
        const io = (res.socket as any)?.server?.io;
        if (io && userEmail) {
          io.to(userEmail).emit("call:status", {
            callSid: CallSid,
            status: CallStatus,            // initiated | ringing | answered | completed | busy | failed | no-answer | canceled
            direction,
            ownerNumber,
            otherNumber,
            durationSec: typeof durationSec === "number" ? durationSec : null,
            terminal: TERMINAL_VOICE_STATES.has(CallStatus),
            timestamp: now.toISOString(),
          });
        }
      } catch (e) { console.warn("ℹ️ Socket emit (call:status) failed:", (e as any)?.message || e); }

      // ---- Persist Call document (defensively)
      try {
        const setOnInsert: any = {
          callSid: CallSid,
          userEmail: userEmail || undefined,
          direction,
          startedAt: CallStatus === "answered" ? now : new Date(),
        };
        const set: any = {};
        if (CallStatus === "answered" || CallStatus === "ringing" || CallStatus === "initiated") set.startedAt = now;
        if (TERMINAL_VOICE_STATES.has(CallStatus)) {
          set.completedAt = now;
          if (typeof durationSec === "number") set.duration = durationSec;
          set.talkTime = CallStatus === "completed" ? Math.max(0, durationSec || 0) : 0;
        }
        await Call.updateOne({ callSid: CallSid }, { $setOnInsert: setOnInsert, $set: set }, { upsert: true });
      } catch (e) {
        console.warn("⚠️ Call doc upsert failed (continuing):", (e as any)?.message || e);
      }

      // ---- Usage/Billing (best effort)
      try {
        if (TERMINAL_VOICE_STATES.has(CallStatus) && ownerNumber) {
          const user = await getUserByPhoneNumber(ownerNumber);
          if (user) {
            const userDoc = await User.findById(user._id);
            const numberEntry = (userDoc as any)?.numbers?.find((n: any) => n.phoneNumber === ownerNumber);
            if (numberEntry) {
              numberEntry.usage = numberEntry.usage || { callsMade: 0, callsReceived: 0, textsSent: 0, textsReceived: 0, cost: 0 };
              if (direction === "inbound") numberEntry.usage.callsReceived += 1;
              if (direction === "outbound") numberEntry.usage.callsMade += 1;

              const sec = durationSec || 0;
              const usageCost = parseFloat((sec * CALL_COST_PER_SECOND).toFixed(6));
              numberEntry.usage.cost += usageCost;
              await (userDoc as any).save();

              await trackUsage({ user: userDoc, amount: usageCost, source: "twilio" });
              console.log(`📞 Tracked ${sec}s ${direction} call on ${ownerNumber} (cost $${usageCost}) [CallSid=${CallSid}, status=${CallStatus}]`);
            }
          }
        }
      } catch (e) {
        console.warn("⚠️ Billing/usage update failed (continuing):", (e as any)?.message || e);
      }

      const vEmoji =
        CallStatus === "answered" || CallStatus === "completed" ? "✅" :
        CallStatus === "failed" || CallStatus === "busy" || CallStatus === "no-answer" || CallStatus === "canceled" ? "❌" :
        "📞";
      console.log(`${vEmoji} Voice cb status=${CallStatus} dir=${direction} owner=${ownerNumber} other=${otherNumber} sid=${CallSid}`);

      res.status(200).end();
      return;
    }

    // Unknown payload — acknowledge
    console.log("ℹ️ Unknown status-callback payload received.");
    res.status(200).end();
    return;
  } catch (err) {
    console.error("❌ Twilio status callback error:", err);
    // Always 200 for Twilio webhooks
    res.status(200).end();
  }
}
