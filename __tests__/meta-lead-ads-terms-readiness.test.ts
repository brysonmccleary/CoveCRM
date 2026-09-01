import {
  checkLeadAdsTermsReadiness,
  facebookSetupComplete,
  META_LEAD_ADS_TERMS_URL,
} from "@/lib/meta/leadAdsTermsReadiness";

function response(body: any, ok = true, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as Response;
}

describe("Page-specific Facebook Lead Ads Terms readiness", () => {
  test("maps a new Page without accepted terms to TERMS_REQUIRED", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({
      id: "page-new",
      leadgen_tos_accepted: false,
    }));

    await expect(checkLeadAdsTermsReadiness({
      pageId: "page-new",
      accessToken: "page-token",
      fetchImpl: fetchImpl as any,
    })).resolves.toMatchObject({ state: "TERMS_REQUIRED", pageId: "page-new", accepted: false });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("fields=id%2Cleadgen_tos_accepted%2Cleadgen_tos_acceptance_time");
    expect(META_LEAD_ADS_TERMS_URL).toBe("https://www.facebook.com/ads/leadgen/tos");
  });

  test("maps an accepted existing Page to READY", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({
      id: "page-existing",
      leadgen_tos_accepted: true,
      leadgen_tos_acceptance_time: "2026-09-01T04:38:32+0000",
    }));

    await expect(checkLeadAdsTermsReadiness({
      pageId: "page-existing",
      accessToken: "page-token",
      fetchImpl: fetchImpl as any,
    })).resolves.toMatchObject({
      state: "READY",
      pageId: "page-existing",
      accepted: true,
      acceptedAt: "2026-09-01T04:38:32+0000",
    });
  });

  test("requires readiness for the exact currently selected Page", () => {
    expect(facebookSetupComplete({
      connected: true,
      pageId: "page-a",
      adAccountId: "123",
      adAccountActive: true,
      leadAdsTerms: { pageId: "page-a", state: "READY" },
    })).toBe(true);

    expect(facebookSetupComplete({
      connected: true,
      pageId: "page-b",
      adAccountId: "123",
      adAccountActive: true,
      leadAdsTerms: { pageId: "page-a", state: "READY" },
    })).toBe(false);
  });

  test("preserves real Meta technical failures instead of misclassifying them as terms-required", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({
      error: { code: 190, type: "OAuthException", message: "Invalid OAuth access token" },
    }, false, 400));

    await expect(checkLeadAdsTermsReadiness({
      pageId: "page-a",
      accessToken: "expired-token",
      fetchImpl: fetchImpl as any,
    })).rejects.toMatchObject({ status: 400, meta: expect.objectContaining({ code: 190 }) });
  });

  test("Cove policy warnings are not part of Facebook setup completion", () => {
    const setup = {
      connected: true,
      pageId: "page-a",
      adAccountId: "123",
      adAccountActive: true,
      leadAdsTerms: { pageId: "page-a", state: "READY" as const },
    };
    const policyWarnings = ["Cove creative preference warning"];
    expect(policyWarnings).toHaveLength(1);
    expect(facebookSetupComplete(setup)).toBe(true);
  });
});
