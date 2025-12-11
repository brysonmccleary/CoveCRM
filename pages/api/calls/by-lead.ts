// pages/api/calls/by-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import Lead from "@/models/Lead";
import { getUserByEmail } from "@/models/User";
import AICallRecording from "@/models/AICallRecording";

function toInt(v: string | string[] | undefined, d = 25) {
  const n = parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}

type Row = {
  id: string;
  callSid: string;
  userEmail: string;
  leadId?: string;
  direction?: "inbound" | "outbound";
  startedAt?: string | Date;
  completedAt?: string | Date;
  duration?: number;
  talkTime?: number;
  recordingUrl?: string;
  hasRecording?: boolean;
  aiSummary?: string;
  aiActionItems?: string[];
  aiSentiment?: "positive" | "neutral" | "negative";
  hasAI?: boolean;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions as any);
  const requesterEmail = session?.user?.email?.toLowerCase();
  if (!requesterEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const {
    leadId,
    page = "1",
    pageSize = "25",
  } = req.query as { leadId?: string; page?: string; pageSize?: string };

  if (!leadId) {
    return res.status(400).json({ message: "Missing leadId" });
  }

  try {
    await dbConnect();

    const requester = await getUserByEmail(requesterEmail);
    const isAdmin =
      !!requester && (requester as any).role && (requester as any).role === "admin";

    // Ensure lead belongs to requester (unless admin)
    const lead: any = await (Lead as any).findById(leadId).lean();
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }
    if (
      !isAdmin &&
      String(lead.userEmail || "").toLowerCase() !== requesterEmail
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const p = Math.max(1, toInt(page, 1));
    const s = Math.min(100, Math.max(1, toInt(pageSize, 25)));
    const skip = (p - 1) * s;

    // 1) Normal calls for this lead
    const callQuery: any = { leadId };
    if (!isAdmin) callQuery.userEmail = requesterEmail;

    const calls = (await (Call as any)
      .find(callQuery)
      .sort({ startedAt: -1, createdAt: -1 })
      .lean()) as any[];

    // 2) AI Dialer recordings for this lead
    const aiQuery: any = { leadId };
    if (!isAdmin) aiQuery.userEmail = requesterEmail;

    const aiRecs = (await (AICallRecording as any)
      .find(aiQuery)
      .sort({ createdAt: -1, updatedAt: -1 })
      .lean()) as any[];

    // Map normal calls into Row shape
    const callRows: Row[] = (calls || []).map((c: any) => ({
      id: String(c._id),
      callSid: c.callSid,
      userEmail: c.userEmail,
      leadId: c.leadId ? String(c.leadId) : undefined,
      direction: c.direction,
      startedAt: c.startedAt || c.createdAt,
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

    // Map AI recordings into Row shape
    const aiRows: Row[] = (aiRecs || []).map((r: any) => {
      const started =
        r.createdAt || r.updatedAt || (r as any).timestamp || undefined;
      const durationSec =
        typeof r.durationSec === "number" ? r.durationSec : undefined;
      const completed =
        started && durationSec
          ? new Date(new Date(started).getTime() + durationSec * 1000)
          : r.updatedAt || started;

      return {
        id: `ai:${String(r._id)}`,
        callSid: r.callSid || r.recordingSid || "",
        userEmail: r.userEmail,
        leadId: r.leadId ? String(r.leadId) : undefined,
        // AI dialer calls are outbound
        direction: "outbound",
        startedAt: started,
        completedAt: completed,
        duration: durationSec,
        talkTime: durationSec,
        recordingUrl: r.recordingUrl || undefined,
        hasRecording: !!r.recordingUrl,
        aiSummary: r.summary || undefined,
        aiActionItems: [], // can be filled later if you add structured action items
        aiSentiment: undefined,
        hasAI: !!r.summary,
      };
    });

    // 3) Merge + sort
    const combined: Row[] = [...callRows, ...aiRows];

    const getTime = (row: Row): number => {
      const t =
        (row.startedAt && new Date(row.startedAt)) ||
        (row.completedAt && new Date(row.completedAt)) ||
        null;
      return t ? t.getTime() : 0;
    };

    combined.sort((a, b) => getTime(b) - getTime(a));

    const total = combined.length;
    const paged = combined.slice(skip, skip + s);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      page: p,
      pageSize: s,
      total,
      rows: paged,
    });
  } catch (err: any) {
    console.error("GET /api/calls/by-lead error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}
