import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductionFeedCreative } from "@/components/FacebookAds/AdPreviewCard";
import { generateCreativeIntelligenceDrafts } from "@/lib/facebook/creativeIntelligence/engine";
import { CREATIVE_LAYOUTS } from "@/lib/facebook/creativeIntelligence/layouts";
import { contrastRatio, readableForeground } from "@/lib/facebook/creativeIntelligence/qualityGates";
import { buildSafeGeneralCapability } from "@/lib/facebook/creativeIntelligence/capabilities";

describe("Creative Intelligence rendered visual quality gates", () => {
  it.each([
    ["final_expense", "spanish"],
    ["mortgage_protection", "spanish"],
    ["iul", "spanish"],
    ["veteran", "veteran"],
    ["trucker", "trucker"],
  ] as const)("renders %s/%s Spanish creatives without material English UI", (vertical, audienceSegment) => {
    const draft = generateCreativeIntelligenceDrafts({
      vertical, audienceSegment, language: "es", userKey: `render-es-${vertical}`,
      campaignName: "Spanish Render QA", requestedCount: 3, generationNonce: `render-es-${vertical}`,
    })[0];
    const markup = renderToStaticMarkup(React.createElement(ProductionFeedCreative, { draft }));
    expect(markup).toContain('data-creative-language="es"');
    expect(markup).not.toMatch(/SELECT YOUR|VIEW OPTIONS|LEARN MORE|COVERAGE REVIEW|IMPORTANT COVERAGE NOTICE|LICENSED AGENT EXPLAINER|WHAT TO REVIEW|MY HOME|COMPANY DRIVER/i);
    expect(markup).toMatch(/OPCIONES|REVISIÓN|PROTECCIÓN|COBERTURA|EDUCACIÓN|VETERANOS|CONDUCTORES/i);
  });

  it.each([
    ["mortgage_protection", "veteran", /VETERANS \+ MORTGAGE PROTECTION/],
    ["iul", "veteran", /VETERANS \+ IUL EDUCATION/],
    ["final_expense", "veteran", /VETERANS \+ FINAL EXPENSE/],
    ["mortgage_protection", "trucker", /CDL DRIVERS \+ MORTGAGE PROTECTION/],
    ["iul", "trucker", /CDL DRIVERS \+ IUL EDUCATION/],
    ["final_expense", "trucker", /CDL DRIVERS \+ FINAL EXPENSE/],
  ] as const)("keeps feed-visible audience and product identity for %s/%s", (vertical, audienceSegment, identity) => {
    const draft = generateCreativeIntelligenceDrafts({
      vertical, audienceSegment, language: "en", userKey: `identity-${vertical}-${audienceSegment}`,
      campaignName: "Identity QA", requestedCount: 1, generationNonce: `identity-${vertical}-${audienceSegment}`,
    })[0];
    const markup = renderToStaticMarkup(React.createElement(ProductionFeedCreative, { draft }));
    expect(markup).toMatch(identity);
  });

  it("renders all twelve layout contracts as distinct compositions with protected selector controls", () => {
    const base = generateCreativeIntelligenceDrafts({
      vertical: "final_expense", audienceSegment: "standard", language: "en", userKey: "layout-render-qa",
      campaignName: "Layout Render QA", requestedCount: 1, generationNonce: "layout-render-qa",
    })[0];
    const markupByLayout = CREATIVE_LAYOUTS.map((layout, index) => {
      const leadType = layout.compatibleVerticals.includes("final_expense") ? "final_expense" : layout.compatibleVerticals[0];
      const draft = {
        ...base,
        leadType,
        layoutId: layout.layoutId,
        cssExecutionId: "",
        cssRendererFamily: "",
        cssCompositionVariant: "",
        creativeEngineVersion: 2,
        winningFamilyId: `layout-qa-${layout.layoutId}`,
        visualVariantIndex: index,
        visualTreatment: "graphic",
        visibleIdentityLabel: leadType === "iul" ? "IUL EDUCATION" : leadType === "veteran" ? "VETERANS + LIFE INSURANCE" : "FINAL EXPENSE",
      };
      return renderToStaticMarkup(React.createElement(ProductionFeedCreative, { draft }));
    });
    expect(markupByLayout).toHaveLength(12);
    expect(new Set(CREATIVE_LAYOUTS.map((layout) => layout.rendererFamily)).size).toBe(12);
    for (const markup of markupByLayout) {
      expect(markup).not.toContain("word-break:break-all");
      expect(markup).not.toContain("overflow-wrap:break-word");
      expect(markup).toContain('data-creative-selector-grid="true"');
      expect(markup).toContain('data-creative-selector-option="true"');
      expect(markup).toContain("min-height:36px");
    }
    const notice = markupByLayout[CREATIVE_LAYOUTS.findIndex((layout) => layout.layoutId === "notice_letter_paper")];
    expect(notice).toContain('data-creative-composition="eligibility-notice"');
    expect(notice).toContain('data-creative-zone="selector"');
    expect(notice).toContain("padding-bottom:52px");
    const education = markupByLayout[CREATIVE_LAYOUTS.findIndex((layout) => layout.layoutId === "educational_explainer_card")];
    expect(education).toContain("background:#1d4ed8");
    expect(education).toContain("color:#ffffff");
  });

  it("selects deterministic readable foregrounds at WCAG text contrast", () => {
    expect(contrastRatio("#ffffff", "#0f172a")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readableForeground("#f8f5f0", "#d4a017"), "#f8f5f0")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(readableForeground("#0a0a0a", "#1a2744"), "#0a0a0a")).toBeGreaterThanOrEqual(4.5);
  });

  it("renders an approved capability amount as an up-to offer with a disclosure", () => {
    const capability = {
      ...buildSafeGeneralCapability("veteran"), capabilityId: "render-amount-qa", carrier: "QA Carrier",
      product: "QA Product", productIdentifier: "QA-1", products: ["veteran" as const], states: ["AZ"],
      issueAgeMin: 45, issueAgeMax: 80, faceAmountMin: 25_000, faceAmountMax: 100_000,
      approvalSource: "QA carrier guide",
    };
    const draft = generateCreativeIntelligenceDrafts({
      vertical: "veteran", audienceSegment: "veteran", language: "en", userKey: "amount-render",
      campaignName: "Amount Render", requestedCount: 1, generationNonce: "amount-render", location: "AZ",
      applicantAge: 60, productCapability: capability, preferredFamilyId: "VET_IDENTITY_AGE_AMOUNT_CORE",
    })[0];
    const markup = renderToStaticMarkup(React.createElement(ProductionFeedCreative, { draft }));
    expect(markup).toContain("COVERAGE OPTIONS UP TO");
    expect(markup).toContain("$100,000");
    expect(markup).toMatch(/Availability varies by carrier, state, age, health/);
  });
});
