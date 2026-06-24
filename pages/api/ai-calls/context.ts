// pages/api/ai-calls/context.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { Types } from "mongoose";
import AICallSession from "@/models/AICallSession";
import AICallRecording from "@/models/AICallRecording";
import Lead from "@/models/Lead";
import User from "@/models/User";
import AISettings from "@/models/AISettings";
import { buildLeadContext } from "@/lib/ai/memory/buildLeadContext";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";

type OkResponse = {
  ok: true;
  context: any;
};

type ErrorResponse = {
  ok: false;
  error: string;
};

function looksLikeIanaTz(tz?: any) {
  return typeof tz === "string" && tz.includes("/") && tz.length <= 64;
}

function getTimezoneFromState(stateRaw: string | undefined): string | null {
  const s = String(stateRaw || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  if (!s) return null;
  const EST = new Set(["NY","NJ","CT","MA","RI","VT","NH","ME","PA","OH","MI","IN","FL","GA","SC","NC","VA","WV","MD","DE","DC"]);
  const CST = new Set(["TX","IL","MN","WI","IA","MO","AR","LA","MS","AL","TN","KY","OK","KS","NE","SD","ND"]);
  if (s === "AZ") return "America/Phoenix"; // no DST — must resolve before MST set
  const MST = new Set(["CO","UT","NM","WY","MT","ID"]);
  const PST = new Set(["CA","OR","WA","NV"]);
  if (EST.has(s)) return "America/New_York";
  if (CST.has(s)) return "America/Chicago";
  if (MST.has(s)) return "America/Denver";
  if (PST.has(s)) return "America/Los_Angeles";
  return null;
}

function flattenLeadFieldsForDisplay(lead: any) {
  const merged: Record<string, any> = {};
  const merge = (source: any) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return;
    for (const [key, value] of Object.entries(source)) {
      if (merged[key] === undefined) merged[key] = value;
    }
  };
  merge(lead);
  merge(lead?.customFields);
  merge(lead?.fields);
  merge(lead?.data);
  merge(lead?.sheet);
  merge(lead?.payload);
  merge(lead?.rawRow);
  return merged;
}

function cleanNamePart(value: any) {
  return typeof value === "string" ? value.trim() : value ? String(value).trim() : "";
}

function dedupeFirstLast(first: string, last: string): { first: string; last: string } {
  const f = (first || "").trim();
  const l = (last || "").trim();
  if (f && l && f.length > l.length) {
    const splitAt = f.length - l.length;
    if (f[splitAt - 1] === " " && f.slice(splitAt).toLowerCase() === l.toLowerCase()) {
      const stripped = f.slice(0, splitAt).trim();
      if (stripped) return { first: stripped, last: l };
    }
  }
  return { first: f, last: l };
}

function resolveLeadNameParts(lead: any) {
  const fields = flattenLeadFieldsForDisplay(lead);

  const camelFirst = cleanNamePart(fields.firstName);
  const camelLast = cleanNamePart(fields.lastName);
  const { first: dcCamelFirst, last: dcCamelLast } = dedupeFirstLast(camelFirst, camelLast);
  const fromCamel = [dcCamelFirst, dcCamelLast].filter(Boolean).join(" ").trim();

  const titleFirst = cleanNamePart(fields["First Name"]);
  const titleLast = cleanNamePart(fields["Last Name"]);
  const { first: dcTitleFirst, last: dcTitleLast } = dedupeFirstLast(titleFirst, titleLast);
  const fromTitle = [dcTitleFirst, dcTitleLast].filter(Boolean).join(" ").trim();

  const fullName =
    fromCamel ||
    fromTitle ||
    cleanNamePart(fields.name) ||
    cleanNamePart(fields.Name) ||
    cleanNamePart(fields.fullName) ||
    cleanNamePart(fields["Full Name"]);

  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "there",
    lastName: parts.slice(1).join(" ") || cleanNamePart(fields.surname),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OkResponse | ErrorResponse>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { sessionId, leadId, key } = req.query as {
    sessionId?: string;
    leadId?: string;
    key?: string;
  };

  try {
    if (!AI_DIALER_CRON_KEY) {
      return res
        .status(500)
        .json({ ok: false, error: "AI_DIALER_CRON_KEY not configured" });
    }

    if (!key || key !== AI_DIALER_CRON_KEY) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
      return res
        .status(400)
        .json({ ok: false, error: "Valid sessionId is required" });
    }

    if (!leadId || !Types.ObjectId.isValid(leadId)) {
      return res
        .status(400)
        .json({ ok: false, error: "Valid leadId is required" });
    }

    await mongooseConnect();

    const sessionObjectId = new Types.ObjectId(sessionId);
    const leadObjectId = new Types.ObjectId(leadId);

    const aiSession = await AICallSession.findById(sessionObjectId).lean();
    if (!aiSession) {
      return res
        .status(404)
        .json({ ok: false, error: "AI call session not found" });
    }

    const lead = await Lead.findById(leadObjectId).lean();
    if (!lead) {
      return res.status(404).json({ ok: false, error: "Lead not found" });
    }

    const userEmail = ((aiSession as any).userEmail as string) || "";
    const user = await User.findOne({ email: userEmail }).lean();

    // -------- Live transfer settings --------
    let liveTransferEnabled = false;
    let liveTransferPhone = "";
    try {
      const aiSettings = await AISettings.findOne({ userEmail }).lean() as any;
      if (aiSettings?.liveTransferEnabled) {
        liveTransferEnabled = true;
        liveTransferPhone = aiSettings.liveTransferPhone || "";
      }
    } catch {
      // non-blocking
    }

    // -------- Voice profile mapping --------
    // New default persona: Jacob (Cedar)
    const rawVoiceKey = (aiSession as any).voiceKey;
    const voiceKey =
      typeof rawVoiceKey === "string" && rawVoiceKey.trim()
        ? rawVoiceKey.trim()
        : "jacob";

    const VOICE_PROFILES: Record<
      string,
      { aiName: string; openAiVoiceId: string; style: string }
    > = {
      // Primary personas (only these should show in the UI)
      jacob: {
        aiName: "Jacob",
        openAiVoiceId: "cedar",
        style: "calm, trustworthy male voice (Cedar)",
      },
      iris: {
        aiName: "Kayla",
        openAiVoiceId: "marin",
        style: "clear, professional female voice (Marin)",
      },

      // Legacy keys (kept for back-compat only; map to Jacob/Kayla internally)
      kayla: {
        aiName: "Kayla",
        openAiVoiceId: "marin",
        style: "legacy alias for Kayla (Marin) – friendly female",
      },
      elena: {
        aiName: "Kayla",
        openAiVoiceId: "marin",
        style: "legacy alias for Kayla (Marin) – neutral female",
      },

      // Back-compat generic styles → mapped to closest primary voices
      neutral_conversational: {
        aiName: "Jacob",
        openAiVoiceId: "cedar",
        style: "neutral conversational (legacy key → Jacob/Cedar)",
      },
      upbeat_confident: {
        aiName: "Kayla",
        openAiVoiceId: "marin",
        style: "upbeat, confident (legacy key → Kayla/Marin)",
      },
      calm_reassuring: {
        aiName: "Jacob",
        openAiVoiceId: "cedar",
        style: "calm, reassuring (legacy key → Jacob/Cedar)",
      },
    };

    const voiceProfile =
      VOICE_PROFILES[voiceKey] || {
        aiName: "Jacob",
        openAiVoiceId: "cedar",
        style: "neutral conversational (fallback → Jacob/Cedar)",
      };

    // -------- Script mapping (LOCKED TO SESSION) --------
    const scriptKeyRaw = (aiSession as any).scriptKey;
    const scriptKey =
      typeof scriptKeyRaw === "string" && scriptKeyRaw.trim().length > 0
        ? scriptKeyRaw
        : "mortgage_protection";
    const callDirectionRaw = String((aiSession as any).callDirection || "outbound").trim().toLowerCase();
    const callDirection = callDirectionRaw === "inbound" ? "inbound" : "outbound";

    const leadAny = lead as any;
    const isKaylaPublicLead = scriptKey === "kayla_signup";
    const resolvedVoiceProfile = isKaylaPublicLead
      ? {
          ...voiceProfile,
          aiName: "Kayla",
          openAiVoiceId: "marin", // Kayla uses the Marin (female) voice regardless of session voiceKey
        }
      : voiceProfile;

    const resolvedLeadName = resolveLeadNameParts(leadAny);
    const clientFirstName = resolvedLeadName.firstName;
    const clientLastName = resolvedLeadName.lastName;

    const clientState =
      leadAny.state || leadAny.st || leadAny.province || undefined;

    const agentName =
      (user as any)?.fullName ||
      (user as any)?.name ||
      (user as any)?.displayName ||
      "your agent";

    /**
     * ✅ CRITICAL TIMEZONE FIX (single source of truth)
     * Always prefer bookingSettings.timezone (your schema + detect-timezone endpoint write here).
     * Keep legacy fallbacks for older users, but only if they look like IANA timezones.
     */
    const tzFromBooking =
      (user as any)?.bookingSettings?.timezone ||
      (user as any)?.bookingSettings?.timeZone;

    const tzLegacyCandidates = [
      (user as any)?.settings?.timeZone,
      (user as any)?.settings?.timezone,
      (user as any)?.timeZone,
      (user as any)?.timezone,
    ];

    const tzLegacy = tzLegacyCandidates.find(looksLikeIanaTz);

    const agentTimeZone: string =
      (looksLikeIanaTz(tzFromBooking) ? String(tzFromBooking) : undefined) ||
      (tzLegacy ? String(tzLegacy) : undefined) ||
      getTimezoneFromState(clientState) ||
      "America/New_York";

    // Optional notes from lead fields
    const notesFromLead =
      leadAny.notes || leadAny.notesInternal || leadAny.leadNotes || "";
    const leadMemory = await buildLeadContext(userEmail, String(leadObjectId)).catch(() => ({
      leadSummary: "",
      keyFacts: [],
      keyFactsText: "(none)",
      objections: [],
      objectionsText: "(none)",
      nextBestAction: "",
    }));
    const memoryPrompt = `This is what we know about the lead:
${leadMemory.leadSummary || "(none)"}

Key facts:
${leadMemory.keyFactsText || "(none)"}

Objections:
${leadMemory.objectionsText || "(none)"}

Goal:
${leadMemory.nextBestAction || "(none)"}

Conversation strategy:
- Reference previous conversation
- Handle known objections${scriptKey !== "kayla_signup" ? "\n- Try to book appointment" : ""}`;
    const combinedNotes = [String(notesFromLead || "").trim(), memoryPrompt]
      .filter(Boolean)
      .join("\n\n");

    // ✅ Optional: expose AMD AnsweredBy when known (typing-safe access)
    let answeredBy: string | undefined = callDirection === "inbound" ? "human" : undefined;
    if (callDirection !== "inbound") {
      try {
        const callSid =
          (aiSession as any).callSid ||
          (aiSession as any).currentCallSid ||
          (aiSession as any).lastCallSid ||
          "";

        if (callSid) {
          const rec = await AICallRecording.findOne({ callSid })
            .select({ answeredBy: 1 })
            .lean();

          const ab = rec ? (rec as any).answeredBy : "";
          if (ab) {
            answeredBy = String(ab);
          }
        }
      } catch {
        // swallow (context must still return)
      }
    }

    const context = {
      userEmail,
      sessionId: (aiSession as any)._id.toString(),
      leadId: (lead as any)._id.toString(),
      agentName,
      agentTimeZone,
      clientFirstName,
      clientLastName,
      clientState,
      clientPhone: leadAny.phone || leadAny.phoneNumber || leadAny.Phone,
      clientEmail: leadAny.email || leadAny.Email,
      clientNotes: combinedNotes,
      leadSummary: leadMemory.leadSummary || "",
      keyFacts: Array.isArray(leadMemory.keyFacts) ? leadMemory.keyFacts : [],
      objections: Array.isArray(leadMemory.objections) ? leadMemory.objections : [],
      nextBestAction: leadMemory.nextBestAction || "",
      memoryPrompt,
      scriptKey,
      voiceKey,
      callDirection,
      fromNumber: (aiSession as any).fromNumber,
      voiceProfile: resolvedVoiceProfile,

      // ✅ Live transfer settings from AISettings
      liveTransferEnabled,
      liveTransferPhone,

      // ✅ NEW (non-breaking): exposes AMD AnsweredBy when known
      answeredBy,

      raw: {
        session: aiSession,
        user,
        lead,
      },
    };

    return res.status(200).json({ ok: true, context });
  } catch (err: any) {
    console.error("[AI-CALLS] context error:", err?.message || err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to build AI call context" });
  }
}
