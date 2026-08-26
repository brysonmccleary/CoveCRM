import { createHash } from "crypto";

export type LaunchFingerprintCreative = {
  primaryText?: string;
  headline?: string;
  description?: string;
  cta?: string;
  renderedCreativeDataUrl?: string;
  winningFamilyId?: string;
  variationType?: string;
  uniquenessFingerprint?: string;
  creativeArchetype?: string;
  displayAmount?: string;
};

function hashCreativeAsset(value: unknown): string {
  const asset = String(value || "");
  return asset ? createHash("sha256").update(asset).digest("hex") : "";
}

export function requireDailyBudgetCents(value: unknown): number {
  const cents = Number(value);
  if (!Number.isFinite(cents) || !Number.isInteger(cents) || cents < 500) {
    throw new Error("dailyBudgetCents must be a finite integer >= 500 ($5.00/day minimum)");
  }
  return cents;
}

export function buildLaunchFingerprint(input: {
  adAccountId: unknown;
  pageId?: unknown;
  leadType: unknown;
  audienceSegment?: unknown;
  campaignType?: unknown;
  licensedStates: string[];
  dailyBudgetCents: unknown;
  funnelType?: unknown;
  performanceGoal?: unknown;
  nativeFormSchemaVersion?: unknown;
  targetingPolicyVersion?: unknown;
  creatives: LaunchFingerprintCreative[];
}): string {
  const canonical = {
    launchSchemaVersion: "insurance-launch-v3",
    adAccountId: String(input.adAccountId || "").trim().replace(/^act_/, ""),
    pageId: String(input.pageId || "").trim(),
    leadType: String(input.leadType || "").trim(),
    audienceSegment: String(input.audienceSegment || "standard").trim(),
    campaignType: String(input.campaignType || "hosted_funnel").trim(),
    licensedStates: Array.from(new Set(input.licensedStates.map((state) => String(state).trim().toUpperCase()))).sort(),
    dailyBudgetCents: requireDailyBudgetCents(input.dailyBudgetCents),
    funnelType: String(input.funnelType || "").trim(),
    performanceGoal: String(input.performanceGoal || "LEAD_GENERATION").trim(),
    nativeFormSchemaVersion: input.campaignType === "native_form"
      ? String(input.nativeFormSchemaVersion || "insurance-native-v1").trim()
      : "",
    targetingPolicyVersion: String(input.targetingPolicyVersion || "").trim(),
    creatives: input.creatives.map((creative) => ({
      primaryText: String(creative.primaryText || ""),
      headline: String(creative.headline || ""),
      description: String(creative.description || ""),
      cta: String(creative.cta || ""),
      winningFamilyId: String(creative.winningFamilyId || ""),
      variationType: String(creative.variationType || ""),
      uniquenessFingerprint: String(creative.uniquenessFingerprint || ""),
      creativeArchetype: String(creative.creativeArchetype || ""),
      displayAmount: String(creative.displayAmount || ""),
      renderedCreativeSha256: hashCreativeAsset(creative.renderedCreativeDataUrl),
    })),
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
