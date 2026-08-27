import { hasMetaStatusDrift, metaActionCount } from "@/lib/facebook/metaReconciliation";

describe("read-only Meta/Cove reconciliation", () => {
  test("exposes when Cove says active but Meta is paused", () => {
    expect(hasMetaStatusDrift("active", "CAMPAIGN_PAUSED")).toBe(true);
    expect(hasMetaStatusDrift("paused", "PAUSED")).toBe(false);
    expect(hasMetaStatusDrift("paused", "ACTIVE")).toBe(true);
  });

  test("normalizes Meta action performance without mutating Cove history", () => {
    const row = { actions: [
      { action_type: "landing_page_view", value: "7" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "2" },
    ] };
    expect(metaActionCount(row, ["landing_page_view"])).toBe(7);
    expect(metaActionCount(row, ["offsite_conversion.fb_pixel_lead"])).toBe(2);
  });
});
