import { buildMetaStateTargeting } from "@/lib/facebook/geo/metaTargeting";
import { validateStates } from "@/lib/facebook/guardrails";

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
  licensedStates: unknown;
  dailyBudgetCents: number;
  creatives: CampaignStructureCreative[];
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

  return {
    campaign: {
      name: String(input.campaignName || "").trim(),
      objective: "LEADS",
      special_ad_categories: ["CREDIT"],
      buying_type: "AUCTION",
      status: "PAUSED",
    },
    adSet: {
      name: `${String(input.campaignName || "").trim()} Ad Set`,
      daily_budget: Math.max(500, Math.round(Number(input.dailyBudgetCents) || 0)),
      optimization_goal: "LEADS",
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      status: "PAUSED",
      targeting,
      placements: "advantage_plus_default",
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
