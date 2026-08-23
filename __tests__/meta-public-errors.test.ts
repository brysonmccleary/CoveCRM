import {
  buildMetaCreativeEnhancementSpec,
  getMetaActivationPublicMessage,
  getMetaLaunchPublicMessage,
  META_ACTIVATION_ERROR_MESSAGE,
  META_LAUNCH_ERROR_MESSAGE,
} from "@/lib/facebook/publicMetaErrors";

describe("customer-safe Meta errors", () => {
  test("raw Meta parameter JSON becomes a plain launch message", () => {
    const raw = `Meta creative create failed: {"error":{"message":"(#100) Param key 'multi_advertiser_ads' in degrees_of_freedom_spec","type":"OAuthException","fbtrace_id":"secret-trace"}}`;
    const message = getMetaLaunchPublicMessage(raw);

    expect(message).toBe(META_LAUNCH_ERROR_MESSAGE);
    expect(message).not.toMatch(/[{}]|OAuth|fbtrace|degrees_of_freedom_spec/);
  });

  test("global creative collision gets a plain regenerate message", () => {
    expect(getMetaLaunchPublicMessage("That exact ad was just reserved or launched by another agent."))
      .toBe("That exact ad was just reserved or launched by another agent. Regenerate once to receive a fresh set.");
  });

  test("raw activation payload becomes a plain paused-state message", () => {
    const message = getMetaActivationPublicMessage({
      error: { message: "Unsupported post request", code: 100 },
    });
    expect(message).toBe(META_ACTIVATION_ERROR_MESSAGE);
    expect(message).not.toContain("100");
  });

  test("creative enhancement payload uses only Meta's accepted catalog key", () => {
    const spec = buildMetaCreativeEnhancementSpec();
    const fields = Object.keys(spec.creative_features_spec);

    expect(fields).toEqual(["standard_enhancements_catalog"]);
    expect(fields).not.toContain("multi_advertiser_ads");
    expect(fields).not.toContain("standard_enhancements");
  });
});
