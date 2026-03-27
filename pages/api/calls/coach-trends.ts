// pages/api/calls/coach-trends.ts
// GET — last 10 coaching reports, aggregated stats for the trends widget
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import CallCoachReport from "@/models/CallCoachReport";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const userEmail = session?.user?.email ? String(session.user.email).toLowerCase() : null;
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const reports = await CallCoachReport.find({ userEmail })
    .sort({ generatedAt: -1 })
    .limit(10)
    .lean();

  if (reports.length === 0) {
    return res.status(200).json({ ok: true, totalCoached: 0, reports: [], averages: null, topObjection: null, scoreTrend: [] });
  }

  // Average scores across all 10
  const cats = ["opening", "rapport", "discovery", "presentation", "objectionHandling", "closing"] as const;
  const averages: Record<string, number> = {};
  for (const cat of cats) {
    const vals = reports.map((r: any) => r.scoreBreakdown?.[cat] || 5);
    averages[cat] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
  const overallAvg = Math.round((reports.reduce((acc: number, r: any) => acc + (r.callScore || 5), 0) / reports.length) * 10) / 10;

  // Most common objection
  const objectionCounts: Record<string, number> = {};
  for (const r of reports) {
    for (const o of (r as any).objectionsEncountered || []) {
      const key = String(o.objection || "").toLowerCase().trim();
      if (key) objectionCounts[key] = (objectionCounts[key] || 0) + 1;
    }
  }
  const topObjection = Object.entries(objectionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Score trend (oldest → newest, for a sparkline)
  const scoreTrend = [...reports]
    .reverse()
    .map((r: any) => ({ score: r.callScore, date: r.generatedAt }));

  // Total ever coached
  const totalCoached = await CallCoachReport.countDocuments({ userEmail });

  return res.status(200).json({
    ok: true,
    totalCoached,
    reports: reports.slice(0, 10),
    averages: { ...averages, overall: overallAvg },
    topObjection,
    scoreTrend,
  });
}
