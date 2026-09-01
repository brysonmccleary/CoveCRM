import { metaGraphUrl } from "@/lib/meta/graphApi";

export const META_LEAD_ADS_TERMS_URL = "https://www.facebook.com/ads/leadgen/tos";

export type LeadAdsTermsState = "TERMS_REQUIRED" | "READY" | "TECHNICAL_ERROR";

export type LeadAdsTermsReadiness = {
  state: LeadAdsTermsState;
  pageId: string;
  accepted: boolean;
  acceptedAt: string;
  checkedAt: string;
};

type FetchLike = typeof fetch;

export async function checkLeadAdsTermsReadiness(input: {
  pageId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<LeadAdsTermsReadiness> {
  const pageId = String(input.pageId || "").trim();
  const accessToken = String(input.accessToken || "").trim();
  if (!pageId) throw new Error("A selected Facebook Page is required");
  if (!accessToken) throw new Error("Facebook Page access is required");

  const url = new URL(metaGraphUrl(pageId));
  url.searchParams.set("fields", "id,leadgen_tos_accepted,leadgen_tos_acceptance_time");
  url.searchParams.set("access_token", accessToken);
  const response = await (input.fetchImpl || fetch)(url.toString());
  const json = await response.json().catch(() => ({})) as any;

  if (!response.ok || json?.error) {
    const error: any = new Error(String(json?.error?.message || `Meta API error ${response.status}`));
    error.meta = json?.error || json;
    error.status = response.status;
    throw error;
  }
  if (String(json?.id || "") !== pageId) {
    throw new Error("Facebook returned a different Page while checking Lead Ads readiness");
  }

  const accepted = json?.leadgen_tos_accepted === true;
  return {
    state: accepted ? "READY" : "TERMS_REQUIRED",
    pageId,
    accepted,
    acceptedAt: accepted ? String(json?.leadgen_tos_acceptance_time || "") : "",
    checkedAt: new Date().toISOString(),
  };
}

export function facebookSetupComplete(input: {
  connected: boolean;
  pageId?: string;
  adAccountId?: string;
  adAccountActive?: boolean;
  leadAdsTerms?: Pick<LeadAdsTermsReadiness, "pageId" | "state"> | null;
}) {
  const pageId = String(input.pageId || "").trim();
  const adAccountId = String(input.adAccountId || "").trim();
  return Boolean(
    input.connected &&
    pageId &&
    adAccountId &&
    input.adAccountActive !== false &&
    input.leadAdsTerms?.pageId === pageId &&
    input.leadAdsTerms?.state === "READY"
  );
}
