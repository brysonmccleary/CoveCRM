export type MetaCampaignType = "native_form" | "hosted_funnel" | "hosted_funnel_otp";

export function getMetaAttributionSpec(campaignType: MetaCampaignType) {
  if (campaignType === "native_form") {
    return [
      { event_type: "CLICK_THROUGH", window_days: 1 },
      { event_type: "VIEW_THROUGH", window_days: 0 },
    ];
  }
  return [
    { event_type: "CLICK_THROUGH", window_days: 7 },
    { event_type: "VIEW_THROUGH", window_days: 1 },
  ];
}
