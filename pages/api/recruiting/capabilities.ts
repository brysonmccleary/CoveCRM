import type { NextApiRequest, NextApiResponse } from "next";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { hostedBrowserIsConfigured } from "@/lib/recruiting/cloud/browserbase";
import { listProviderCapabilities } from "@/lib/recruiting/social/policy";
import { RECRUITING_PLANS } from "@/lib/recruiting/plans";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({
    executionModes: ["simulation", "hosted_cloud"],
    liveExecutionEnabled: true,
    liveExecutionRequiresPairedCompanion: false,
    liveExecutionRequiresHostedAccount: true,
    accountConnectionsAvailable: hostedBrowserIsConfigured(),
    credentialCollectionEnabled: false,
    sessionTokenCollectionEnabled: false,
    plans: Object.values(RECRUITING_PLANS),
    capabilities: listProviderCapabilities(),
  });
}
