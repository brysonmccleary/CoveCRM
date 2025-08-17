// pages/api/twilio/status-callback.ts
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
const ALLOW_DEV_TWILIO_TEST =
  process.env.ALLOW_LOCAL_TWILIO_TEST === "1" && process.env.NODE_ENV !== "production";

// Final SMS states we care about
const TERMINAL_SMS_STATES = new Set(["delivered", "failed", "undelivered", "sent"]);

// Voice terminal statuses (Twilio may end with any of these)
const TERMINAL_VOICE_STATES = new Set(["completed", "busy", "failed", "no-answer"]);

// Helper: resolve which user owns a Twilio number (for direction + ownership)
async function resolveOwnerEmailByOwnedNumber(num: string): Promise<string | null> {
  if (!num) return null;
  const owner =
    (await User.findOne({ "numbers.phoneNumber": num })) ||
    (await User.findOne({ "numbers.messagingServiceSid": num })); // allow MSID as fallback
  return owner?.email?.toLowerCase?.() || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  // ---- Verify Twilio signature (allow dev bypass)
  const raw = await buffer(req);
  const bodyStr = raw.toString("utf8");
  const params = new URLSearchParams(bodyStr);
  const signature = (req.headers["x-twilio-signature"] || "") as string;
  const requestUrl = `${BASE_URL}/api/twilio/status-callback`;

  const valid = twilio.validateRequest(
    AUTH_TOKEN,
    signature,
    requestUrl,
    Object.fromEntries(params as any)
  );
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
    const To = params.get("To") || params.get("Called") || ""; // SMS or Voice
    const From = params.get("From") || params.get("Caller") || ""; // SMS or Voice
    const MessagingServiceSid = params.get("MessagingServiceSid") || "";

    // ---- SMS fields
    const MessageSid = params.get("MessageSid") || params.get("SmsSid") || "";
    const rawStatus = (params.get("MessageStatus") || params.get("SmsStatus") || "").toLowerCase();
    const MessageStatus = rawStatus || "";
    const ErrorCode = params.get("ErrorCode") || undefined;

    // ---- Voice fields
    const CallSid = params.get("CallSid") || "";
    const CallStatus = (params.get("CallStatus") || "").toLowerCase(); // initiated | ringing | answered | completed | busy | failed | no-answer
    const CallDurationStr = params.get("CallDuration"); // seconds (string) - present on completed
    // Some Twilio webhooks include Timestamp, but it’s not guaranteed:
    const Timestamp = params.get("Timestamp") || undefined;

    // =========================
    // A) SMS status callbacks
    // =========================
    if (MessageSid && MessageStatus) {
      // Primary: update by SID (most reliable)
      const updates: any = { status: MessageStatus };
      if (ErrorCode) updates.errorCode = ErrorCode;
      if (MessageStatus === "delivered") updates.deliveredAt = new Date();

      const msg = await Message.findOneAndUpdate(
        { sid: MessageSid },
        { $set: updates },
        { new: true }
      );

      // Figure out which user to notify
      let userEmail: string | null = msg?.userEmail || null;

      // Fallbacks if the Message doc wasn't found or lacked userEmail:
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
        } else if (!userEmail) {
          console.warn("⚠️ Status-callback: could not resolve user", {
            MessageSid,
            From,
            To,
            MessagingServiceSid,
          });
        }
      } catch (e) {
        console.warn("ℹ️ Socket emit (message:status) failed:", (e as any)?.message || e);
      }

      // Per-number usage rollup when we hit a terminal status
      if (TERMINAL_SMS_STATES.has(MessageStatus)) {
        const ownerUser =
          (await User.findOne({ "numbers.phoneNumber": From })) ||
          (await User.findOne({ "numbers.messagingServiceSid": MessagingServiceSid }));
        if (ownerUser) {
          const numberEntry = (ownerUser as any).numbers?.find((n: any) => n.phoneNumber === From);
          if (numberEntry) {
            numberEntry.usage = numberEntry.usage || {
              callsMade: 0,
              callsReceived: 0,
              textsSent: 0,
              textsReceived: 0,
              cost: 0,
            };
            numberEntry.usage.textsSent = (numberEntry.usage.textsSent || 0) + 1;
            await (ownerUser as any).save();
          }
        }
      }

      if (ErrorCode) {
        console.warn(
          `⚠️ SMS error for ${From} -> ${To}: status=${MessageStatus} code=${ErrorCode} sid=${MessageSid}`
        );
      } else {
        console.log(`📬 SMS status ${MessageStatus} for ${From} -> ${To} (sid ${MessageSid})`);
      }

      res.status(200).end();
      return;
    }

    // =========================
    // B) Voice lifecycle + duration billing
    // =========================
    if (CallSid) {
      // Determine which side is "ours" to infer direction and owner
      // Inbound: To (Called) is our Twilio number
      // Outbound: From (Caller) is our Twilio number
      let direction: "inbound" | "outbound" = "outbound";
      let ownerNumber = From; // for outbound, our owned number is typically From
      let otherNumber = To;

      const inboundOwner = await getUserByPhoneNumber(To);
      const outboundOwner = await getUserByPhoneNumber(From);
      if (inboundOwner) {
        direction = "inbound";
        ownerNumber = To;
        otherNumber = From;
      } else if (outboundOwner) {
        direction = "outbound";
        ownerNumber = From;
        otherNumber = To;
      }

      const ownerUser = direction === "inbound" ? inboundOwner : outboundOwner;
      const userEmail =
        ownerUser?.email?.toLowerCase?.() || (await resolveOwnerEmailByOwnedNumber(ownerNumber));

      // Build updates based on status
      const now = Timestamp ? new Date(Timestamp) : new Date();
      const durationSec = CallDurationStr ? parseInt(CallDurationStr, 10) || 0 : undefined;

      const setOnInsert: any = {
        callSid: CallSid,
        userEmail: userEmail || undefined,
        direction,
        startedAt: CallStatus === "answered" ? now : new Date(), // seed; will be corrected on "answered"
      };

      const set: any = {};
      // Keep a best-effort startedAt
      if (CallStatus === "answered" || CallStatus === "ringing" || CallStatus === "initiated") {
        set.startedAt = now;
      }

      // Treat all terminal states as completion for dashboard counts
      if (TERMINAL_VOICE_STATES.has(CallStatus)) {
        set.completedAt = now;

        if (typeof durationSec === "number") {
          set.duration = durationSec;
        }
        // talkTime = duration for answered/completed, 0 for non-answered terminals
        if (CallStatus === "completed") {
          set.talkTime = Math.max(0, durationSec || 0);
        } else {
          set.talkTime = 0;
        }
      }

      // Upsert Call document (idempotent by CallSid)
      await Call.updateOne(
        { callSid: CallSid },
        {
          $setOnInsert: setOnInsert,
          $set: set,
        },
        { upsert: true }
      );

      // ------- Usage/Billing for completed calls (existing behavior preserved)
      if (TERMINAL_VOICE_STATES.has(CallStatus) && ownerNumber) {
        const user = await getUserByPhoneNumber(ownerNumber);
        if (user) {
          const userDoc = await User.findById(user._id);
          const numberEntry = (userDoc as any)?.numbers?.find((n: any) => n.phoneNumber === ownerNumber);
          if (numberEntry) {
            numberEntry.usage = numberEntry.usage || {
              callsMade: 0,
              callsReceived: 0,
              textsSent: 0,
              textsReceived: 0,
              cost: 0,
            };
            if (direction === "inbound") numberEntry.usage.callsReceived += 1;
            if (direction === "outbound") numberEntry.usage.callsMade += 1;

            const sec = durationSec || 0;
            const usageCost = parseFloat((sec * CALL_COST_PER_SECOND).toFixed(6));
            numberEntry.usage.cost += usageCost;
            await (userDoc as any).save();

            // Only track cost when we have a real duration (completed answered calls)
            await trackUsage({ user: userDoc, amount: usageCost, source: "twilio" });
            console.log(
              `📞 Tracked ${sec}s ${direction} call on ${ownerNumber} (cost $${usageCost}) [CallSid=${CallSid}, status=${CallStatus}]`
            );
          }
        }
      }

      res.status(200).end();
      return;
    }

    // Nothing we recognize; acknowledge so Twilio stops retrying
    res.status(200).end();
    return;
  } catch (err) {
    console.error("❌ Twilio status callback error:", err);
    // Always 200 for Twilio webhooks
    res.status(200).end();
    return;
  }
}
