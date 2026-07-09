import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import {
  previousUtcDayWindow,
  reconcileBillingForTenant,
  utcDayWindow,
} from "@/lib/billing/reconcileNightly";

function authorized(req: NextApiRequest) {
  const secret = String(process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET || "").trim();
  if (!secret) return false;
  const bearer = String(req.headers.authorization || "");
  const headerSecret = String(req.headers["x-cron-key"] || req.headers["x-cron-secret"] || "");
  return bearer === `Bearer ${secret}` || headerSecret === secret;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const userEmail = String(req.query.userEmail || req.body?.userEmail || "").trim().toLowerCase();
  const requestedDay = String(req.query.day || req.body?.day || "").trim();
  if (!userEmail) return res.status(400).json({ ok: false, error: "userEmail is required" });
  const window = requestedDay ? utcDayWindow(requestedDay) : previousUtcDayWindow();
  if (!window) return res.status(400).json({ ok: false, error: "day must be YYYY-MM-DD" });

  try {
    await dbConnect();
    const report = await reconcileBillingForTenant({ userEmail, window });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, ...report });
  } catch (error: any) {
    console.error("[billing-reconciliation] failed", error?.message || error);
    return res.status(500).json({ ok: false, error: "Reconciliation failed" });
  }
}
