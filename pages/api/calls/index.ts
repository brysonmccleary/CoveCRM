// pages/api/calls/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";
import { Types } from "mongoose";

function toInt(v: string | string[] | undefined, d = 25) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}

function parseBool(v: any): boolean {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes";
}

function isTwilioApiUrl(url?: any): boolean {
  if (!url) return false;
  const s = String(url).toLowerCase();
  return s.includes("api.twilio.com");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const requesterEmail: string | undefined = session?.user?.email
    ? String(session.user.email).toLowerCase()
    : undefined;

  if (!requesterEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { leadId, page = "1", pageSize = "25" } = req.query as {
    leadId?: string;
    page?: string;
    pageSize?: string;
  };

  if (!leadId) {
    return res.status(400).json({ message: "Missing leadId" });
  }

  try {
    await dbConnect();

    const requester = await getUserByEmail(requesterEmail);
    const isAdmin = !!requester && (requester as any).role === "admin";

    const lead: any = await (Lead as any).findById(leadId).lean();
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    if (!isAdmin && String(lead.userEmail || "").toLowerCase() !== requesterEmail) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const p = Math.max(1, toInt(page, 1));
    const s = Math.min(100, Math.max(1, toInt(pageSize, 25)));
    const skip = (p - 1) * s;

    const leadIdStr = String(leadId);
    const leadIdObj = Types.ObjectId.isValid(leadIdStr)
      ? new Types.ObjectId(leadIdStr)
      : null;

    // ✅ Default behavior for lead-scoped calls: only return calls with a recording
    // Escape hatch: ?includeNoRecording=1
    const includeNoRecording = parseBool((req.query as any).includeNoRecording);
    const recordingsOnly = !includeNoRecording;

    const q: any = {
      leadId: leadIdObj ? { $in: [leadIdStr, leadIdObj] } : leadIdStr,
    };
    if (!isAdmin) q.userEmail = requesterEmail;

    if (recordingsOnly) {
      // ✅ Only calls with either recordingSid or recordingUrl
      q.$and = [
        ...(Array.isArray(q.$and) ? q.$and : []),
        {
          $or: [
            { recordingSid: { $exists: true, $ne: "" } },
            { recordingUrl: { $exists: true, $ne: "" } },
          ],
        },
      ];
    }

    const [rows, total] = await Promise.all([
      (Call as any)
        .find(q)
        .sort({ startedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(s)
        .lean(),
      (Call as any).countDocuments(q),
    ]);

    const calls = (rows as any[]).map((c: any) => {
      const id = String(c._id);

      const hasRecordingSid = !!c.recordingSid;
      const hasRecordingUrl = !!c.recordingUrl;

      const aiActionItems = Array.isArray(c.aiActionItems) ? c.aiActionItems : [];
      const aiBullets = Array.isArray(c.aiBullets) ? c.aiBullets : [];
      const hasOverview = !!c.aiOverviewReady && !!c.aiOverview;

      const hasAI =
        hasOverview ||
        !!c.aiSummary ||
        aiActionItems.length > 0 ||
        aiBullets.length > 0;

      // ✅ If recording is Twilio-protected (api.twilio.com) OR we have recordingSid,
      // always use proxy playback so the UI can actually play it.
      const shouldProxyRecording = hasRecordingSid || isTwilioApiUrl(c.recordingUrl);

      return {
        id,
        callSid: c.callSid,
        userEmail: c.userEmail,
        leadId: c.leadId ? String(c.leadId) : undefined,
        direction: c.direction,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        duration: c.duration ?? c.recordingDuration,
        talkTime: c.talkTime,

        recordingUrl: (hasRecordingSid || hasRecordingUrl)
          ? (shouldProxyRecording
              ? `/api/recordings/proxy?callId=${encodeURIComponent(id)}`
              : (c.recordingUrl || undefined))
          : undefined,

        hasRecording: hasRecordingSid || hasRecordingUrl,

        // legacy fields (kept)
        aiSummary: c.aiSummary || undefined,
        aiActionItems,
        aiBullets,
        aiSentiment: c.aiSentiment || undefined,

        // structured overview (kept)
        aiOverviewReady: !!c.aiOverviewReady,
        aiOverview: c.aiOverview || undefined,

        hasAI,
      };
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      calls,
      page: p,
      pageSize: s,
      total,
    });
  } catch (err: any) {
    console.error("GET /api/calls (index) error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
