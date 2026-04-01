// pages/api/calls/ai-dial-session.ts
// POST — Start an AI dial session through the voice server

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });
  // AI Dial Session is unreleased — restrict to experimental admin
  if (!isExperimentalAdminEmail(email)) return res.status(403).json({ error: "Not available" });

  await mongooseConnect();

  const { leadIds, scriptKey } = req.body as {
    leadIds?: string[];
    scriptKey?: string;
  };

  if (!leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: "leadIds array is required" });
  }

  // Check AI settings
  const aiSettings = await AISettings.findOne({ userEmail: email }).lean() as any;
  if (!aiSettings?.aiDialSessionEnabled) {
    return res.status(403).json({ error: "AI Dial Sessions are not enabled. Enable them in AI Settings." });
  }

  if (!isWithinBusinessHours(aiSettings)) {
    return res.status(409).json({ error: "Outside business hours. AI dial session blocked." });
  }

  if (!AI_VOICE_HTTP_BASE || !COVECRM_API_SECRET) {
    return res.status(503).json({ error: "AI voice server not configured." });
  }

  // Fetch leads — skip DNC leads and already-booked leads
  const validIds = leadIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
  const leads = await Lead.find({
    _id: { $in: validIds },
    $or: [{ userEmail: email }, { ownerEmail: email }],
    doNotCall: { $ne: true },        // skip DNC leads
    appointmentTime: { $exists: false }, // skip already-booked leads
  }).lean() as any[];

  if (leads.length === 0) {
    return res.status(404).json({ error: "No accessible leads found" });
  }

  // Start firing calls in background
  const sessionId = new Types.ObjectId().toString();
  let called = 0;
  let booked = 0;
  let notInterested = 0;
  let noAnswer = 0;

  res.status(200).json({
    ok: true,
    sessionId,
    totalLeads: leads.length,
    message: `AI dial session started for ${leads.length} lead(s)`,
  });

  // Fire async after response
  (async () => {
    for (const lead of leads) {
      const phone = lead.Phone || lead.phone || "";
      if (!phone) continue;

      called++;
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
  })().catch((err) =>
    console.error("[ai-dial-session] Session error:", err?.message)
  );
}
