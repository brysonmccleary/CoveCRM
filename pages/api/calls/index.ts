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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Cast to any so TS stops complaining about session.user
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const requesterEmail: string | undefined = session?.user?.email
    ? String(session.user.email).toLowerCase()
    : undefined;

  if (!requesterEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const {
    leadId,
    page = "1",
    pageSize = "25",
  } = req.query as {
    leadId?: string;
    page?: string;
    pageSize?: string;
  };

  // This endpoint is primarily for lead profiles, so require leadId for now.
  // (If you later want it to behave like /api/calls/list when leadId is absent,
  // we can extend it safely.)
  if (!leadId) {
    return res.status(400).json({ message: "Missing leadId" });
  }

  try {
    await dbConnect();

    const requester = await getUserByEmail(requesterEmail);
    const isAdmin = !!requester && (requester as any).role === "admin";

    // Ensure lead belongs to requester (unless admin)
    const lead: any = await (Lead as any).findById(leadId).lean();
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    if (!isAdmin && String(lead.userEmail || "").toLowerCase() !== requesterEmail) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const p = Math.max(1, toInt(page, 1));
    const s = Math.min(100, Math.max(1, toInt(pageSize, 25)));
    const skip = (p - 1) * s;

    // ✅ CRITICAL FIX:
    // Call.leadId is Schema.Types.Mixed, and in practice your AI dialer often stores it as ObjectId.
    // leadId from query is a string, so match both string and ObjectId forms.
    const leadIdStr = String(leadId);
    const leadIdObj = Types.ObjectId.isValid(leadIdStr)
      ? new Types.ObjectId(leadIdStr)
      : null;

    const q: any = {
      leadId: leadIdObj ? { $in: [leadIdStr, leadIdObj] } : leadIdStr,
    };
    if (!isAdmin) q.userEmail = requesterEmail;

    const [rows, total] = await Promise.all([
      (Call as any)
        .find(q)
        .sort({ startedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(s)
        .lean(),
      (Call as any).countDocuments(q),
    ]);

    // IMPORTANT: return shape expected by pages/lead/[id].tsx -> { calls: [] }
    const calls = (rows as any[]).map((c: any) => ({
      id: String(c._id),
      callSid: c.callSid,
      userEmail: c.userEmail,
      leadId: c.leadId ? String(c.leadId) : undefined,
      direction: c.direction,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      duration: c.duration ?? c.recordingDuration,
      talkTime: c.talkTime,
      recordingUrl: c.recordingUrl || undefined,
      hasRecording: !!c.recordingUrl,
      aiSummary: c.aiSummary || undefined,
      aiActionItems: Array.isArray(c.aiActionItems) ? c.aiActionItems : [],
      aiSentiment: c.aiSentiment || undefined,
      hasAI: !!c.aiSummary,
    }));

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
