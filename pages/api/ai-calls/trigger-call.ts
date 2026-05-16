import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import AICallSession from "@/models/AICallSession";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "https://www.covecrm.com"
).replace(/\/$/, "");

function normalizeE164(value: any) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return String(value || "").startsWith("+") ? String(value || "") : "";
}

function ownedNumbers(user: any) {
  if (Array.isArray(user?.twilio?.phoneNumbers)) return user.twilio.phoneNumbers;
  if (Array.isArray(user?.numbers)) return user.numbers;
  return [];
}

function isOwnedNumber(user: any, fromNumber: string) {
  const from = normalizeE164(fromNumber);
  return ownedNumbers(user).some((entry: any) => {
    const phone = normalizeE164(entry?.phoneNumber || entry?.number || "");
    return phone && phone === from;
  });
}

async function validateFromInActiveAccount(client: any, fromNumber: string) {
  const found = await client.incomingPhoneNumbers.list({
    phoneNumber: fromNumber,
    limit: 1,
  });
  return Array.isArray(found) && found.length > 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const token = String(req.headers["x-api-secret"] || req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!process.env.COVECRM_API_SECRET || token !== process.env.COVECRM_API_SECRET) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { userEmail, leadId, leadPhone, scriptKey, fromNumber } = req.body || {};
  const email = String(userEmail || "").trim().toLowerCase();
  const to = normalizeE164(leadPhone);
  const from = normalizeE164(fromNumber);

  if (!email || !to || !from) {
    return res.status(400).json({ ok: false, error: "userEmail, leadPhone, and fromNumber are required" });
  }

  await mongooseConnect();

  const lead = leadId
    ? await (Lead as any)
        .findOne({
          _id: leadId,
          $or: [{ userEmail: email }, { ownerEmail: email }, { user: email }],
        })
        .lean()
    : null;
  if (!lead) {
    console.warn("[AI_FIRST_CALL][TRIGGER_CALL_BLOCKED]", {
      userEmail: email,
      leadId: leadId || "",
      reason: "missing_lead_context",
    });
    return res.status(400).json({ ok: false, error: "Valid leadId is required for AI call context" });
  }

  if (!lead.folderId) {
    console.warn("[AI_FIRST_CALL][TRIGGER_CALL_BLOCKED]", {
      userEmail: email,
      leadId: String(lead._id),
      reason: "missing_folder_context",
    });
    return res.status(400).json({ ok: false, error: "Lead folder is required for AI call context" });
  }

  const aiFirstCallStatus = String(lead.aiFirstCallStatus || "").trim().toLowerCase();
  const blockedLeadStatuses = new Set(["queued", "calling", "in_progress", "completed"]);
  if (blockedLeadStatuses.has(aiFirstCallStatus)) {
    console.warn("[AI_FIRST_CALL][TRIGGER_CALL_BLOCKED]", {
      userEmail: email,
      leadId: String(lead._id),
      status: lead.aiFirstCallStatus || null,
      reason: "active_or_completed_status",
    });
    return res.status(409).json({ ok: false, error: "AI First Call already active or completed for this lead" });
  }
  if (aiFirstCallStatus === "scheduled" || lead.aiFirstCallDueAt) {
    console.log("[AI_FIRST_CALL][TRIGGER_CALL_ALLOWED]", {
      userEmail: email,
      leadId: String(lead._id),
      status: lead.aiFirstCallStatus || null,
      hasDueAt: !!lead.aiFirstCallDueAt,
      reason: "scheduled_lead_ready_to_fire",
    });
  }

  const folder = await (Folder as any)
    .findOne({ _id: lead.folderId, userEmail: email })
    .lean();
  if (!folder) {
    console.warn("[AI_FIRST_CALL][TRIGGER_CALL_BLOCKED]", {
      userEmail: email,
      leadId: String(lead._id),
      folderId: String(lead.folderId),
      reason: "folder_not_found",
    });
    return res.status(400).json({ ok: false, error: "Lead folder context not found" });
  }

  const activeSession = await (AICallSession as any)
    .findOne({
      userEmail: email,
      leadIds: lead._id,
      status: { $in: ["queued", "running"] },
    })
    .select({ _id: 1, status: 1 })
    .lean();
  if (activeSession) {
    console.warn("[AI_FIRST_CALL][TRIGGER_CALL_BLOCKED]", {
      userEmail: email,
      leadId: String(lead._id),
      sessionId: String(activeSession._id),
      status: activeSession.status,
      reason: "active_ai_session_exists",
    });
    return res.status(409).json({ ok: false, error: "Active AI call session already exists for this lead" });
  }

  const user = await User.findOne({ email }).lean<any>();
  if (!user || !isOwnedNumber(user, from)) {
    return res.status(403).json({ ok: false, error: "Cannot place call — user-owned number required" });
  }

  const { client } = await getClientForUser(email);
  const activeAccountHasNumber = await validateFromInActiveAccount(client, from);
  if (!activeAccountHasNumber) {
    return res.status(409).json({ ok: false, error: "Outbound number/account mismatch" });
  }

  const resolvedScriptKey =
    String(scriptKey || "").trim() ||
    String(folder.aiScriptKey || "").trim();
  if (!resolvedScriptKey) {
    console.warn("[AI_FIRST_CALL][TRIGGER_CALL_BLOCKED]", {
      userEmail: email,
      leadId: String(lead._id),
      folderId: String(folder._id),
      reason: "missing_script_key",
    });
    return res.status(400).json({ ok: false, error: "AI script context is required" });
  }

  const aiSession = await AICallSession.create({
    userEmail: email,
    folderId: folder._id,
    leadIds: [lead._id],
    fromNumber: from,
    scriptKey: resolvedScriptKey,
    voiceKey: "jacob",
    total: 1,
    lastIndex: 0,
    status: "paused",
    startedAt: new Date(),
    completedAt: null,
    errorMessage: null,
  });

  const twimlUrl = new URL("/api/ai-calls/voice-twiml", BASE_URL);
  twimlUrl.searchParams.set("sessionId", String(aiSession._id));
  twimlUrl.searchParams.set("leadId", String(lead._id));
  twimlUrl.searchParams.set("userEmail", email);
  twimlUrl.searchParams.set("scriptKey", resolvedScriptKey);

  const statusUrl = new URL("/api/ai-calls/status", BASE_URL);
  statusUrl.searchParams.set("userEmail", email);

  const call = await client.calls.create({
    to,
    from,
    url: twimlUrl.toString(),
    statusCallback: statusUrl.toString(),
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    record: true,
  });

  return res.status(200).json({ ok: true, callSid: call.sid, to, sessionId: String(aiSession._id) });
}
