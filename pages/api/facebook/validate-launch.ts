import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { buildCampaignStructure } from "@/lib/facebook/buildCampaignStructure";
import { validateStates } from "@/lib/facebook/guardrails";
import { validateWinningVariantMetadata } from "@/lib/facebook/winningAdLibrary";

const VALID_LEAD_TYPES = [
  "final_expense",
  "iul",
  "mortgage_protection",
  "veteran",
  "trucker",
];

export async function validateLaunchInput(params: {
  userEmail: string;
  body: any;
}) {
  await mongooseConnect();

  const body = params.body || {};
  const user = await User.findOne({ email: String(params.userEmail).toLowerCase() })
    .select("_id metaAccessToken metaSystemUserToken metaAdAccountId metaPageId metaLeadTypeAssets")
    .lean() as any;

  if (!user) throw new Error("User account not found");

  const accessToken = String(user.metaSystemUserToken || user.metaAccessToken || "").trim();
  const leadType = String(body.leadType || "").trim();
  const leadTypeAssets =
    leadType && user?.metaLeadTypeAssets
      ? user.metaLeadTypeAssets instanceof Map
        ? user.metaLeadTypeAssets.get(leadType)
        : user.metaLeadTypeAssets[leadType]
      : null;
  const adAccountId = String(
    body.adAccountId ||
      leadTypeAssets?.adAccountId ||
      user.metaAdAccountId ||
      ""
  ).trim();
  const pageId = String(
    body.facebookPageId ||
      leadTypeAssets?.pageId ||
      user.metaPageId ||
      ""
  ).trim();

  if (!accessToken || !adAccountId) throw new Error("Ad account connection required");
  if (!pageId) throw new Error("Facebook page connection required");

  if (!VALID_LEAD_TYPES.includes(leadType)) throw new Error("Lead type required");

  const licensedStates = validateStates(body.licensedStates);
  const winningFamily = validateWinningVariantMetadata({
    leadType,
    winningFamilyId: body.winningFamilyId,
    variationType: body.variationType,
    uniquenessFingerprint: body.uniquenessFingerprint,
    vendorStyleTag: body.vendorStyleTag,
  });

  if (!body.funnelType && !body.landingPageConfig && !body.winnerLandingPageConfig) {
    throw new Error("Funnel required");
  }

  const structure = buildCampaignStructure({
    campaignName: body.campaignName,
    licensedStates,
    dailyBudgetCents: Number(body.dailyBudgetCents || 0),
    creatives: [
      {
        primaryText: body.primaryText,
        headline: body.headline,
        description: body.description,
        cta: body.cta,
        imageUrl: body.imageUrl,
        imagePrompt: body.imagePrompt,
        templateId: winningFamily.id,
      },
    ],
  });

  if (!structure.campaign?.objective || !structure.adSet?.targeting?.geo_locations || !structure.ads.length) {
    throw new Error("Invalid campaign structure");
  }

  return {
    ok: true,
    user,
    accessToken,
    adAccountId: adAccountId.replace(/^act_/, ""),
    pageId,
    licensedStates,
    structure,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await validateLaunchInput({
      userEmail: session.user.email,
      body: req.body,
    });
    return res.status(200).json({
      ok: true,
      licensedStates: result.licensedStates,
      structure: result.structure,
    });
  } catch (err: any) {
    return res.status(400).json({ ok: false, error: err?.message || "Launch validation failed" });
  }
}
