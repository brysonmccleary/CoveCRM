import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductionFeedCreative, resolveCreativeLayoutFamily } from "@/components/FacebookAds/AdPreviewCard";
import { generateWinningVariants, getWinningFamilyById } from "@/lib/facebook/winningAdLibrary";

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
    expect(markup).toMatch(/No exam required|Fixed rates|Simple qualification/);
    expect(markup).toContain("TAP YOUR AGE TO EXPLORE OPTIONS");
    expect(markup).toMatch(/See What I Qualify For|Check My Options|Learn More/);
  });

  test("replaces the legacy questionnaire layout with a direct-response offer card", () => {
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
    const quizDraft = Array.from({ length: 100 }, (_, index) => ({
      ...baseDraft,
      uniquenessFingerprint: `legacy-quiz-${index}`,
    })).find((draft) => {
      const seed = hashString(`${draft.uniquenessFingerprint}|${draft.headline}`);
      return resolveCreativeLayoutFamily(draft, "final_expense", seed, 0) === "quiz_card";
    });

    expect(quizDraft).toBeDefined();
    const markup = renderToStaticMarkup(React.createElement(ProductionFeedCreative, { draft: quizDraft }));

    expect(markup).toContain("FINAL EXPENSE COVERAGE");
    expect(markup).toContain("TAP YOUR AGE TO EXPLORE OPTIONS");
    expect(markup).not.toContain("QUESTION 1 OF 1");
  });
});
