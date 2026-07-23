import {
  anonymizeCampaignPerformance,
  applyGlobalWinnerHints,
  compareGlobalWinners,
  GLOBAL_LEARNING_ATTRIBUTION_CUTOFF,
  isPostAttributionFixLaunch,
} from "@/lib/facebook/globalIntelligence/anonymizedLearning";

describe("anonymized cross-account creative learning", () => {
  const postFixDate = new Date(GLOBAL_LEARNING_ATTRIBUTION_CUTOFF.getTime() + 60_000);

  it("excludes corrupted-era and unflagged launches", () => {
    expect(isPostAttributionFixLaunch({
      attributionVersion: "",
      metaLastPublishSuccessAt: postFixDate,
    })).toBe(false);
    expect(isPostAttributionFixLaunch({
      attributionVersion: "signed-v1",
      metaLastPublishSuccessAt: new Date(GLOBAL_LEARNING_ATTRIBUTION_CUTOFF.getTime() - 1),
    })).toBe(false);
    expect(isPostAttributionFixLaunch({
      attributionVersion: "signed-v1",
      metaLastPublishSuccessAt: postFixDate,
    })).toBe(true);
  });

  it("emits only anonymous family + lead type + state performance", () => {
    const [row] = anonymizeCampaignPerformance({
      attributionVersion: "signed-v1",
      metaLastPublishSuccessAt: postFixDate,
      userEmail: "private@tenant.example",
      campaignName: "Tenant-specific campaign",
      notes: JSON.stringify({ primaryText: "Unique tenant copy" }),
      leadType: "final_expense",
      licensedStates: ["AZ"],
      ads: [{ creativeFamily: "senior_benefit_card", spend: 100, leads: 10, appointmentsBooked: 2, sales: 1 }],
    });
    expect(row).toEqual({
      leadType: "final_expense",
      stateCode: "AZ",
      creativeFamily: "senior_benefit_card",
      spend: 100,
      leads: 10,
      appointments: 2,
      sales: 1,
      costPerLead: 10,
      costPerAppointment: 50,
      costPerSale: 100,
    });
    expect(JSON.stringify(row)).not.toContain("private@tenant");
    expect(JSON.stringify(row)).not.toContain("Unique tenant copy");
  });

  it("ranks appointment/sale outcomes above a cheaper CPL", () => {
    const cheapCpl = {
      leadType: "final_expense", stateCode: "AZ", creativeFamily: "cheap",
      spend: 100, leads: 50, appointments: 0, sales: 0,
      costPerLead: 2, costPerAppointment: 0, costPerSale: 0,
    };
    const appointmentWinner = {
      leadType: "final_expense", stateCode: "AZ", creativeFamily: "quality",
      spend: 100, leads: 5, appointments: 1, sales: 0,
      costPerLead: 20, costPerAppointment: 100, costPerSale: 0,
    };
    expect([cheapCpl, appointmentWinner].sort(compareGlobalWinners)[0].creativeFamily).toBe("quality");
  });

  it("feeds global winner families into generation deterministically", () => {
    const variants = [{ familyId: "family-a" }, { familyId: "family-b" }];
    const ranked = applyGlobalWinnerHints(variants, [{
      creativeFamily: "family-b",
      leadType: "final_expense",
      stateCode: "AZ",
      rankBasis: "sale",
    }]);
    expect(ranked.map((variant) => variant.familyId)).toEqual(["family-b", "family-a"]);
  });
});
