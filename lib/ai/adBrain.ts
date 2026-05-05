import OpenAI from "openai";

export type AiAdBrainAction = {
  action:
    | "scale_budget"
    | "decrease_budget"
    | "pause_campaign"
    | "duplicate_test"
    | "refresh_creative"
    | "monitor"
    | "data_check";
  campaignId: string;
  campaignName: string;
  reason: string;
  confidence: "low" | "medium" | "high";
  suggestedBudgetChangePercent?: number;
  suggestedCreativeAngle?: string;
  guardrails: string[];
};

export type AiAdBrainCampaignSummary = {
  _id?: unknown;
  campaignName?: unknown;
  leadType?: unknown;
  status?: unknown;
  dailyBudget?: unknown;
  totalSpend?: unknown;
  totalLeads?: unknown;
  cpl?: unknown;
  targetCpl?: unknown;
  ctr?: unknown;
  frequency?: unknown;
  performanceScore?: unknown;
  performanceClass?: unknown;
  appointmentsBooked?: unknown;
  sales?: unknown;
  revenue?: unknown;
  metaCampaignId?: unknown;
  metaAdsetId?: unknown;
  metaAdId?: unknown;
  createdAt?: unknown;
  lastAutomationActionAt?: unknown;
  metaPublishStatus?: unknown;
  metaObjectHealth?: unknown;
};

export type GenerateAdBrainRecommendationsInput = {
  campaigns: AiAdBrainCampaignSummary[];
  accountContext?: Record<string, unknown>;
};

export type GenerateAdBrainRecommendationsResult = {
  mode: "openai" | "fallback";
  recommendations: AiAdBrainAction[];
};

const MODEL = process.env.OPENAI_AD_BRAIN_MODEL || "gpt-4.1-mini";
const ALLOWED_ACTIONS = new Set<AiAdBrainAction["action"]>([
  "scale_budget",
  "decrease_budget",
  "pause_campaign",
  "duplicate_test",
  "refresh_creative",
  "monitor",
  "data_check",
]);
const CONFIDENCE = new Set<AiAdBrainAction["confidence"]>(["low", "medium", "high"]);
const DEFAULT_GUARDRAILS = [
  "Suggestion only; requires human approval before any Meta change.",
  "No live Meta API writes were executed.",
  "Re-check CRM outcomes and Meta delivery before acting.",
];

function asString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function compactCampaign(campaign: AiAdBrainCampaignSummary) {
  return {
    _id: asString(campaign._id),
    campaignName: asString(campaign.campaignName, "Untitled campaign"),
    leadType: asString(campaign.leadType),
    status: asString(campaign.status),
    dailyBudget: asNumber(campaign.dailyBudget),
    totalSpend: asNumber(campaign.totalSpend),
    totalLeads: asNumber(campaign.totalLeads),
    cpl: asNumber(campaign.cpl),
    targetCpl: asNumber(campaign.targetCpl),
    ctr: asNumber(campaign.ctr),
    frequency: asNumber(campaign.frequency),
    performanceScore: asNumber(campaign.performanceScore),
    performanceClass: asString(campaign.performanceClass),
    appointmentsBooked: asNumber(campaign.appointmentsBooked),
    sales: asNumber(campaign.sales),
    revenue: asNumber(campaign.revenue),
    metaCampaignId: asString(campaign.metaCampaignId),
    metaAdsetId: asString(campaign.metaAdsetId),
    metaAdId: asString(campaign.metaAdId),
    createdAt: campaign.createdAt ? asString(campaign.createdAt) : "",
    lastAutomationActionAt: campaign.lastAutomationActionAt
      ? asString(campaign.lastAutomationActionAt)
      : "",
    metaPublishStatus: asString(campaign.metaPublishStatus),
    metaObjectHealth: asString(campaign.metaObjectHealth),
  };
}

function baseAction(
  campaign: ReturnType<typeof compactCampaign>,
  action: AiAdBrainAction["action"],
  reason: string,
  confidence: AiAdBrainAction["confidence"] = "medium",
  extras: Partial<Pick<AiAdBrainAction, "suggestedBudgetChangePercent" | "suggestedCreativeAngle">> = {},
): AiAdBrainAction {
  return {
    action,
    campaignId: campaign._id || campaign.metaCampaignId || "unknown",
    campaignName: campaign.campaignName || "Untitled campaign",
    reason,
    confidence,
    ...extras,
    guardrails: DEFAULT_GUARDRAILS,
  };
}

function fallbackRecommendations(
  campaigns: ReturnType<typeof compactCampaign>[],
): AiAdBrainAction[] {
  const actions: AiAdBrainAction[] = [];

  for (const campaign of campaigns) {
    const spend = campaign.totalSpend;
    const leads = campaign.totalLeads;
    const targetCpl = campaign.targetCpl;
    const cpl = campaign.cpl;
    const performanceClass = campaign.performanceClass.toUpperCase();

    if (!campaign.metaCampaignId) {
      actions.push(
        baseAction(
          campaign,
          "data_check",
          "Campaign is missing a Meta campaign id, so verify publishing and sync before optimizing.",
          "high",
        ),
      );
    }

    if (spend < 50 || leads < 5) {
      actions.push(
        baseAction(
          campaign,
          "monitor",
          "Campaign does not have enough spend or lead volume for a confident optimization decision.",
          "high",
        ),
      );
      continue;
    }

    if (cpl > targetCpl && targetCpl > 0) {
      actions.push(
        baseAction(
          campaign,
          "refresh_creative",
          `CPL is above target ($${cpl.toFixed(2)} vs $${targetCpl.toFixed(2)}), so test a new creative angle before changing delivery.`,
          "medium",
          { suggestedCreativeAngle: "Lead-quality focused proof and appointment intent" },
        ),
      );
    }

    if (performanceClass === "SCALE") {
      actions.push(
        baseAction(
          campaign,
          "scale_budget",
          "Performance class is SCALE with enough data; consider a careful budget increase after review.",
          "medium",
          { suggestedBudgetChangePercent: 20 },
        ),
      );
    }

    if (performanceClass === "PAUSE") {
      actions.push(
        baseAction(
          campaign,
          "pause_campaign",
          "Performance class is PAUSE with enough spend and lead data; review before pausing live delivery.",
          "medium",
        ),
      );
    }

    if (campaign.frequency > 3) {
      actions.push(
        baseAction(
          campaign,
          "refresh_creative",
          `Frequency is elevated (${campaign.frequency.toFixed(2)}), which can indicate creative fatigue.`,
          "medium",
          { suggestedCreativeAngle: "Fresh hook with stronger qualification language" },
        ),
      );
    }
  }

  return actions;
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty_response");

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const firstArray = trimmed.indexOf("[");
  const lastArray = trimmed.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    return JSON.parse(trimmed.slice(firstArray, lastArray + 1));
  }

  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    return JSON.parse(trimmed.slice(firstObject, lastObject + 1));
  }

  throw new Error("invalid_json_response");
}

function normalizeActions(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const candidate = (raw as { recommendations?: unknown; actions?: unknown }).recommendations ??
      (raw as { actions?: unknown }).actions;
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function validateActions(
  raw: unknown,
  campaigns: ReturnType<typeof compactCampaign>[],
): AiAdBrainAction[] {
  const campaignById = new Map<string, ReturnType<typeof compactCampaign>>();
  for (const campaign of campaigns) {
    campaignById.set(campaign._id, campaign);
    if (campaign.metaCampaignId) campaignById.set(campaign.metaCampaignId, campaign);
  }

  const actions: AiAdBrainAction[] = [];
  for (const item of normalizeActions(raw)) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const action = asString(value.action) as AiAdBrainAction["action"];
    if (!ALLOWED_ACTIONS.has(action)) continue;

    const campaignId = asString(value.campaignId);
    const campaign = campaignById.get(campaignId);
    if (!campaign) continue;

    if (action === "pause_campaign" && (campaign.totalSpend < 50 || campaign.totalLeads < 5)) {
      continue;
    }

    if (action === "scale_budget" && campaign.appointmentsBooked <= 0 && campaign.sales <= 0) {
      continue;
    }

    const confidence = CONFIDENCE.has(asString(value.confidence) as AiAdBrainAction["confidence"])
      ? (asString(value.confidence) as AiAdBrainAction["confidence"])
      : "low";
    const guardrails = Array.isArray(value.guardrails)
      ? value.guardrails.map((g) => asString(g)).filter(Boolean)
      : [];
    const budgetChange = value.suggestedBudgetChangePercent;
    const parsedBudgetChange =
      budgetChange === undefined || budgetChange === null
        ? undefined
        : Math.round(clamp(asNumber(budgetChange), -30, 30));

    actions.push({
      action,
      campaignId: campaign._id || campaign.metaCampaignId || campaignId,
      campaignName: campaign.campaignName,
      reason:
        asString(value.reason) ||
        "AI recommends reviewing this campaign before taking any optimization action.",
      confidence,
      ...(parsedBudgetChange === undefined
        ? {}
        : { suggestedBudgetChangePercent: parsedBudgetChange }),
      ...(value.suggestedCreativeAngle
        ? { suggestedCreativeAngle: asString(value.suggestedCreativeAngle) }
        : {}),
      guardrails: Array.from(new Set([...guardrails, ...DEFAULT_GUARDRAILS])),
    });
  }

  return actions;
}

export async function generateAdBrainRecommendations(
  input: GenerateAdBrainRecommendationsInput,
): Promise<GenerateAdBrainRecommendationsResult> {
  const campaigns = Array.isArray(input.campaigns) ? input.campaigns.map(compactCampaign) : [];
  const fallback = () => ({
    mode: "fallback" as const,
    recommendations: fallbackRecommendations(campaigns),
  });

  if (!process.env.OPENAI_API_KEY) {
    return fallback();
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an AI media buyer for insurance lead generation. Use CRM outcomes over raw CPL; higher CPL with sales can be better than cheap bad leads. Return JSON only with a recommendations array. All actions are approval-first suggestions only. Never suggest budget changes over 30%. Never suggest pausing if spend is under 50 or leads are under 5. Never suggest scaling if there are zero booked appointments and zero sales. Do not claim any Meta changes were made.",
        },
        {
          role: "user",
          content: JSON.stringify({
            accountContext: input.accountContext || {},
            allowedActions: Array.from(ALLOWED_ACTIONS),
            requiredShape: {
              recommendations: [
                {
                  action: "scale_budget | decrease_budget | pause_campaign | duplicate_test | refresh_creative | monitor | data_check",
                  campaignId: "string",
                  campaignName: "string",
                  reason: "string",
                  confidence: "low | medium | high",
                  suggestedBudgetChangePercent: "optional number from -30 to 30",
                  suggestedCreativeAngle: "optional string",
                  guardrails: "string[]",
                },
              ],
            },
            campaigns,
          }),
        },
      ],
      max_tokens: 1400,
    });

    const content = completion.choices[0]?.message?.content || "";
    const parsed = parseJsonObject(content);
    const recommendations = validateActions(parsed, campaigns);

    if (!recommendations.length && campaigns.length) {
      return fallback();
    }

    return { mode: "openai", recommendations };
  } catch (err) {
    console.warn("[adBrain] OpenAI unavailable or invalid response; using fallback.");
    return fallback();
  }
}
