import { buildMetaStateTargeting } from "@/lib/facebook/geo/metaTargeting";
import { validateStates } from "@/lib/facebook/guardrails";
import { requireDailyBudgetCents } from "@/lib/facebook/launchFingerprint";

export type CampaignStructureCreative = {
  primaryText: string;
  headline: string;
  description?: string;
  cta?: string;
  imageUrl?: string;
  imagePrompt?: string;
  templateId?: string;
};

// Interest names for audience segments. IDs must be verified via the Meta API's
// /search?type=adinterest endpoint before use. Names alone may be resolved by Meta
// but ID-based targeting is more reliable.
// TODO: call the centrally versioned Meta Graph /search?type=adinterest endpoint
// to obtain verified numeric interest IDs for each name before production use.
const AUDIENCE_SEGMENT_INTERESTS: Record<string, { name: string }[]> = {
  veteran: [
    { name: "United States Armed Forces" },
    { name: "Veteran" },
    { name: "Veterans of Foreign Wars" },
    { name: "American Legion" },
    { name: "Military" },
  ],
  trucker: [
    { name: "Trucking" },
    { name: "Commercial Driver's License" },
    { name: "Owner-operator (trucking)" },
    { name: "American Trucking Associations" },
    { name: "Commercial vehicle" },
  ],
};

export function buildCampaignStructure(input: {
  campaignName: string;
  licensedStates: unknown;
  dailyBudgetCents: number;
  creatives: CampaignStructureCreative[];
  audienceSegment?: string;
  performanceGoal?: "LEAD_GENERATION" | "QUALITY_LEAD";
}) {
  const licensedStates = validateStates(input.licensedStates);
  const creatives = (Array.isArray(input.creatives) ? input.creatives : [])
    .filter((creative) => creative?.primaryText && creative?.headline)
    .slice(0, 2);

  if (!creatives.length) {
    throw new Error("Template creative required");
  }

  const targeting = buildMetaStateTargeting(licensedStates);
  if (!targeting?.geo_locations || (targeting.geo_locations as any).countries) {
    throw new Error("Valid state targeting required");
  }

  const segmentInterests = input.audienceSegment
    ? AUDIENCE_SEGMENT_INTERESTS[input.audienceSegment]
    : undefined;
  // Interest name-only targeting removed — Meta requires verified numeric IDs.
  // TODO: replace with { id, name } objects from /search?type=adinterest endpoint.
  const segmentTargeting = targeting;

  return {
    campaign: {
      name: String(input.campaignName || "").trim(),
      objective: "OUTCOME_LEADS",
      special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
      buying_type: "AUCTION",
      status: "PAUSED",
    },
    adSet: {
      name: `${String(input.campaignName || "").trim()} Ad Set`,
      daily_budget: requireDailyBudgetCents(input.dailyBudgetCents),
      optimization_goal: input.performanceGoal === "QUALITY_LEAD" ? "QUALITY_LEAD" : "LEAD_GENERATION",
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      status: "PAUSED",
      targeting: segmentTargeting,
      // Feed-only until a dedicated 1080x1920 asset is supplied via asset_feed_spec.
      // TODO(meta-stories): add placement-specific Stories/Reels creative before enabling those positions.
    },
    ads: creatives.map((creative, index) => ({
      name: `${String(input.campaignName || "").trim()} Ad ${index + 1}`,
      templateId: creative.templateId || `locked_template_${index + 1}`,
      primaryText: String(creative.primaryText),
      headline: String(creative.headline),
      description: String(creative.description || ""),
      cta: String(creative.cta || "LEARN_MORE"),
      imageUrl: String(creative.imageUrl || ""),
      imagePrompt: String(creative.imagePrompt || ""),
    })),
  };
}
