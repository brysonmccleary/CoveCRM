import { buildMetaStateTargeting } from "@/lib/facebook/geo/metaTargeting";
import { validateStates } from "@/lib/facebook/guardrails";
import { requireDailyBudgetCents } from "@/lib/facebook/launchFingerprint";
import {
  applyMetaAudienceProfile,
  getMetaAudienceProfile,
  type MetaLeadType,
} from "@/lib/facebook/audienceTargeting";

export type CampaignStructureCreative = {
  primaryText: string;
  headline: string;
  description?: string;
  cta?: string;
  imageUrl?: string;
  imagePrompt?: string;
  templateId?: string;
};

export function buildCampaignStructure(input: {
  campaignName: string;
  leadType: MetaLeadType;
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

  const baseTargeting = buildMetaStateTargeting(licensedStates);
  if (!baseTargeting?.geo_locations || (baseTargeting.geo_locations as any).countries) {
    throw new Error("Valid state targeting required");
  }
  const targetingProfile = getMetaAudienceProfile({
    leadType: input.leadType,
    audienceSegment: input.audienceSegment,
  });
  const segmentTargeting = applyMetaAudienceProfile(baseTargeting, targetingProfile);

  return {
    campaign: {
      name: String(input.campaignName || "").trim(),
      objective: "OUTCOME_LEADS",
      special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"],
      buying_type: "AUCTION",
      status: "PAUSED",
    },
    targetingProfile,
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
