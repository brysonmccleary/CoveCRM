// pages/api/admin/meta-diagnostics.ts
// GET — Admin diagnostics for Meta integration

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import Lead from "@/lib/mongo/leads";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Admin only" });
  }

  await mongooseConnect();

  const [
    usersWithPage,
    activeSubs,
    totalMetaLeads,
    usersWithExpiredTokens,
    recentWebhookUsers,
  ] = await Promise.all([
    User.countDocuments({ metaPageId: { $exists: true, $ne: "" } }),
    FBLeadSubscription.countDocuments({ status: "active" }),
    Lead.countDocuments({ metaLeadgenId: { $exists: true, $ne: "" } }),
    User.find({
      metaTokenExpiresAt: { $lt: new Date() },
      metaAccessToken: { $exists: true, $ne: "" },
    })
      .select("email metaTokenExpiresAt")
      .lean(),
    User.find({ metaLastWebhookAt: { $exists: true } })
      .sort({ metaLastWebhookAt: -1 })
      .limit(10)
      .select("email metaLastWebhookAt metaLastInsightSyncAt")
      .lean(),
  ]);

  return res.status(200).json({
    usersWithMetaPage: usersWithPage,
    activeFBSubscriptions: activeSubs,
    totalMetaLeadsImported: totalMetaLeads,
    usersWithExpiredTokens: usersWithExpiredTokens.map((u: any) => ({
      email: u.email,
      expiredAt: u.metaTokenExpiresAt,
    })),
    recentWebhookActivity: recentWebhookUsers.map((u: any) => ({
      email: u.email,
      lastWebhook: u.metaLastWebhookAt,
      lastSync: u.metaLastInsightSyncAt,
    })),
  });
}
