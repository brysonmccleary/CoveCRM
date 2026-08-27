/**
 * Read-only launch-readiness validation for the supported Meta audience matrix.
 * Usage: npx tsx scripts/validate-meta-targeting-matrix.ts <coveCampaignId> <pixelDatasetId>
 * Meta execution_options=["validate_only"] is used for every ad-set request.
 */
import "dotenv/config";
import mongoose from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";
import { buildCampaignStructure } from "@/lib/facebook/buildCampaignStructure";
import { metaGraphUrl } from "@/lib/meta/graphApi";

const coveCampaignId = String(process.argv[2] || "").trim();
const datasetId = String(process.argv[3] || "").trim();
if (!mongoose.isValidObjectId(coveCampaignId) || !/^\d{5,30}$/.test(datasetId)) {
  throw new Error("Usage: npx tsx scripts/validate-meta-targeting-matrix.ts <coveCampaignId> <pixelDatasetId>");
}

const combinations = [
  ["Veteran", "veteran", "veteran"],
  ["Mortgage", "mortgage_protection", "standard"],
  ["Trucker", "trucker", "trucker"],
  ["IUL", "iul", "standard"],
  ["Spanish", "final_expense", "spanish"],
  ["Final Expense", "final_expense", "standard"],
  ["Veteran Mortgage", "mortgage_protection", "veteran"],
  ["Veteran IUL", "iul", "veteran"],
  ["Veteran Final Expense", "final_expense", "veteran"],
  ["Trucker Mortgage", "mortgage_protection", "trucker"],
  ["Trucker IUL", "iul", "trucker"],
  ["Trucker Final Expense", "final_expense", "trucker"],
  ["Spanish Mortgage", "mortgage_protection", "spanish"],
  ["Spanish IUL", "iul", "spanish"],
  ["Spanish Final Expense", "final_expense", "spanish"],
] as const;

async function main() {
  await mongooseConnect();
  const campaign = await FBLeadCampaign.findById(coveCampaignId)
    .select("userId metaCampaignId licensedStates")
    .lean() as any;
  if (!campaign?.metaCampaignId) throw new Error("Cove campaign has no Meta campaign ID");
  const user = await User.findById(campaign.userId)
    .select("metaAccessToken metaSystemUserToken metaAdAccountId metaPageId")
    .lean() as any;
  const accessToken = String(user?.metaSystemUserToken || user?.metaAccessToken || "").trim();
  const adAccountId = String(user?.metaAdAccountId || "").replace(/^act_/, "");
  const pageId = String(user?.metaPageId || "").trim();
  if (!accessToken || !adAccountId || !pageId) throw new Error("Meta account, page, or token is missing");

  const statusParams = new URLSearchParams({ fields: "status,effective_status,special_ad_categories,objective", access_token: accessToken });
  const statusResponse = await fetch(`${metaGraphUrl(campaign.metaCampaignId)}?${statusParams.toString()}`);
  const status = await statusResponse.json();
  if (!statusResponse.ok || status?.error) throw new Error(`Could not verify anchor campaign: ${status?.error?.message || statusResponse.status}`);
  if (status.effective_status === "ACTIVE") throw new Error("Safety stop: validation anchor campaign is active");
  if (!Array.isArray(status.special_ad_categories) || !status.special_ad_categories.includes("FINANCIAL_PRODUCTS_SERVICES")) {
    throw new Error("Validation anchor is not a Financial Products campaign");
  }

  const rows: Array<Record<string, any>> = [];
  for (const [name, leadType, audienceSegment] of combinations) {
    const structure = buildCampaignStructure({
      campaignName: `${name} validate_only`,
      leadType,
      audienceSegment,
      licensedStates: campaign.licensedStates,
      dailyBudgetCents: 500,
      campaignType: "hosted_funnel",
      creatives: [{ primaryText: "validate only", headline: "validate only" }],
    });
    const params = new URLSearchParams();
    params.set("name", `${name} validate_only`);
    params.set("campaign_id", String(campaign.metaCampaignId));
    params.set("daily_budget", "500");
    params.set("billing_event", "IMPRESSIONS");
    params.set("optimization_goal", structure.adSet.optimization_goal);
    params.set("bid_strategy", "LOWEST_COST_WITHOUT_CAP");
    params.set("status", "PAUSED");
    params.set("promoted_object", JSON.stringify({ page_id: pageId, pixel_id: datasetId, custom_event_type: "LEAD" }));
    params.set("targeting", JSON.stringify(structure.adSet.targeting));
    params.set("destination_type", "WEBSITE");
    params.set("attribution_spec", JSON.stringify([
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ]));
    params.set("execution_options", JSON.stringify(["validate_only"]));
    params.set("access_token", accessToken);
    const response = await fetch(metaGraphUrl(`act_${adAccountId}/adsets`), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const body = await response.json();
    rows.push({
      name,
      ok: response.ok && !body?.error,
      locales: structure.targetingProfile.locales,
      interestGroups: structure.targetingProfile.interestGroups.map((group) => group.map((interest) => interest.id)),
      error: body?.error?.error_user_msg || body?.error?.message || "",
    });
  }
  console.log(JSON.stringify({
    validationOnly: true,
    anchorEffectiveStatus: status.effective_status,
    datasetId,
    passed: rows.filter((row) => row.ok).length,
    total: rows.length,
    rows,
  }, null, 2));
  if (rows.some((row) => !row.ok)) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
