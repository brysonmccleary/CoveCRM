// lib/ai/dialSession/startAiDialSession.ts
// Core logic for starting an AI dial session, extracted from
// pages/api/calls/ai-dial-session.ts so it can be reused by both the HTTP
// route and the assistant's start_dial_session tool without an internal
// self-HTTP call. Behavior is unchanged from the original handler.

import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/lib/mongo/leads";
import AISettings from "@/models/AISettings";
import CallLog from "@/models/CallLog";
import { Types } from "mongoose";

const AI_VOICE_HTTP_BASE = (
  process.env.AI_VOICE_HTTP_BASE ||
  (process.env.AI_VOICE_STREAM_URL || "")
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://")
).replace(/\/$/, "");

const COVECRM_API_SECRET = process.env.COVECRM_API_SECRET || "";

function normalizePhone(p: string): string {
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return p;
}

function isWithinBusinessHours(settings: any): boolean {
  if (!settings?.businessHoursOnly) return true;

  const tz = settings.businessHoursStart && settings.businessHoursTimezone
    ? settings.businessHoursTimezone
    : "America/Phoenix";
  const startStr = settings.businessHoursStart || "09:00";
  const endStr = settings.businessHoursEnd || "18:00";

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const hStr = parts.find((p) => p.type === "hour")?.value || "0";
  const mStr = parts.find((p) => p.type === "minute")?.value || "0";
  const currentMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

  const [startH, startM] = startStr.split(":").map(Number);
  const [endH, endM] = endStr.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

export type StartAiDialSessionResult =
  | { ok: true; sessionId: string; totalLeads: number; message: string }
  | { ok: false; status: number; error: string };

export async function startAiDialSession(args: {
  email: string;
  leadIds: string[];
  scriptKey?: string;
}): Promise<StartAiDialSessionResult> {
  const email = String(args.email || "").toLowerCase();
  const leadIds = args.leadIds;
  const scriptKey = args.scriptKey;

  if (!email) return { ok: false, status: 401, error: "Unauthorized" };

  if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
    return { ok: false, status: 400, error: "leadIds array is required" };
  }

  await mongooseConnect();

  const aiSettings = (await AISettings.findOne({ userEmail: email }).lean()) as any;
  if (!aiSettings?.aiDialSessionEnabled) {
    return {
      ok: false,
      status: 403,
      error: "AI Dial Sessions are not enabled. Enable them in AI Settings.",
    };
  }

  if (!isWithinBusinessHours(aiSettings)) {
    return { ok: false, status: 409, error: "Outside business hours. AI dial session blocked." };
  }

  if (!AI_VOICE_HTTP_BASE || !COVECRM_API_SECRET) {
    return { ok: false, status: 503, error: "AI voice server not configured." };
  }

  // Fetch leads — skip DNC leads and already-booked leads
  const validIds = leadIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  const leads = (await Lead.find({
    _id: { $in: validIds },
    $or: [{ userEmail: email }, { ownerEmail: email }],
    doNotCall: { $ne: true }, // skip DNC leads
    appointmentTime: { $exists: false }, // skip already-booked leads
  }).lean()) as any[];

  if (leads.length === 0) {
    return { ok: false, status: 404, error: "No accessible leads found" };
  }

  const sessionId = new Types.ObjectId().toString();

  // Fire calls in the background — matches the original handler's fire-and-forget behavior.
  (async () => {
    for (const lead of leads) {
      const phone = lead.Phone || lead.phone || "";
      if (!phone) continue;

      const toPhone = normalizePhone(phone);

      try {
        const resp = await fetch(`${AI_VOICE_HTTP_BASE}/trigger-call`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-secret": COVECRM_API_SECRET,
          },
          body: JSON.stringify({
            userEmail: email,
            leadId: String(lead._id),
            leadPhone: toPhone,
            scriptKey: scriptKey || "default",
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (resp.ok) {
          await CallLog.create({
            userEmail: email,
            leadId: lead._id,
            phoneNumber: toPhone,
            direction: "outbound",
            kind: "ai_dial_session",
            status: "initiated",
            durationSeconds: 0,
            timestamp: new Date(),
          }).catch(() => {});
        }
      } catch (err: any) {
        console.error(`[ai-dial-session] Error triggering call for lead ${lead._id}:`, err?.message);
      }

      // Small gap between calls to avoid hammering
      await new Promise((r) => setTimeout(r, 2000));
    }
  })().catch((err) => console.error("[ai-dial-session] Session error:", err?.message));

  return {
    ok: true,
    sessionId,
    totalLeads: leads.length,
    message: `AI dial session started for ${leads.length} lead(s)`,
  };
}
