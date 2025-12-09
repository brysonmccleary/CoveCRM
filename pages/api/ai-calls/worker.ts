// pages/api/ai-calls/worker.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";
import AICallRecording from "@/models/AICallRecording";
import Lead from "@/models/Lead";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { isCallAllowedForLead } from "@/utils/checkCallTime";
import { Types } from "mongoose";

const BASE = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();

function normalizeE164(p?: string) {
  const raw = String(p || "");
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.startsWith("+") ? raw : `+${d}`;
}

const aiVoiceUrl = (sessionId: string, leadId: string) =>
  `${BASE}/api/ai-calls/voice/answer?sessionId=${encodeURIComponent(
    sessionId
  )}&leadId=${encodeURIComponent(leadId)}`;

const aiRecordingUrl = (sessionId: string, leadId: string) =>
  `${BASE}/api/ai-calls/recording-webhook?sessionId=${encodeURIComponent(
    sessionId
  )}&leadId=${encodeURIComponent(leadId)}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow both GET (for Vercel cron) and POST (manual / external triggers)
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  if (!AI_DIALER_CRON_KEY) {
    return res
      .status(500)
      .json({ ok: false, message: "AI dialer cron key not configured" });
  }

  // Accept secret via header OR query string (?key= / ?token=)
  const hdrKey = (req.headers["x-cron-key"] ||
    req.headers["x-cron-secret"] ||
    "") as string;

  const qsKey =
    (req.query.key as string | undefined) ||
    (req.query.token as string | undefined) ||
    "";

  const providedKey = (hdrKey || qsKey || "").trim();

  if (!providedKey || providedKey !== AI_DIALER_CRON_KEY) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  try {
    await mongooseConnect();

    // Find one active AI dial session to advance.
    // We keep it simple: pick the most recently updated queued/running session.
    const aiSession: any = await AICallSession.findOne({
      status: { $in: ["queued", "running"] },
      total: { $gt: 0 },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .exec();

    if (!aiSession) {
      return res.status(200).json({
        ok: true,
        message: "No AI dial sessions to process",
      });
    }

    const sessionId = String(aiSession._id);
    const userEmail = String(aiSession.userEmail || "").toLowerCase();
    const fromNumber = String(aiSession.fromNumber || "").trim();
    const leadIds: any[] = Array.isArray(aiSession.leadIds) ? aiSession.leadIds : [];
    const total = typeof aiSession.total === "number" ? aiSession.total : leadIds.length;
    const lastIndex = typeof aiSession.lastIndex === "number" ? aiSession.lastIndex : -1;

    if (!userEmail || !fromNumber || !leadIds.length || total <= 0) {
      aiSession.status = "error";
      aiSession.errorMessage =
        "Invalid AI session state (missing userEmail, fromNumber, or leadIds).";
      aiSession.completedAt = new Date();
      await aiSession.save();
      return res.status(200).json({
        ok: false,
        message: "Invalid AI session state; marked as error.",
      });
    }

    // Determine next index/lead
    const nextIndex = lastIndex + 1;
    if (nextIndex >= leadIds.length) {
      aiSession.status = "completed";
      aiSession.completedAt = new Date();
      await aiSession.save();
      return res.status(200).json({
        ok: true,
        message: "AI session completed (no remaining leads).",
        sessionId,
      });
    }

    const leadId = leadIds[nextIndex];
    if (!Types.ObjectId.isValid(String(leadId))) {
      aiSession.lastIndex = nextIndex;
      aiSession.errorMessage = "Encountered invalid leadId; skipping.";
      aiSession.status = "running";
      await aiSession.save();
      return res.status(200).json({
        ok: false,
        message: "Invalid leadId encountered; skipped.",
        sessionId,
        nextIndex,
      });
    }

    const leadDoc: any = await Lead.findOne({
      _id: leadId,
      $or: [
        { userEmail: userEmail },
        { ownerEmail: userEmail },
        { user: userEmail },
      ],
    }).lean();

    if (!leadDoc) {
      // Skip this lead and move on
      aiSession.lastIndex = nextIndex;
      aiSession.status = "running";
      await aiSession.save();

      return res.status(200).json({
        ok: false,
        message: "Lead not found or access denied; skipped.",
        sessionId,
        nextIndex,
      });
    }

    // Respect quiet hours with same helper as manual dialer
    const { allowed, zone } = isCallAllowedForLead(leadDoc);
    if (!allowed) {
      await AICallRecording.create({
        userEmail,
        leadId,
        aiCallSessionId: aiSession._id,
        callSid: `AIQUIET_${sessionId}_${String(leadId)}`,
        outcome: "callback",
        notes: `Skipped due to quiet hours (zone: ${zone || "unknown"})`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      aiSession.lastIndex = nextIndex;
      aiSession.status = "running";
      await aiSession.save();

      return res.status(200).json({
        ok: true,
        message: "Lead skipped due to quiet hours.",
        sessionId,
        nextIndex,
      });
    }

    // Resolve phone number
    const candidates = [
      leadDoc.phone,
      leadDoc.Phone,
      leadDoc.mobile,
      leadDoc.Mobile,
      leadDoc.primaryPhone,
      leadDoc["Primary Phone"],
    ].filter(Boolean);
    const toRaw = candidates[0];
    const to = normalizeE164(toRaw);
    if (!to) {
      await AICallRecording.create({
        userEmail,
        leadId,
        aiCallSessionId: aiSession._id,
        callSid: `AINO_PHONE_${sessionId}_${String(leadId)}`,
        outcome: "no_answer",
        notes: "Lead has no valid phone number",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      aiSession.lastIndex = nextIndex;
      aiSession.status = "running";
      await aiSession.save();

      return res.status(200).json({
        ok: false,
        message: "Lead has no valid phone number; skipped.",
        sessionId,
        nextIndex,
      });
    }

    const from = normalizeE164(fromNumber);
    if (!from) {
      aiSession.status = "error";
      aiSession.errorMessage = "AI session fromNumber is not a valid E.164 phone.";
      aiSession.completedAt = new Date();
      await aiSession.save();

      return res.status(200).json({
        ok: false,
        message: "Invalid fromNumber for AI session; session marked error.",
        sessionId,
      });
    }

    // Place the AI outbound call via user's Twilio client
    try {
      const { client, accountSidMasked } = await getClientForUser(userEmail);
      console.log("[ai-calls/worker] Using Twilio client for", {
        userEmail,
        accountSidMasked,
      });

      const call = await client.calls.create({
        to,
        from,
        url: aiVoiceUrl(sessionId, String(leadId)),
        // Record entire call at call-level; status callback goes to AI-specific endpoint
        record: "record-from-answer-dual",
        recordingStatusCallback: aiRecordingUrl(sessionId, String(leadId)),
        recordingStatusCallbackEvent: ["completed"],
        recordingStatusCallbackMethod: "POST",
      });

      await AICallRecording.findOneAndUpdate(
        { callSid: call.sid },
        {
          $setOnInsert: {
            userEmail,
            leadId,
            aiCallSessionId: aiSession._id,
            callSid: call.sid,
            outcome: "unknown",
            createdAt: new Date(),
          },
          $set: {
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      aiSession.lastIndex = nextIndex;
      aiSession.status = "running";
      aiSession.errorMessage = null;
      if (!aiSession.startedAt) aiSession.startedAt = new Date();
      await aiSession.save();

      return res.status(200).json({
        ok: true,
        message: "Placed AI outbound call.",
        sessionId,
        callSid: call.sid,
        leadId,
        to,
        from,
        nextIndex,
      });
    } catch (twilioErr: any) {
      // Twilio auth or API error
      console.error(
        "AI dial worker Twilio error:",
        twilioErr?.message || twilioErr
      );
      if (twilioErr?.code) {
        console.error("[Twilio] code:", twilioErr.code);
      }
      if (twilioErr?.status) {
        console.error("[Twilio] status:", twilioErr.status);
      }
      if (twilioErr?.moreInfo) {
        console.error("[Twilio] moreInfo:", twilioErr.moreInfo);
      }

      // If it's an auth error ("Authenticate" / 401), mark session as error
      const msg = String(twilioErr?.message || "").toLowerCase();
      if (msg.includes("authenticate") || twilioErr?.status === 401) {
        aiSession.status = "error";
        aiSession.errorMessage =
          "Twilio authentication failed for this AI session. Check Twilio credentials for this user.";
        aiSession.completedAt = new Date();
        await aiSession.save();

        return res.status(500).json({
          ok: false,
          message: "AI dial worker failed (Twilio authentication).",
          error: twilioErr?.message || String(twilioErr),
        });
      }

      // Otherwise, keep session running but log error against this lead
      aiSession.status = "running";
      aiSession.errorMessage = `Twilio error: ${twilioErr?.message || twilioErr}`;
      await aiSession.save();

      return res.status(500).json({
        ok: false,
        message: "AI dial worker Twilio error",
        error: twilioErr?.message || String(twilioErr),
      });
    }
  } catch (err: any) {
    console.error("AI dial worker error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      message: "AI dial worker failed",
      error: err?.message || String(err),
    });
  }
}
