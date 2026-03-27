// pages/api/calls/coach-report.ts
// GET  ?callId=  — returns existing report (or null)
// POST { callId, leadName? } — generates + returns report
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import CallCoachReport from "@/models/CallCoachReport";
import { generateCallCoachReport } from "@/lib/ai/generateCallCoachReport";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const userEmail = session?.user?.email ? String(session.user.email).toLowerCase() : null;
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  if (req.method === "GET") {
    const callId = String(req.query.callId || "").trim();
    if (!callId) return res.status(400).json({ error: "callId required" });

    const report = await CallCoachReport.findOne({ callId, userEmail }).lean();
    return res.status(200).json({ ok: true, report: report || null });
  }

  if (req.method === "POST") {
    const { callId, leadName } = req.body || {};
    if (!callId) return res.status(400).json({ error: "callId required" });

    const result = await generateCallCoachReport(
      String(callId),
      userEmail,
      leadName ? String(leadName) : undefined
    );

    if (!result.ok) {
      return res.status(500).json({ error: result.error || "Generation failed" });
    }

    return res.status(200).json({ ok: true, report: result.report });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
