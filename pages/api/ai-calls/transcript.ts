import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { Types } from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import AICallTranscript from "@/models/AICallTranscript";
import AICallSession from "@/models/AICallSession";
import AISettings from "@/models/AISettings";
import Lead from "@/models/Lead";
import { authOptions } from "../auth/[...nextauth]";
import { trackAiDialerCentsUsage } from "@/lib/billing/trackAiDialerSessionUsage";

const AI_DIALER_AGENT_KEY = (process.env.AI_DIALER_AGENT_KEY || "").trim();
const MIN_TRANSCRIPT_SECONDS = 90;
const OPENAI_TRANSCRIBE_COST_CENTS_PER_MINUTE = 0.3;
const TRANSCRIPT_CHARGE_CENTS_PER_MINUTE = 1;

type TranscriptTurnBody = {
  role?: string;
  text?: string;
  timestamp?: string | Date;
};

function getAgentKey(req: NextApiRequest) {
  return String(req.headers["x-agent-key"] || req.headers["x-ai-dialer-key"] || "").trim();
}

function cleanString(v: any) {
  return String(v || "").trim();
}

function parseDate(v: any) {
  const date = new Date(v);
  return !isNaN(date.getTime()) ? date : null;
}

function normalizeTurns(rawTurns: any): { role: "ai" | "lead"; text: string; timestamp: Date }[] {
  if (!Array.isArray(rawTurns)) return [];
  return rawTurns
    .map((turn: TranscriptTurnBody) => {
      const role = String(turn?.role || "").trim().toLowerCase();
      const text = cleanString(turn?.text);
      const timestamp = parseDate(turn?.timestamp) || new Date();
      if ((role !== "ai" && role !== "lead") || !text) return null;
      return { role, text, timestamp };
    })
    .filter(Boolean) as { role: "ai" | "lead"; text: string; timestamp: Date }[];
}

function buildFullText(turns: { role: "ai" | "lead"; text: string }[], fallback?: any) {
  const fromTurns = turns
    .map((turn) => `${turn.role === "ai" ? "Kayla" : "Lead"}: ${turn.text}`)
    .join("\n");
  return fromTurns || cleanString(fallback);
}

function computeTranscriptBilling(source: string, durationSeconds: number) {
  const billableMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
  const transcriptCostCents =
    source === "openai_transcribe"
      ? billableMinutes * OPENAI_TRANSCRIBE_COST_CENTS_PER_MINUTE
      : 0;

  return {
    transcriptBillable: true,
    transcriptCostCents,
    transcriptChargeCents: billableMinutes * TRANSCRIPT_CHARGE_CENTS_PER_MINUTE,
  };
}

function getLeadDisplayName(lead: any) {
  const first = cleanString(lead?.firstName || lead?.["First Name"]);
  const last = cleanString(lead?.lastName || lead?.["Last Name"]);
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full || cleanString(lead?.name || lead?.Name) || "Lead";
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions as any);
  const userEmail = String((session as any)?.user?.email || "").toLowerCase();
  if (!userEmail) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  const leadId = cleanString(req.query.leadId);
  const sessionId = cleanString(req.query.sessionId);
  const callSid = cleanString(req.query.callSid);

  const providedFilters = [leadId, sessionId, callSid].filter(Boolean);
  if (providedFilters.length !== 1) {
    return res.status(400).json({
      ok: false,
      message: "Provide exactly one of leadId, sessionId, or callSid",
    });
  }

  const filter: Record<string, any> = { userEmail };

  if (leadId) {
    if (!Types.ObjectId.isValid(leadId)) {
      return res.status(400).json({ ok: false, message: "Invalid leadId" });
    }
    filter.leadId = new Types.ObjectId(leadId);
  }

  if (sessionId) {
    if (!Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ ok: false, message: "Invalid sessionId" });
    }
    filter.sessionId = new Types.ObjectId(sessionId);
  }

  if (callSid) {
    filter.callSid = callSid;
  }

  await mongooseConnect();

  const query = AICallTranscript.find(filter).sort({ startedAt: -1, createdAt: -1 }).lean();
  if (callSid) {
    const transcript = await query.limit(1).then((rows) => rows[0] || null);
    return res.status(200).json({ ok: true, transcript });
  }

  const transcripts = await query.exec();

  if (!sessionId) {
    return res.status(200).json({ ok: true, transcripts });
  }

  const recordings: any[] = await AICallRecording.find({
    userEmail,
    aiCallSessionId: new Types.ObjectId(sessionId),
  })
    .select("callSid leadId outcome durationSec createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();

  const leadIds = Array.from(
    new Set(recordings.map((recording) => String(recording.leadId || "")).filter(Boolean))
  ).filter((id) => Types.ObjectId.isValid(id));

  const leads = leadIds.length
    ? await Lead.find({
        _id: { $in: leadIds.map((id) => new Types.ObjectId(id)) },
        $or: [{ userEmail }, { ownerEmail: userEmail }, { user: userEmail }],
      })
        .select({
          firstName: 1,
          lastName: 1,
          "First Name": 1,
          "Last Name": 1,
          name: 1,
          Name: 1,
        })
        .lean()
    : [];

  const leadNameById = new Map<string, string>();
  for (const lead of leads as any[]) {
    leadNameById.set(String(lead._id), getLeadDisplayName(lead));
  }

  const transcriptByCallSid = new Map<string, any>();
  for (const transcript of transcripts as any[]) {
    transcriptByCallSid.set(String(transcript.callSid), transcript);
  }

  const callRows = recordings.map((recording) => {
    const transcript = transcriptByCallSid.get(String(recording.callSid));
    const durationSeconds = Number(recording.durationSec || transcript?.durationSeconds || 0);
    return {
      callSid: recording.callSid,
      leadId: recording.leadId,
      leadName:
        transcript?.leadName ||
        leadNameById.get(String(recording.leadId || "")) ||
        "Lead",
      outcome: transcript?.outcome || recording.outcome || "unknown",
      durationSeconds,
      transcript,
      transcriptAvailable: !!transcript,
      transcriptEligible: durationSeconds >= MIN_TRANSCRIPT_SECONDS,
    };
  });

  return res.status(200).json({ ok: true, transcripts, callRows });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  if (!AI_DIALER_AGENT_KEY) {
    return res.status(500).json({ ok: false, message: "AI_DIALER_AGENT_KEY not configured" });
  }

  if (getAgentKey(req) !== AI_DIALER_AGENT_KEY) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  const body = req.body || {};
  const callSid = cleanString(body.callSid);
  const leadId = cleanString(body.leadId);
  const sessionId = cleanString(body.sessionId);
  const userEmail = cleanString(body.userEmail).toLowerCase();
  const durationSeconds = Number(body.durationSeconds);
  const turns = normalizeTurns(body.turns);

  if (!callSid) return res.status(400).json({ ok: false, message: "callSid is required" });
  if (!Types.ObjectId.isValid(leadId)) {
    return res.status(400).json({ ok: false, message: "valid leadId is required" });
  }
  if (!Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ ok: false, message: "valid sessionId is required" });
  }
  if (!userEmail) return res.status(400).json({ ok: false, message: "userEmail is required" });
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return res.status(400).json({ ok: false, message: "durationSeconds must be a positive number" });
  }

  if (durationSeconds < MIN_TRANSCRIPT_SECONDS) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: "duration_under_90_seconds",
      message: "Transcript skipped for calls under 1:30",
    });
  }

  if (!turns.length) {
    return res.status(400).json({
      ok: false,
      message: "turns must include at least one ai or lead message",
    });
  }

  const startedAt = parseDate(body.startedAt);
  const endedAt = parseDate(body.endedAt);
  if (!startedAt) return res.status(400).json({ ok: false, message: "valid startedAt is required" });
  if (!endedAt) return res.status(400).json({ ok: false, message: "valid endedAt is required" });

  await mongooseConnect();

  const session = await AICallSession.findOne({
    _id: new Types.ObjectId(sessionId),
    userEmail,
  })
    .select("_id userEmail")
    .lean();

  if (!session) {
    return res.status(404).json({ ok: false, message: "AI call session not found for userEmail" });
  }

  const aiSettings = await AISettings.findOne({ userEmail }).select("aiDialerTranscriptsEnabled").lean();
  if ((aiSettings as any)?.aiDialerTranscriptsEnabled !== true) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: "ai_dialer_transcripts_disabled",
      message: "AI Dialer transcripts are disabled in AI Settings",
    });
  }

  const lead = await Lead.findOne({
    _id: new Types.ObjectId(leadId),
    $or: [{ userEmail }, { ownerEmail: userEmail }, { user: userEmail }],
  })
    .select("_id")
    .lean();

  if (!lead) {
    return res.status(404).json({ ok: false, message: "Lead not found for userEmail" });
  }

  const transcriptSource =
    body.transcriptSource === "openai_transcribe" ? "openai_transcribe" : "voice_turns";
  const billing = computeTranscriptBilling(transcriptSource, durationSeconds);
  const fullText = buildFullText(turns, body.fullText);

  const transcript = await AICallTranscript.findOneAndUpdate(
    { callSid, userEmail },
    {
      $set: {
        leadId: new Types.ObjectId(leadId),
        sessionId: new Types.ObjectId(sessionId),
        userEmail,
        agentName: cleanString(body.agentName),
        leadName: cleanString(body.leadName),
        scriptKey: cleanString(body.scriptKey),
        outcome: cleanString(body.outcome) || "unknown",
        startedAt,
        endedAt,
        durationSeconds,
        turns,
        fullText,
        transcriptSource,
        ...billing,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        callSid,
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).lean();

  const chargeClaim: any = await AICallTranscript.findOneAndUpdate(
    {
      callSid,
      userEmail,
      $or: [
        { transcriptChargeAccruedCents: { $exists: false } },
        { transcriptChargeAccruedCents: { $lt: billing.transcriptChargeCents } },
      ],
    },
    {
      $set: {
        transcriptChargeAccruedCents: billing.transcriptChargeCents,
        transcriptChargedAt: new Date(),
      },
    },
    { new: false }
  ).lean();

  if (chargeClaim) {
    const alreadyAccrued = Number(chargeClaim.transcriptChargeAccruedCents || 0);
    const deltaCents = Math.max(0, billing.transcriptChargeCents - alreadyAccrued);
    if (deltaCents > 0) {
      await trackAiDialerCentsUsage({
        userEmail,
        addCents: deltaCents,
        description: `Cove CRM AI Dialer transcript usage ($${(deltaCents / 100).toFixed(2)})`,
        source: "ai_transcript",
      });
    }
  }

  return res.status(200).json({ ok: true, transcript });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "GET") return handleGet(req, res);
    if (req.method === "POST") return handlePost(req, res);

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  } catch (err: any) {
    console.error("[ai-calls/transcript] error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      message: "Failed to process AI call transcript",
      error: err?.message || String(err),
    });
  }
}
