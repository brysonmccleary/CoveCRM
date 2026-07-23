import {
  resolveHostedAttribution,
  signHostedAttributionToken,
  stableLeadEventId,
  verifyHostedAttributionToken,
} from "@/lib/facebook/hostedAttribution";

describe("hosted-funnel attribution", () => {
  const priorSecret = process.env.META_ATTRIBUTION_SECRET;

  beforeAll(() => {
    process.env.META_ATTRIBUTION_SECRET = "unit-test-attribution-secret";
  });

  afterAll(() => {
    if (priorSecret === undefined) delete process.env.META_ATTRIBUTION_SECRET;
    else process.env.META_ATTRIBUTION_SECRET = priorSecret;
  });

  it("round-trips a signed token", () => {
    const token = signHostedAttributionToken({
      campaignId: "campaign-1",
      variantId: "variant-2",
      creativeFamily: "fe_senior_benefit_card",
      issuedAt: 1234,
    });

    expect(verifyHostedAttributionToken(token)).toEqual({
      version: 1,
      campaignId: "campaign-1",
      variantId: "variant-2",
      creativeFamily: "fe_senior_benefit_card",
      issuedAt: 1234,
    });
  });

  it("rejects a tampered token", () => {
    const token = signHostedAttributionToken({ campaignId: "campaign-1", variantId: "variant-1" });
    const [payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.variantId = "variant-2";
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

    expect(() => verifyHostedAttributionToken(tampered)).toThrow("Invalid attribution token signature");
  });

  it("resolves only the signed variant to its final Meta IDs", () => {
    const token = signHostedAttributionToken({
      campaignId: "campaign-1",
      variantId: "variant-2",
      creativeFamily: "family-2",
    });

    expect(
      resolveHostedAttribution({
        token,
        campaignId: "campaign-1",
        ads: [
          { variantId: "variant-1", metaAdId: "first-ad", metaCreativeId: "first-creative", creativeFamily: "family-1" },
          { variantId: "variant-2", metaAdId: "correct-ad", metaCreativeId: "correct-creative", creativeFamily: "family-2" },
        ],
      })
    ).toEqual({
      metaAdId: "correct-ad",
      metaCreativeId: "correct-creative",
      variantId: "variant-2",
      creativeFamily: "family-2",
    });
  });

  it("creates stable deterministic lead event IDs", () => {
    expect(stableLeadEventId("meta-native", "lead-123")).toBe(
      stableLeadEventId("meta-native", "lead-123")
    );
    expect(stableLeadEventId("meta-native", "lead-123")).not.toBe(
      stableLeadEventId("meta-native", "lead-124")
    );
  });
});
