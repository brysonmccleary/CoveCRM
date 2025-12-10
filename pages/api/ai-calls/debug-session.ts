// pages/api/ai-calls/debug-session.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions as any);
  const userEmail = String(session?.user?.email || "").toLowerCase();

  if (!userEmail) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  await mongooseConnect();

  const sessions = await AICallSession.find({ userEmail })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  // Only return safe debug info
  const cleaned = sessions.map((s: any) => ({
    _id: String(s._id),
    status: s.status,
    total: s.total,
    leadCount: Array.isArray(s.leadIds) ? s.leadIds.length : 0,
    lastIndex: s.lastIndex,
    folderId: String(s.folderId || ""),
    fromNumber: s.fromNumber,
    scriptKey: s.scriptKey,
    voiceKey: s.voiceKey,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    errorMessage: s.errorMessage || null,
  }));

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, sessions: cleaned });
}
