import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdPreviewCard, { ProductionFeedCreative, resolveCreativeLayoutFamily } from "@/components/FacebookAds/AdPreviewCard";
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
    expect(markup).toMatch(/No exam required|No medical exam options available|Fixed rates|Rates never increase with age|Simple qualification/);
    expect(markup).toContain("TAP YOUR AGE TO EXPLORE OPTIONS");
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
