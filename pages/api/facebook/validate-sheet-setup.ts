// pages/api/facebook/validate-sheet-setup.ts
// POST — validate per-campaign Apps Script and expected Google Sheet headers.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import { getCanonicalHeaders, getLeadSheetType } from "@/lib/facebook/sheets/sheetHeaders";
import { getSheetMappingProfile } from "@/lib/facebook/sheets/getSheetMappingProfile";

function isValidAppsScriptUrl(value: string) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/i.test(value.trim());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { campaignId, appsScriptUrl } = req.body as {
    campaignId?: string;
    appsScriptUrl?: string;
  };
  if (!campaignId) return res.status(400).json({ error: "campaignId is required" });

  await mongooseConnect();

  const campaign = await FBLeadCampaign.findOne({
    _id: campaignId,
    userEmail: session.user.email.toLowerCase(),
  });
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const scriptUrl = String(appsScriptUrl || (campaign as any).appsScriptUrl || "").trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!scriptUrl) errors.push("Apps Script Web App URL is required.");
  if (scriptUrl && !isValidAppsScriptUrl(scriptUrl)) {
    errors.push("Apps Script URL must look like https://script.google.com/macros/s/.../exec");
  }

  const sheetType = getLeadSheetType(String((campaign as any).leadType || ""));
  const expectedHeaders = getCanonicalHeaders(sheetType);
  let actualHeaders: string[] = [];
  let normalizedHeaderMap: any = {};

  if (!errors.length) {
    try {
      const url = new URL(scriptUrl);
      url.searchParams.set("action", "headers");
      const response = await fetch(url.toString(), { method: "GET" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        errors.push("Apps Script did not return a healthy response. Confirm deployment access is set to Anyone.");
      } else {
        actualHeaders = Array.isArray(data.headers) ? data.headers.map(String) : [];
        if (!actualHeaders.length) {
          warnings.push("Apps Script is active, but no headers were returned. Paste the exact header row into row 1 and validate again.");
        }
      }
    } catch {
      errors.push("Could not reach the Apps Script Web App URL. Confirm it is deployed as a Web App.");
    }
  }

  if (actualHeaders.length) {
    const profile = getSheetMappingProfile(sheetType, actualHeaders);
    normalizedHeaderMap = profile.mapping;
    if (!profile.valid) {
      errors.push(`Missing required columns: ${profile.missing.join(", ")}`);
    }
    if (profile.unexpected.length) {
      warnings.push(`Extra columns will be ignored by CoveCRM: ${profile.unexpected.join(", ")}`);
    }
  }

  const valid = errors.length === 0 && (!actualHeaders.length || getSheetMappingProfile(sheetType, actualHeaders).valid);

  await FBLeadCampaign.updateOne(
    { _id: campaign._id },
    {
      $set: {
        appsScriptUrl: scriptUrl,
        leadSheetType: sheetType,
        expectedSheetHeaders: expectedHeaders,
        sheetHeaderValidationPassed: valid,
        sheetLastValidatedAt: new Date(),
        sheetValidationErrors: errors,
        sheetMappingProfile: {
          actualHeaders,
          normalizedHeaderMap,
          warnings,
        },
        writeLeadsToSheet: valid,
      },
    }
  );

  return res.status(200).json({
    ok: true,
    valid,
    errors,
    warnings,
    expectedHeaders,
    actualHeaders,
    normalizedHeaderMap,
  });
}
