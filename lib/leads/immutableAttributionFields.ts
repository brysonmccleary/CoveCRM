const IMMUTABLE_ATTRIBUTION_FIELDS = new Set(
  [
    "metaLeadgenId",
    "metaFormId",
    "metaAdId",
    "metaAdsetId",
    "metaCampaignId",
    "metaPageId",
    "metaCreatedTime",
    "metaRawPayload",
    "sourceType",
    "campaignId",
    "sourceCampaignId",
    "facebookCampaignId",
    "metaCreativeId",
    "creativeId",
    "visualVariantIndex",
    "creativeArchetype",
    "variationType",
  ].map((field) => field.toLowerCase())
);

export function isImmutableAttributionField(field: string): boolean {
  return IMMUTABLE_ATTRIBUTION_FIELDS.has(String(field || "").trim().toLowerCase());
}

