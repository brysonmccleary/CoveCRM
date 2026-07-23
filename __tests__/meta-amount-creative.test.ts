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
    expect(markup).toMatch(/See What I Qualify For|Check My Options|Learn More/);
  });
});

