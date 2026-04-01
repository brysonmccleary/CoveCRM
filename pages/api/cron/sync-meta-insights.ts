// pages/api/cron/sync-meta-insights.ts
// Daily cron — sync Meta Ad Insights for all connected users

import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import { syncAdInsights } from "@/lib/meta/syncAdInsights";

const CRON_SECRET = (process.env.CRON_SECRET || "").trim();
const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();

function isAuthorized(req: NextApiRequest): boolean {
  const keys = [CRON_SECRET, AI_DIALER_CRON_KEY].filter(Boolean);
  if (!keys.length) return false;
  const header = String(req.headers["x-cron-key"] || req.headers["authorization"] || "");
  const query = String(req.query.key || "");
  const token = header.replace(/^Bearer\s+/i, "");
  return keys.includes(token) || keys.includes(query);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  // Find all users with Meta ad account connected and active FB subscription
  const activeSubs = await FBLeadSubscription.find({ status: "active" }).lean() as any[];
  const activeEmails = new Set(activeSubs.map((s: any) => (s.userEmail || "").toLowerCase()));

  const users = await User.find({
    metaAdAccountId: { $exists: true, $ne: "" },
    $or: [
      { metaSystemUserToken: { $exists: true, $ne: "" } },
      { metaAccessToken: { $exists: true, $ne: "" } },
    ],
  })
    .select("_id email metaAdAccountId metaSystemUserToken metaAccessToken")
    .lean() as any[];

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const user of users) {
    const userEmail = (user.email || "").toLowerCase();
    if (!activeEmails.has(userEmail)) continue;

    const token = user.metaSystemUserToken || user.metaAccessToken;
    try {
      await syncAdInsights(String(user._id), userEmail, user.metaAdAccountId, token, 7);
      synced++;
    } catch (err: any) {
      failed++;
      errors.push(`${userEmail}: ${err?.message}`);
      console.error(`[cron/sync-meta-insights] Failed for ${userEmail}:`, err?.message);
    }
  }

  return res.status(200).json({ ok: true, synced, failed, errors });
}
