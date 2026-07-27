// pages/api/calls/coach-report.ts
// GET ?callId= — returns the automatically generated report (or null).
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import CallCoachReport from "@/models/CallCoachReport";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const userEmail = session?.user?.email ? String(session.user.email).toLowerCase() : null;
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const callId = String(req.query.callId || "").trim();
  if (!callId) return res.status(400).json({ error: "Missing callId" });

  try {
    await mongooseConnect();
    const call = await (Call as any).findOne({ _id: callId, userEmail }).select("_id").lean();
    if (!call) return res.status(404).json({ error: "Call not found" });
    const report = await CallCoachReport.findOne({ callId, userEmail }).lean();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, report: report || null });
  } catch (error: any) {
    if (error?.name === "CastError") return res.status(400).json({ error: "Invalid callId" });
    console.error("[calls/coach-report] error:", error?.message || error);
    return res.status(500).json({ error: "Failed to load coaching report" });
  }
}
