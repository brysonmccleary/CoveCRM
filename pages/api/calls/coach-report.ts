// pages/api/calls/coach-report.ts
// GET  ?callId=  — returns existing report (or null)
// POST { callId, leadName? } — generates + returns report
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const userEmail = session?.user?.email ? String(session.user.email).toLowerCase() : null;
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET" || req.method === "POST") {
    return res.status(200).json({ ok: true, skipped: true, reason: "sales_coaching_disabled", report: null });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
