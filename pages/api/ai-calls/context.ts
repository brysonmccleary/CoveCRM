// pages/api/ai-calls/context.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { Types } from "mongoose";
import AICallSession from "@/models/AICallSession";
import Lead from "@/models/Lead";
import User from "@/models/User";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";

type OkResponse = {
  ok: true;
  context: any;
};

type ErrorResponse = {
  ok: false;
  error: string;
};

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
        aiName: "Iris",
        openAiVoiceId: "marin",
        style: "clear, professional female voice (Marin)",
      },

      // Legacy keys (kept for back-compat only; map to Jacob/Iris internally)
      kayla: {
        aiName: "Iris",
        openAiVoiceId: "marin",
        style: "legacy alias for Iris (Marin) – friendly female",
      },
      elena: {
        aiName: "Iris",
        openAiVoiceId: "marin",
        style: "legacy alias for Iris (Marin) – neutral female",
      },

      // Back-compat generic styles → mapped to closest primary voices
      neutral_conversational: {
        aiName: "Jacob",
        openAiVoiceId: "cedar",
        style: "neutral conversational (legacy key → Jacob/Cedar)",
      },
      upbeat_confident: {
        aiName: "Iris",
        openAiVoiceId: "marin",
        style: "upbeat, confident (legacy key → Iris/Marin)",
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

    const leadAny = lead as any;

    // Derive a clean first name (prefer explicit first-name fields)
    const rawFirstName: string =
      leadAny.firstName ||
      leadAny["First Name"] ||
      leadAny.name ||
      leadAny.fullName ||
      "";

    const clientFirstName =
      rawFirstName && typeof rawFirstName === "string"
        ? rawFirstName.trim().split(" ")[0] || "there"
        : "there";

    const clientLastName: string =
      leadAny.lastName ||
      leadAny["Last Name"] ||
      (typeof leadAny.name === "string"
        ? leadAny.name.trim().split(" ").slice(1).join(" ")
        : "") ||
      leadAny.surname ||
      "";

    const clientState =
      leadAny.state || leadAny.st || leadAny.province || undefined;

    const agentName =
      (user as any)?.fullName ||
      (user as any)?.name ||
      (user as any)?.displayName ||
      "your agent";

    const agentTimeZone =
      (user as any)?.settings?.timeZone ||
      (user as any)?.timeZone ||
      "America/Chicago";

    // Optional notes from lead fields
    const notesFromLead =
      leadAny.notes || leadAny.notesInternal || leadAny.leadNotes || "";

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
      clientNotes: notesFromLead,
      scriptKey,
      voiceKey,
      fromNumber: (aiSession as any).fromNumber,
      voiceProfile,
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
