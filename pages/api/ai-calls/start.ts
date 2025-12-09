// pages/api/ai-calls/start.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Call from "@/models/Call";
import AICallSession from "@/models/AICallSession";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";
import { isCallAllowedForLead } from "@/utils/checkCallTime";

type StartAiSessionBody = {
  // New AI dial session fields
  folderId?: string;
  leadIds?: string[];
  scriptKey?: string;
  voiceKey?: string;
  fromNumber?: string;

  // Legacy single-call fields (kept for backward compatibility)
  leadId?: string;
  to?: string;
};

function runtimeBase(req: NextApiRequest) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host =
    (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function aiVoiceTwimlUrl(req: NextApiRequest) {
  return `${runtimeBase(req)}/api/ai-calls/voice-twiml`;
}

function aiVoiceStatusUrl(req: NextApiRequest, email: string) {
  const encoded = encodeURIComponent(email.toLowerCase());
  return `${runtimeBase(req)}/api/ai-calls/status?userEmail=${encoded}`;
}

function normalizeE164(p?: string) {
  const raw = String(p || "");
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.startsWith("+") ? raw : `+${d}`;
}

/**
 * New: Start an AI dial SESSION (multi-lead, background runner)
 */
async function startAiDialSession(
  req: NextApiRequest,
  res: NextApiResponse,
  userEmail: string,
  body: StartAiSessionBody
) {
  const AI_VOICE_STREAM_URL = (process.env.AI_VOICE_STREAM_URL || "").replace(
    /\/$/,
    ""
  );

  const { folderId, leadIds: providedLeadIds, scriptKey, voiceKey } = body;

  if (!folderId) {
    return res
      .status(400)
      .json({ ok: false, error: "folderId is required for AI dial session." });
  }

  try {
    await dbConnect();
  } catch {}

  // Resolve leadIds: either from body or by folder for this user
  let leadIds: string[] = [];

  if (Array.isArray(providedLeadIds) && providedLeadIds.length > 0) {
    const leads = await Lead.find({
      _id: { $in: providedLeadIds },
      $or: [{ userEmail }, { ownerEmail: userEmail }, { user: userEmail }],
    })
      .select("_id")
      .lean();

    leadIds = leads.map((l: any) => String(l._id));
  } else {
    const leads = await Lead.find({
      folderId,
      $or: [{ userEmail }, { ownerEmail: userEmail }, { user: userEmail }],
    })
      .select("_id")
      .lean();

    leadIds = leads.map((l: any) => String(l._id));
  }

  if (!leadIds.length) {
    return res.status(400).json({
      ok: false,
      error: "No leads found for this folder/user to start an AI dial session.",
    });
  }

  // Resolve fromNumber: either provided or picked from user's Twilio numbers
  let fromNumber = body.fromNumber ? normalizeE164(body.fromNumber) : "";

  if (!fromNumber) {
    const picked = await pickFromNumberForUser(userEmail);
    if (!picked) {
      return res.status(400).json({
        ok: false,
        error: "No outbound caller ID configured. Buy a number first.",
      });
    }
    fromNumber = normalizeE164(picked);
  }

  if (!fromNumber) {
    return res.status(400).json({
      ok: false,
      error: "Unable to resolve a valid fromNumber for AI dial session.",
    });
  }

  // Create AICallSession document
  const total = leadIds.length;
  const now = new Date();

  const session = await AICallSession.create({
    userEmail,
    folderId,
    leadIds,
    fromNumber,
    scriptKey: scriptKey || "default",
    voiceKey: voiceKey || "female_confident_us",
    total,
    lastIndex: -1,
    status: "queued",
    startedAt: null,
    completedAt: null,
    errorMessage: null,
  });

  const sessionId = String(session._id);

  // Best-effort: notify AI voice server that a new session has started.
  if (AI_VOICE_STREAM_URL) {
    try {
      await fetch(`${AI_VOICE_STREAM_URL}/start-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userEmail,
          sessionId,
          folderId,
          total,
        }),
      });
    } catch (err: any) {
      console.error(
        "[ai-calls/start] Failed to notify AI voice server start-session:",
        err?.message || err
      );
      // We do NOT fail the request if the AI voice server ping fails.
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    sessionId,
    status: session.status,
    total: session.total,
    createdAt: now,
  });
}

/**
 * Legacy behavior: start a single AI call immediately via Twilio.
 * Kept so we don't unexpectedly break any existing one-off AI call flows.
 */
async function startSingleAiCall(
  req: NextApiRequest,
  res: NextApiResponse,
  userEmail: string,
  body: StartAiSessionBody
) {
  const { leadId, to } = body;

  try {
    await dbConnect();
  } catch {}

  let toNumber = "";
  let leadIdForCall: string | undefined = leadId;

  if (leadId) {
    const leadDoc: any = await Lead.findOne({ _id: leadId, userEmail }).lean();
    if (!leadDoc)
      return res.status(404).json({ error: "Lead not found", ok: false });

    const { allowed, zone } = isCallAllowedForLead(leadDoc);
    if (!allowed) {
      return res.status(409).json({
        ok: false,
        error: "Quiet hours — local time for this lead is outside 8am–9pm",
        zone: zone || null,
      });
    }

    const candidates = [
      leadDoc.phone,
      leadDoc.Phone,
      leadDoc.mobile,
      leadDoc.Mobile,
      leadDoc.primaryPhone,
      leadDoc["Primary Phone"],
    ].filter(Boolean);

    toNumber = normalizeE164(candidates[0]);
  } else {
    toNumber = normalizeE164(to);
  }

  if (!toNumber) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing or invalid destination number" });
  }

  try {
    const { client } = await getClientForUser(userEmail);
    const from = await pickFromNumberForUser(userEmail);
    if (!from) {
      return res.status(400).json({
        ok: false,
        error: "No outbound caller ID configured. Buy a number first.",
      });
    }

    const call = await client.calls.create({
      to: toNumber,
      from,
      url: aiVoiceTwimlUrl(req), // TwiML route that attaches Twilio <Stream> to AI voice server
      statusCallback: aiVoiceStatusUrl(req, userEmail),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      record: true,
    });

    const now = new Date();
    await (Call as any).updateOne(
      { callSid: call.sid },
      {
        $setOnInsert: {
          callSid: call.sid,
          userEmail,
          direction: "outbound",
          createdAt: now,
          kind: "ai_call",
          leadId: leadIdForCall,
        },
        $set: {
          ownerNumber: from,
          otherNumber: toNumber,
          from,
          to: toNumber,
          startedAt: now,
          updatedAt: now,
          leadId: leadIdForCall,
          lastStatus: "initiated",
        },
      },
      { upsert: true }
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      success: true,
      sid: call.sid,
      callSid: call.sid,
      from,
      to: toNumber,
    });
  } catch (e: any) {
    console.error("AI call start error:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "AI call failed" });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed", ok: false });

  const session = (await getServerSession(
    req,
    res,
    authOptions as any
  )) as Session | null;
  const userEmail = String(session?.user?.email ?? "").toLowerCase();
  if (!userEmail)
    return res.status(401).json({ error: "Unauthorized", ok: false });

  const body = (req.body || {}) as StartAiSessionBody;

  // If folderId is provided, we treat this as a full AI dial SESSION start.
  if (body.folderId) {
    return startAiDialSession(req, res, userEmail, body);
  }

  // Otherwise, fall back to legacy single-call AI behavior.
  return startSingleAiCall(req, res, userEmail, body);
}
