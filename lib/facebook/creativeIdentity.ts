import { createHash } from "crypto";

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Identity of the visible design selected by the generator. It deliberately
 * excludes user/account/campaign data and random nonces. The same background,
 * copy, offer, controls, and structure therefore resolve to the same global
 * signature regardless of who generated them.
 */
export function buildCreativeGenerationSignature(draft: Record<string, any>): string {
  const landing = draft?.landingPageConfig || {};
  const canonical = {
    schema: "cove-creative-v3",
    leadType: clean(draft?.leadType),
    audienceSegment: clean(draft?.audienceSegment || "standard"),
    primaryText: clean(draft?.primaryText),
    headline: clean(draft?.headline),
    description: clean(draft?.description),
    cta: clean(draft?.cta),
    creativeArchetype: clean(draft?.creativeArchetype || draft?.archetype),
    winningFamilyId: clean(draft?.winningFamilyId),
    variationType: clean(draft?.variationType),
    vendorStyleTag: clean(draft?.vendorStyleTag),
    displayAmount: clean(draft?.displayAmount),
    visualVariantIndex: Number.isFinite(Number(draft?.visualVariantIndex))
      ? Math.max(0, Math.floor(Number(draft.visualVariantIndex)))
      : 0,
    visualTreatment: clean(draft?.visualTreatment || "graphic"),
    buttonLabels: cleanList(draft?.buttonLabels),
    bulletPoints: cleanList(draft?.bulletPoints),
    landingPage: {
      pageType: clean(landing?.pageType),
      headline: clean(landing?.headline),
      subheadline: clean(landing?.subheadline),
      buttonLabels: cleanList(landing?.buttonLabels),
      benefitBullets: cleanList(landing?.benefitBullets),
      ctaStrip: clean(landing?.ctaStrip),
      styleTag: clean(landing?.theme?.styleTag),
    },
  };

  return `cgs_${sha256(JSON.stringify(canonical))}`;
}

/**
 * Final authority for "the exact same ad." The semantic design signature and
 * final 1080x1350 rendered bytes are both included. Copy-only, image-only, or
 * structural changes produce a different fingerprint; an exact repeat does not.
 */
export function buildPublishedCreativeFingerprint(draft: Record<string, any>): string {
  const renderedAsset = clean(draft?.renderedCreativeDataUrl || draft?.imageUrl);
  if (!renderedAsset) throw new Error("Rendered creative is required for uniqueness verification");

  return `cpf_${sha256(JSON.stringify({
    schema: "cove-published-creative-v1",
    primaryText: clean(draft?.primaryText),
    headline: clean(draft?.headline),
    description: clean(draft?.description),
    cta: clean(draft?.cta),
    renderedSha256: sha256(renderedAsset),
  }))}`;
}
