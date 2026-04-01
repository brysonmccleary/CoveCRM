// lib/ai/triggerAIFirstCall.ts
// Safety-gated helper — checks ALL guards before triggering AI first call.
// NEVER call this from CSV import, bulk import, or DOI prospecting paths.
//
// CALL DECISION HIERARCHY (evaluated top to bottom):
//   1.  Account-level:   AISettings.aiNewLeadCallEnabled must be true
//   2.  Lead fetch:      lead must exist
//   3.  Phone:           lead must have Phone
//   4.  Source allowlist: ONLY facebook_lead / google_sheets_live may call — all others blocked
//   5.  DNC guard:       lead.doNotCall === true → skip (never AI-call DNC numbers)
//   6.  Booked guard:    lead.appointmentTime set → skip (already has appointment)
//   7.  Status guard:    terminal lead statuses → skip
//   8.  Attempt guard:   aiFirstCallAttemptedAt already set → skip (hard one-call-max, no exceptions)
//   9.  Folder:          folder.aiFirstCallEnabled must be true
//  10.  Real-time:       if folder.aiRealTimeOnly, lead.realTimeEligible must be true
//  11.  Age gate:        lead created before folder.aiEnabledAt → skip
//  12.  Business hours:  aiSettings.businessHoursOnly → check timezone window (FAIL-SAFE)
//  13.  Atomic lock:     atomically mark "pending" before delay — prevents race/duplicate
//  14.  Delay:           folder.aiFirstCallDelayMinutes → aiSettings.newLeadCallDelayMinutes → 1
//  15.  Fire:            POST to voice server /trigger-call

import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import AISettings from "@/models/AISettings";

const AI_VOICE_SERVER_URL = (
  process.env.AI_VOICE_HTTP_BASE ||
  (process.env.AI_VOICE_STREAM_URL || "").replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://")
).replace(/\/$/, "");

const COVECRM_API_SECRET = process.env.COVECRM_API_SECRET || "";

// Statuses that mean the lead is fully resolved — AI must not call
const TERMINAL_STATUSES = new Set([
  "Booked Appointment",
  "booked appointment",
  "Not Interested",
  "not interested",
  "Sold",
  "sold",
  "Do Not Contact",
  "do not contact",
  "DNC",
  "dnc",
]);


/**
 * Returns true if current time is within business hours.
 * On ANY parse/validation error, returns false (fail-safe) when businessHoursOnly is enabled.
 * Callers must only call this when businessHoursOnly=true.
 */
function isWithinBusinessHours(start: string, end: string, timezone: string): boolean {
  try {
    if (!timezone || !start || !end) {
      console.warn("[triggerAIFirstCall] isWithinBusinessHours: missing start/end/timezone — failing safe (blocking call)");
      return false;
    }
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === "hour")?.value;
    const minutePart = parts.find((p) => p.type === "minute")?.value;
    if (!hourPart || !minutePart) {
      console.warn("[triggerAIFirstCall] isWithinBusinessHours: Intl parse produced no hour/minute parts — failing safe");
      return false;
    }
    const hour = parseInt(hourPart);
    const minute = parseInt(minutePart);
    if (isNaN(hour) || isNaN(minute)) {
      console.warn("[triggerAIFirstCall] isWithinBusinessHours: NaN from hour/minute parsing — failing safe");
      return false;
    }
    const currentMinutes = hour * 60 + minute;
    const startParts = start.split(":");
    const endParts = end.split(":");
    if (startParts.length < 2 || endParts.length < 2) {
      console.warn("[triggerAIFirstCall] isWithinBusinessHours: invalid HH:MM format — failing safe");
      return false;
    }
    const startH = parseInt(startParts[0]);
    const startM = parseInt(startParts[1]);
    const endH = parseInt(endParts[0]);
    const endM = parseInt(endParts[1]);
    if ([startH, startM, endH, endM].some(isNaN)) {
      console.warn("[triggerAIFirstCall] isWithinBusinessHours: NaN in schedule parts — failing safe");
      return false;
    }
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } catch (err: any) {
    console.warn("[triggerAIFirstCall] isWithinBusinessHours: exception — failing safe:", err?.message);
    return false; // fail safe — if we can't determine hours, block the call
  }
}

export async function triggerAIFirstCall(
  leadId: string,
  folderId: string,
  userEmail: string
): Promise<void> {
  if (!AI_VOICE_SERVER_URL || !COVECRM_API_SECRET) {
    console.warn("[triggerAIFirstCall] Missing env vars — skipping");
    return;
  }

  try {
    // Guard 1 — account-level AI toggle (check FIRST before any DB lead/folder queries)
    const aiSettings = await AISettings.findOne({ userEmail }).lean() as any;
    if (!aiSettings?.aiNewLeadCallEnabled) {
      console.info(`[triggerAIFirstCall] Account-level AI disabled for ${userEmail} — skipping`);
      return;
    }

    // Guard 2 — fetch lead
    const lead = await Lead.findById(leadId).lean() as any;
    if (!lead) return;

    // Guard 3 — must have phone
    if (!lead.Phone) {
      console.info(`[triggerAIFirstCall] No phone on lead ${leadId} — skipping`);
      return;
    }

    // Guard 4 — source allowlist: ONLY Facebook leads and Google Sheets live syncs may trigger AI first call.
    // All other sources (csv_import, manual_import, doi_prospecting, manual_live, form_submission, api_live, etc.) are blocked.
    const ALLOWED_AI_FIRST_CALL_SOURCES = ["facebook_lead", "google_sheets_live"];
    if (!ALLOWED_AI_FIRST_CALL_SOURCES.includes(lead.sourceType)) {
      console.info(`[triggerAIFirstCall] Lead ${leadId} sourceType=${lead.sourceType} not in allowlist — skipping`);
      return;
    }

    // Guard 5 — DNC: never AI-call a lead who has opted out
    if (lead.doNotCall === true) {
      console.info(`[triggerAIFirstCall] Lead ${leadId} is DNC — AI calling blocked`);
      return;
    }

    // Guard 6 — Booked: don't AI-call leads that already have an appointment
    if (lead.appointmentTime) {
      console.info(`[triggerAIFirstCall] Lead ${leadId} already has appointmentTime — skipping`);
      return;
    }

    // Guard 7 — Terminal status: lead is in a resolved state
    const leadStatus = String(lead.status || "").trim();
    if (leadStatus && TERMINAL_STATUSES.has(leadStatus)) {
      console.info(`[triggerAIFirstCall] Lead ${leadId} has terminal status "${leadStatus}" — skipping`);
      return;
    }

    // Guard 8 — Hard one-call-per-lead guarantee.
    // Once aiFirstCallAttemptedAt is set this lead is permanently locked — no retries, no recovery.
    // The former stale-pending recovery was removed to enforce strict one-call-max semantics.
    if (lead.aiFirstCallAttemptedAt) {
      console.info(`[triggerAIFirstCall] Lead ${leadId} already claimed (status=${lead.aiFirstCallStatus}) — one-call-max enforced, skipping`);
      return;
    }

    // Guard 9 — folder must have aiFirstCallEnabled
    const folder = await Folder.findById(folderId).lean() as any;
    if (!folder?.aiFirstCallEnabled) {
      console.info(`[triggerAIFirstCall] Folder ${folderId} aiFirstCallEnabled=false — skipping`);
      return;
    }

    // Guard 10 — aiRealTimeOnly: if set, lead must have realTimeEligible=true
    if (folder.aiRealTimeOnly && !lead.realTimeEligible) {
      console.info(`[triggerAIFirstCall] Folder ${folderId} requires realTimeEligible leads — lead ${leadId} skipped`);
      return;
    }

    // Guard 11 — lead must be created AFTER aiEnabledAt (no retroactive blasting)
    if (folder.aiEnabledAt) {
      if (new Date(lead.createdAt) < new Date(folder.aiEnabledAt)) {
        console.info(`[triggerAIFirstCall] Lead ${leadId} predates aiEnabledAt — skipping`);
        return;
      }
    }

    // Guard 12 — business hours check (FAIL-SAFE: blocks on any parse error)
    if (aiSettings?.businessHoursOnly) {
      const start = aiSettings.businessHoursStart || "09:00";
      const end = aiSettings.businessHoursEnd || "18:00";
      const tz = aiSettings.businessHoursTimezone || "America/Phoenix";
      if (!isWithinBusinessHours(start, end, tz)) {
        console.info(`[triggerAIFirstCall] Outside business hours for ${userEmail} — skipping`);
        return;
      }
    }

    // Guard 13 — atomic lock: only ONE process may claim this lead for first call.
    // Uses a conditional update so concurrent calls race safely — only the first wins.
    // FIX: schema has `default: null` on aiFirstCallAttemptedAt, so we must match BOTH
    // field-missing ($exists: false) and field-null to handle new leads correctly.
    const lockResult = await Lead.updateOne(
      {
        _id: lead._id,
        $or: [{ aiFirstCallAttemptedAt: { $exists: false } }, { aiFirstCallAttemptedAt: null }],
      },
      { $set: { aiFirstCallAttemptedAt: new Date(), aiFirstCallStatus: "pending" } }
    );
    if (lockResult.modifiedCount === 0) {
      console.info(`[triggerAIFirstCall] Lead ${leadId} claimed by another process — skipping`);
      return;
    }

    // Delay resolution: folder first, then aiSettings, then default 1
    let delayMinutes: number;
    if (typeof folder.aiFirstCallDelayMinutes === "number" && folder.aiFirstCallDelayMinutes >= 0) {
      delayMinutes = folder.aiFirstCallDelayMinutes;
    } else if (typeof aiSettings?.newLeadCallDelayMinutes === "number" && aiSettings.newLeadCallDelayMinutes >= 0) {
      delayMinutes = aiSettings.newLeadCallDelayMinutes;
    } else {
      delayMinutes = 1;
    }

    // FIX 3 — durable scheduling: instead of sleeping in-process (not durable across
    // serverless cold starts / deploys), write the due time to Mongo and return.
    // The cron job /api/cron/fire-due-ai-calls picks up due leads and fires them.
    if (delayMinutes > 0) {
      const dueAt = new Date(Date.now() + delayMinutes * 60_000);
      await Lead.updateOne(
        { _id: lead._id },
        { $set: { aiFirstCallDueAt: dueAt, aiFirstCallStatus: "scheduled" } }
      );
      console.info(`[triggerAIFirstCall] Lead ${leadId} scheduled for ${dueAt.toISOString()} (+${delayMinutes}m)`);
      return;
    }

    // delayMinutes === 0 — fire immediately without sleeping
    const resp = await fetch(`${AI_VOICE_SERVER_URL}/trigger-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": COVECRM_API_SECRET,
      },
      body: JSON.stringify({
        userEmail,
        leadId,
        leadPhone: lead.Phone,
        scriptKey: (folder.aiScriptKey as string) || "default",
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      console.error(`[triggerAIFirstCall] Voice server returned ${resp.status} for lead ${leadId} — body: ${errBody.slice(0, 200)}`);
      // Mark as "failed" — not "triggered". The lead won't be retried automatically
      // (aiFirstCallAttemptedAt is set) but status correctly reflects the failure.
      await Lead.updateOne({ _id: lead._id }, { $set: { aiFirstCallStatus: "failed" } });
      return;
    }

    // Mark as triggered only after voice server confirmed the call
    await Lead.updateOne({ _id: lead._id }, { $set: { aiFirstCallStatus: "triggered", aiFirstCallTriggeredAt: new Date() } });
    console.info(`[triggerAIFirstCall] Triggered call for lead ${leadId} (${userEmail})`);
  } catch (err: any) {
    console.error("[triggerAIFirstCall] Unexpected error:", err?.message);
  }
}
