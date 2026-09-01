import { metaGraphUrl } from "@/lib/meta/graphApi";
import { getMetaAttributionSpec } from "@/lib/facebook/metaAttributionSpec";

type FetchLike = typeof fetch;

async function metaJson(response: Response, label: string) {
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.error) {
    const message = json?.error?.error_user_msg || json?.error?.message || JSON.stringify(json);
    throw new Error(`Meta validate_only ${label} failed: ${message}`);
  }
  return json;
}

export async function preflightMetaLaunch(input: {
  adAccountId: string;
  accessToken: string;
  campaign: Record<string, any>;
  adSet: Record<string, any>;
  pageId: string;
  datasetId?: string;
  campaignType: "native_form" | "hosted_funnel" | "hosted_funnel_otp";
  validationCampaignId?: string;
  fetchImpl?: FetchLike;
}) {
  const fetchImpl = input.fetchImpl || fetch;
  const adAccountId = String(input.adAccountId).replace(/^act_/, "");
  const campaignParams = new URLSearchParams();
  campaignParams.set("name", `${String(input.campaign.name || "CoveCRM Preflight")} [validate_only]`);
  campaignParams.set("objective", String(input.campaign.objective));
  campaignParams.set("buying_type", String(input.campaign.buying_type));
  campaignParams.set("status", "PAUSED");
  campaignParams.set("special_ad_categories", JSON.stringify(input.campaign.special_ad_categories));
  campaignParams.set("special_ad_category_countries", JSON.stringify(["US"]));
  // Graph API v24 requires an explicit choice for ad-set budget sharing when
  // the campaign is not using a campaign-level budget. Keep it disabled so
  // the live ad set retains its exact configured budget.
  campaignParams.set("is_adset_budget_sharing_enabled", "false");
  campaignParams.set("execution_options", JSON.stringify(["validate_only"]));
  campaignParams.set("access_token", input.accessToken);
  const campaignResult = await metaJson(await fetchImpl(metaGraphUrl(`act_${adAccountId}/campaigns`), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: campaignParams.toString(),
  }), "campaign");

  let validationCampaignId = String(input.validationCampaignId || "").trim();
  if (!validationCampaignId) {
    const query = new URLSearchParams({
      fields: "id,special_ad_categories,objective",
      limit: "100",
      access_token: input.accessToken,
    });
    const existing = await metaJson(await fetchImpl(
      `${metaGraphUrl(`act_${adAccountId}/campaigns`)}?${query.toString()}`,
      { method: "GET" }
    ), "validation anchor lookup");
    validationCampaignId = String((existing?.data || []).find((row: any) =>
      Array.isArray(row?.special_ad_categories) &&
      row.special_ad_categories.includes("FINANCIAL_PRODUCTS_SERVICES") &&
      row.objective === input.campaign.objective
    )?.id || "");
  }
  if (!validationCampaignId) {
    throw new Error("Meta validate_only ad-set preflight requires an existing paused Financial Products leads campaign in this ad account; no real campaign objects were created");
  }

  const promotedObject = input.campaignType === "native_form"
    ? { page_id: input.pageId }
    : {
        page_id: input.pageId,
        pixel_id: String(input.datasetId || ""),
        custom_event_type: "LEAD",
      };
  if (input.campaignType !== "native_form" && !promotedObject.pixel_id) {
    throw new Error("Meta validate_only ad-set preflight requires a Pixel/dataset for website leads");
  }

  const adsetParams = new URLSearchParams();
  adsetParams.set("name", `${String(input.adSet.name || "CoveCRM Preflight")} [validate_only]`);
  adsetParams.set("campaign_id", validationCampaignId);
  adsetParams.set("daily_budget", String(input.adSet.daily_budget));
  adsetParams.set("billing_event", String(input.adSet.billing_event));
  adsetParams.set("optimization_goal", String(input.adSet.optimization_goal));
  adsetParams.set("bid_strategy", String(input.adSet.bid_strategy));
  adsetParams.set("status", "PAUSED");
  adsetParams.set("promoted_object", JSON.stringify(promotedObject));
  adsetParams.set("targeting", JSON.stringify(input.adSet.targeting));
  adsetParams.set("destination_type", input.campaignType === "native_form" ? "ON_AD" : "WEBSITE");
  adsetParams.set("attribution_spec", JSON.stringify(getMetaAttributionSpec(input.campaignType)));
  adsetParams.set("execution_options", JSON.stringify(["validate_only"]));
  adsetParams.set("access_token", input.accessToken);
  const adSetResult = await metaJson(await fetchImpl(metaGraphUrl(`act_${adAccountId}/adsets`), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: adsetParams.toString(),
  }), "ad set");

  return { ok: true, validationCampaignId, campaignResult, adSetResult };
}
