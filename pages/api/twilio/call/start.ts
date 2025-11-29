// pages/api/twilio/call/start.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Call from "@/models/Call";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";
import { isCallAllowedForLead } from "@/utils/checkCallTime";

/** Build callback base from the actual request so Twilio always hits the right host */
function runtimeBase(req: NextApiRequest) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function voiceAnswerUrl(req: NextApiRequest, leadId?: string) {
  const base = `${runtimeBase(req)}/api/twilio/voice-answer`;
  if (!leadId) return base;
  const encoded = encodeURIComponent(leadId);
  return `${base}?leadId=${encoded}`;
}

function voiceStatusUrl(req: NextApiRequest, email: string) {
  const encoded = encodeURIComponent(email.toLowerCase());
  return `${runtimeBase(req)}/api/twilio/voice-status?userEmail=${encoded}`;
}

function normalizeE164(p?: string) {
  const raw = String(p || "");
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.startsWith("+") ? raw : `+${d}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Auth
  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const userEmail = String(session?.user?.email ?? "").toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  const body = (req.body || {}) as { leadId?: string; to?: string };

  try {
    await dbConnect();
  } catch {
    // best-effort; Twilio call will still be attempted
  }

  // --- Resolve lead + enforce quiet hours (8am–9pm local) ---
  let toNumber = "";
  let leadId: string | undefined = body.leadId;

  if (body.leadId) {
    const leadDoc: any = await Lead.findOne({ _id: body.leadId, userEmail }).lean();
    if (!leadDoc) return res.status(404).json({ error: "Lead not found" });

    const { allowed, zone } = isCallAllowedForLead(leadDoc);
    if (!allowed) {
      return res.status(409).json({
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
    toNumber = normalizeE164(body.to);
  }

  if (!toNumber) return res.status(400).json({ error: "Missing or invalid destination number" });

  try {
    const { client } = await getClientForUser(userEmail);
    const from = await pickFromNumberForUser(userEmail);
    if (!from) {
      return res.status(400).json({ error: "No outbound caller ID configured. Buy a number first." });
    }

    // Place the call with correct runtime URLs + full callback events
    const call = await client.calls.create({
      to: toNumber,
      from,
      url: voiceAnswerUrl(req, leadId),
      statusCallback: voiceStatusUrl(req, userEmail),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      record: false,
    });

    // Seed the Call row immediately so the dashboard shows a Dial right away
    const now = new Date();

    const setOnInsert: any = {
      callSid: call.sid,
      userEmail,
      direction: "outbound",
      createdAt: now,
      kind: "call",
    };
    if (leadId) setOnInsert.leadId = leadId;

    const set: any = {
      ownerNumber: from,
      otherNumber: toNumber,
      from,
      to: toNumber,
      startedAt: now, // ensures it's in today's window
      updatedAt: now,
    };
    if (leadId) set.leadId = leadId;

    await (Call as any).updateOne(
      { callSid: call.sid },
      { $setOnInsert: setOnInsert, $set: set },
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
    console.error("Error starting outbound call:", e?.message || e);
    return res.status(500).json({ error: e?.message || "Call failed" });
  }
}
