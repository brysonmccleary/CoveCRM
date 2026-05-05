// pages/api/facebook/setup-sheet-instructions.ts
// GET — exact headers and Apps Script template for campaign-owned Google Sheet setup.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import { getCanonicalHeaders, getLeadSheetType } from "@/lib/facebook/sheets/sheetHeaders";
import { buildAppsScriptTemplate } from "@/lib/facebook/sheets/appsScriptTemplate";

const SETUP_STEPS = [
  "Create a blank Google Sheet you own.",
  "Paste this exact header row into row 1 of your blank sheet.",
  "Do not modify the column names unless instructed.",
  "Open Extensions -> Apps Script.",
  "Delete any existing code in the editor.",
  "Paste the CoveCRM Apps Script template.",
  "Click Deploy -> New deployment.",
  "Select type: Web app.",
  "Set Execute as: Me.",
  "Set Who has access: Anyone.",
  "Deploy and copy the Web App URL.",
  "Paste the Web App URL back into CoveCRM and click Validate.",
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  let leadType = String(req.query.leadType || "").trim().toLowerCase();
  const campaignId = String(req.query.campaignId || "").trim();

  if (campaignId) {
    const campaign = await FBLeadCampaign.findOne({
      _id: campaignId,
      userEmail: session.user.email.toLowerCase(),
    })
      .select("leadType licensedStates borderStateBehavior")
      .lean();
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    leadType = String((campaign as any).leadType || leadType);
  }

  const sheetType = getLeadSheetType(leadType);
  const headers = getCanonicalHeaders(sheetType);
  const headerRowText = headers.join("\t");

  return res.status(200).json({
    leadType,
    sheetType,
    steps: SETUP_STEPS,
    appsScriptTemplate: buildAppsScriptTemplate(sheetType),
    headers,
    headerRowText,
    notes: [
      "Paste this exact header row into row 1 of your blank sheet.",
      "Do not modify the column names unless instructed.",
      "Bordering states can sometimes still happen with ad delivery / lead intent. CoveCRM will block or warn on the hosted funnel based on your campaign settings.",
    ],
  });
}
