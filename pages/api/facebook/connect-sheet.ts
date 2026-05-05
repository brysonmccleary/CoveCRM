// pages/api/facebook/connect-sheet.ts
// POST — connect a Google Sheet / Apps Script URL to an FB lead campaign
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import { getCanonicalHeaders, getLeadSheetType } from "@/lib/facebook/sheets/sheetHeaders";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { campaignId, googleSheetUrl, appsScriptUrl } = req.body as {
    campaignId?: string;
    googleSheetUrl?: string;
    appsScriptUrl?: string;
  };

  if (!campaignId) return res.status(400).json({ error: "campaignId is required" });

  await mongooseConnect();

  const campaign = await FBLeadCampaign.findOne({
    _id: campaignId,
    userEmail: session.user.email.toLowerCase(),
  });

  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const updates: Record<string, any> = {};
  let scriptUrlChanged = false;
  if (googleSheetUrl !== undefined) {
    const trimmedSheetUrl = String(googleSheetUrl || "").trim();
    if (trimmedSheetUrl && !/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(trimmedSheetUrl)) {
      return res.status(400).json({ error: "Enter a valid Google Sheet URL." });
    }
    updates.googleSheetUrl = trimmedSheetUrl;
  }
  if (appsScriptUrl !== undefined) {
    const trimmedScriptUrl = String(appsScriptUrl || "").trim();
    if (trimmedScriptUrl && !/^https:\/\/script\.google\.com\//i.test(trimmedScriptUrl)) {
      return res.status(400).json({ error: "Enter a valid Google Apps Script Web App URL." });
    }
    scriptUrlChanged = trimmedScriptUrl !== String((campaign as any).appsScriptUrl || "").trim();
    updates.appsScriptUrl = trimmedScriptUrl;
  }
  const sheetType = getLeadSheetType(String((campaign as any).leadType || ""));
  updates.leadSheetType = sheetType;
  updates.expectedSheetHeaders = getCanonicalHeaders(sheetType);
  if (scriptUrlChanged) {
    updates.sheetHeaderValidationPassed = false;
    updates.sheetValidationErrors = [];
    updates.writeLeadsToSheet = false;
  } else {
    const finalScriptUrl = String((updates.appsScriptUrl ?? (campaign as any).appsScriptUrl) || "").trim();
    updates.writeLeadsToSheet = !!finalScriptUrl && !!(campaign as any).writeLeadsToSheet;
  }

  Object.assign(campaign, updates);
  await campaign.save();

  return res.status(200).json({
    ok: true,
    campaign,
    connected: {
      googleSheet: !!campaign.googleSheetUrl,
      appsScript: !!campaign.appsScriptUrl,
    },
  });
}
