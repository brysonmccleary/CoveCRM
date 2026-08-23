import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdPreviewCard, { ProductionFeedCreative, resolveCreativeLayoutFamily } from "@/components/FacebookAds/AdPreviewCard";
import {
  WINNING_AD_LIBRARY,
  generateWinningVariants,
  getWinningFamilyById,
} from "@/lib/facebook/winningAdLibrary";

describe("Final Expense amount-focused creative", () => {
  test("Senior Benefit Card deterministically selects amount_hero and renders displayAmount with a CTA", () => {
    const family = getWinningFamilyById("fe_senior_benefit_card");
    expect(family?.displayAmount).toBe("$50,000");

    const variant = generateWinningVariants({
      leadType: "final_expense",
      audienceSegment: "standard",
      userId: "amount-test-user",
      campaignName: "amount-test-campaign",
      familyIdOverride: "fe_senior_benefit_card",
    }).emotional;
    const draft = {
      ...variant,
      winningFamilyId: variant.familyId,
      creativeArchetype: variant.archetype,
    };

    expect(variant.displayAmount).toBe("$50,000");
    expect(resolveCreativeLayoutFamily(draft, "final_expense", 1, 23)).toBe("amount_hero");
    expect(resolveCreativeLayoutFamily(draft, "final_expense", 999999, 0)).toBe("amount_hero");

    const markup = renderToStaticMarkup(React.createElement(ProductionFeedCreative, { draft }));
    expect(markup).toContain("$50,000");
    expect(markup).toMatch(/No exam required|No medical exam options available|Fixed rates|Rates never increase with age|Simple qualification/);
    expect(markup).toContain("SELECT YOUR AGE");
    expect(markup).toMatch(/See What I Qualify For|Check My Options|Learn More/);
  });

  test("keeps new final-expense ads inside the curated reference-based layout set", () => {
    const hashString = (value: string) => {
      let hash = 0;
      for (let index = 0; index < value.length; index += 1) {
        hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
      }
      return Math.abs(hash);
    };
    const baseDraft = {
      leadType: "final_expense",
      headline: "Help protect loved ones from final costs",
      description: "Explore private coverage options with a licensed agent.",
      displayAmount: "$40,000",
      buttonLabels: ["50-59", "60-69", "70-79", "80+"],
      benefitBullets: ["Simple review", "Family-focused options"],
      cta: "Review options",
      visualVariantIndex: 0,
    };
    const drafts = Array.from({ length: 200 }, (_, index) => ({
      ...baseDraft,
      uniquenessFingerprint: `legacy-quiz-${index}`,
    }));
    const layouts = drafts.map((draft) => {
      const seed = hashString(`${draft.uniquenessFingerprint}|${draft.headline}`);
      return resolveCreativeLayoutFamily(draft, "final_expense", seed, 0);
    });

    expect(layouts).not.toContain("quiz_card");
    expect(layouts).not.toContain("messenger_prompt");
    expect(layouts).not.toContain("mobile_native");
    expect(layouts).not.toContain("pop_art_burst");

    const markup = renderToStaticMarkup(React.createElement(ProductionFeedCreative, { draft: drafts[0] }));

    expect(markup).toContain("FINAL EXPENSE INSURANCE");
    expect(markup).not.toContain("QUESTION 1 OF 1");
    expect(markup).not.toContain("...");
  });

  test("uses the audience in the product label and photo pool", () => {
    const draft = {
      leadType: "iul",
      audienceSegment: "trucker",
      winningFamilyId: "iul_trucker_blue_highway",
      headline: "Future Planning For CDL Drivers",
      description: "Review cash value education for drivers.",
      visualVariantIndex: 2,
      buttonLabels: ["35-44", "45-54", "55-64", "65+"],
      benefitBullets: ["Cash value education", "Family protection"],
      cta: "Learn more",
    };

    const markup = renderToStaticMarkup(React.createElement(ProductionFeedCreative, { draft }));
    expect(markup).toContain("TRUCKERS IUL LIFE INSURANCE");
    expect(markup).toContain("/ad-backgrounds/trucker/3.jpg");
  });

  test("does not disable regeneration after the old three-attempt limit", () => {
    const markup = renderToStaticMarkup(React.createElement(AdPreviewCard, {
      draft: {
        leadType: "final_expense",
        headline: "Final Expense Insurance",
        buttonLabels: ["50-59", "60-69", "70-79", "80+"],
      },
      regenerateAttempts: 99,
      regenerating: false,
      onRegenerate: () => undefined,
    }));

    expect(markup).toContain("↺  Regenerate");
    expect(markup).not.toContain("No regenerations left");
  });
});

describe("Exhaustive generated-creative quality gate", () => {
  test("every enabled family and photo visual stays product-clear, avoids fake hero ranges, and exposes every paid background", () => {
    const paidPools = new Set(["veteran", "trucker", "mortgage_protection"]);
    const forbiddenLayouts = new Set([
      "quiz_card",
      "messenger_prompt",
      "mobile_native",
      "pop_art_burst",
      "aged_parchment",
      "patriotic_notice",
      "homeowner_table",
    ]);
    const variants = ["emotional", "logical", "curiosity"] as const;
    let rendered = 0;

    for (const family of WINNING_AD_LIBRARY.filter((candidate) => !candidate.disabled)) {
      const generated = generateWinningVariants({
        leadType: family.leadType,
        audienceSegment: family.audienceSegment || "standard",
        userId: "exhaustive-quality-gate",
        campaignName: `quality-${family.id}`,
        familyIdOverride: family.id,
      });

      for (const variantType of variants) {
        const variant = generated[variantType];
        for (let visualVariantIndex = 0; visualVariantIndex < 40; visualVariantIndex += 1) {
          for (const visualTreatment of ["photo", "graphic"] as const) {
            const draft = {
              ...variant,
              audienceSegment: family.audienceSegment || "standard",
              winningFamilyId: variant.familyId,
              creativeArchetype: variant.archetype,
              visualVariantIndex,
              visualTreatment,
            };
            const layout = resolveCreativeLayoutFamily(draft, family.leadType, 17, visualVariantIndex);
            const markup = renderToStaticMarkup(React.createElement(ProductionFeedCreative, { draft }));
            const visualLeadType = family.audienceSegment === "veteran" || family.audienceSegment === "trucker"
              ? family.audienceSegment
              : family.leadType;

            expect(markup).not.toMatch(/Under \$150k|Menos de \$150k|\$150k[-–]\$300k/i);
            expect(markup).not.toContain("...");
            expect(markup).not.toContain("rotate(-11deg)");

            if (visualTreatment === "graphic") {
              expect(markup).toContain('data-creative-layout="graphic-direct-response"');
              expect(markup).not.toMatch(/\/ad-backgrounds\/(veteran|trucker|mortgage_protection)\//);
            } else if (paidPools.has(visualLeadType)) {
              expect(forbiddenLayouts).not.toContain(layout);
              expect(markup).toContain('data-creative-layout="photo-direct-response"');
              expect(markup).toContain(`/ad-backgrounds/${visualLeadType}/${visualVariantIndex + 1}.jpg`);
            } else {
              expect(markup).toContain('data-creative-layout="graphic-direct-response"');
            }

            if (family.leadType === "mortgage_protection") {
              expect(markup).toMatch(/MORTGAGE PROTECTION|PROTECCIÓN HIPOTECARIA/);
              expect(markup).toMatch(/MORTGAGE BALANCE|SALDO (?:DE SU )?HIPOTECA|SALDO HIPOTECARIO/);
              for (const label of draft.landingPageConfig.buttonLabels) {
                const normalized = label.toLowerCase().replace(/,/g, "").trim();
                const amountMatch = normalized.match(/^\$(\d+)(k|\s*mil)?$/);
                expect(amountMatch).not.toBeNull();
                const amount = Number(amountMatch?.[1] || 0) * (amountMatch?.[2] ? 1000 : 1);
                expect([250000, 400000, 600000]).toContain(amount);
              }
            }
            if (family.leadType === "veteran") expect(markup).toContain("LIFE INSURANCE FOR VETERANS");
            if (family.leadType === "trucker") expect(markup).toContain("LIFE INSURANCE FOR CDL DRIVERS");
            if (family.leadType === "iul") expect(markup).toMatch(/INDEXED UNIVERSAL LIFE|IUL LIFE INSURANCE|TRUCKERS IUL|UNIVERSAL INDEXADO/);
            if (family.leadType === "final_expense") expect(markup).toMatch(/FINAL EXPENSE INSURANCE|SEGURO DE GASTOS FINALES/);
            if (draft.landingPageConfig.buttonLabels.some((label: string) => /\$/.test(label)) && family.leadType === "veteran") {
              expect(markup).toMatch(/CHOOSE A COVERAGE AMOUNT|ELIJA UN MONTO DE COBERTURA/);
              expect(markup).not.toMatch(/TAP YOUR AGE|SELECT YOUR AGE|ELIJA SU EDAD/);
            }
            rendered += 1;
          }
        }
      }
    }

    expect(rendered).toBeGreaterThan(16000);
  }, 60000);

  test("graphic treatments intentionally keep strong number-led layouts photo-free", () => {
    const variant = generateWinningVariants({
      leadType: "veteran",
      audienceSegment: "standard",
      userId: "graphic-veteran",
      campaignName: "graphic-veteran",
      familyIdOverride: "vet_patriotic_amount_card",
    }).logical;
    const markup = renderToStaticMarkup(React.createElement(ProductionFeedCreative, {
      draft: {
        ...variant,
        winningFamilyId: variant.familyId,
        creativeArchetype: variant.archetype,
        visualVariantIndex: 8,
        visualTreatment: "graphic",
      },
    }));

    expect(markup).toContain("LIFE INSURANCE FOR VETERANS");
    expect(markup).not.toContain("/ad-backgrounds/veteran/");
  });
});
