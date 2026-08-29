import { createMocks } from "node-mocks-http";
import handler from "@/pages/api/facebook/generate-ad";
import { getServerSession } from "next-auth/next";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import MetaAdMetricsDaily from "@/models/MetaAdMetricsDaily";
import MetaCreativeAsset from "@/models/MetaCreativeAsset";
import MetaProductCapability from "@/models/MetaProductCapability";
import { loadGlobalGenerationHints } from "@/lib/facebook/globalIntelligence/anonymizedLearning";
import { buildCampaignStructure } from "@/lib/facebook/buildCampaignStructure";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/lib/facebook/globalIntelligence/anonymizedLearning", () => ({
  loadGlobalGenerationHints: jest.fn(),
  applyGlobalWinnerHints: <T>(variants: T[]) => variants,
}));
jest.mock("@/models/MetaCreativeUsage", () => ({
  __esModule: true,
  default: { find: jest.fn(), init: jest.fn(), deleteMany: jest.fn(), insertMany: jest.fn() },
}));
jest.mock("@/models/FBLeadCampaign", () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock("@/models/MetaAdMetricsDaily", () => ({ __esModule: true, default: { aggregate: jest.fn() } }));
jest.mock("@/models/MetaCreativeAsset", () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock("@/models/MetaProductCapability", () => ({ __esModule: true, default: { findOne: jest.fn() } }));

type Combination = {
  label: string;
  leadType: "veteran" | "trucker" | "mortgage_protection" | "iul" | "final_expense";
  audienceSegment: "standard" | "veteran" | "trucker" | "spanish";
};

// This mirrors every category/subcategory offered by AdWizard. Spanish Final
// Expense appears twice because it is both the Spanish default and an explicit
// requested launch-readiness case.
const SUPPORTED_GENERATE_COMBINATIONS: Combination[] = [
  { label: "Veteran", leadType: "veteran", audienceSegment: "veteran" },
  { label: "Mortgage", leadType: "mortgage_protection", audienceSegment: "standard" },
  { label: "Trucker", leadType: "trucker", audienceSegment: "trucker" },
  { label: "IUL", leadType: "iul", audienceSegment: "standard" },
  { label: "Spanish Final Expense (default)", leadType: "final_expense", audienceSegment: "spanish" },
  { label: "Final Expense", leadType: "final_expense", audienceSegment: "standard" },
  { label: "Veteran Mortgage", leadType: "mortgage_protection", audienceSegment: "veteran" },
  { label: "Veteran IUL", leadType: "iul", audienceSegment: "veteran" },
  { label: "Veteran Final Expense", leadType: "final_expense", audienceSegment: "veteran" },
  { label: "Trucker Mortgage", leadType: "mortgage_protection", audienceSegment: "trucker" },
  { label: "Trucker IUL", leadType: "iul", audienceSegment: "trucker" },
  { label: "Trucker Final Expense", leadType: "final_expense", audienceSegment: "trucker" },
  { label: "Spanish Mortgage", leadType: "mortgage_protection", audienceSegment: "spanish" },
  { label: "Spanish IUL", leadType: "iul", audienceSegment: "spanish" },
  { label: "Spanish Final Expense", leadType: "final_expense", audienceSegment: "spanish" },
];

describe("Generate Ad campaign matrix regression", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: "agent@example.com" } });
    (loadGlobalGenerationHints as jest.Mock).mockResolvedValue([]);
    (MetaCreativeUsage.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
        }),
      }),
    });
    (MetaCreativeUsage.init as jest.Mock).mockResolvedValue(undefined);
    (MetaCreativeUsage.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 0 });
    (MetaCreativeUsage.insertMany as jest.Mock).mockResolvedValue([]);
    (FBLeadCampaign.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) }),
    });
    (MetaAdMetricsDaily.aggregate as jest.Mock).mockResolvedValue([]);
    (MetaCreativeAsset.find as jest.Mock).mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      }),
    });
    (MetaProductCapability.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
  });

  test.each(SUPPORTED_GENERATE_COMBINATIONS)(
    "$label reaches a complete Step 5 draft without publishing Meta objects",
    async ({ label, leadType, audienceSegment }) => {
      const { req, res } = createMocks({
        method: "POST",
        body: {
          mode: "wizard",
          clientCreativeVersion: 5,
          leadType,
          audienceSegment,
          campaignTypeLabel: label,
          licensedStates: ["AZ"],
          location: "Arizona",
          dailyBudget: 10,
          variantCount: 3,
          regenerationAttempt: 0,
          generationNonce: `regression-${label.replace(/\s+/g, "-").toLowerCase()}`,
        },
      });

      await handler(req as any, res as any);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res._getData());
      expect(body.ok).toBe(true);
      expect(body.drafts).toHaveLength(3);
      expect(body.drafts).toEqual(expect.arrayContaining([
        expect.objectContaining({ leadType, audienceSegment }),
      ]));
      expect(body.draft).toEqual(expect.objectContaining({
        leadType,
        audienceSegment,
        winningFamilyId: expect.any(String),
        landingPageConfig: expect.objectContaining({ headline: expect.any(String) }),
      }));

      // Generate writes only expiring Cove draft reservations. Meta object
      // creation remains exclusively behind Review & Launch.
      expect(MetaCreativeUsage.find).toHaveBeenCalledTimes(1);
      expect(MetaCreativeUsage.insertMany).toHaveBeenCalledTimes(1);
    }
  );

  test("the exact production veteran payload no longer throws the empty-family regression", async () => {
    const { req, res } = createMocks({
      method: "POST",
      body: {
        mode: "wizard",
        clientCreativeVersion: 5,
        leadType: "veteran",
        audienceSegment: "veteran",
        licensedStates: ["AZ"],
        location: "Arizona",
        dailyBudget: 10,
        variantCount: 1,
        generationNonce: "exact-production-regression",
      },
    });

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res._getData()).draft).toEqual(expect.objectContaining({
      leadType: "veteran",
      audienceSegment: "veteran",
      winningFamilyId: expect.stringMatching(/^VET_/),
    }));
  });

  test("client-supplied carrier facts cannot activate product claims without an approved server record", async () => {
    const { req, res } = createMocks({
      method: "POST",
      body: {
        mode: "wizard", clientCreativeVersion: 5, leadType: "final_expense", audienceSegment: "standard",
        location: "AZ", dailyBudget: 10, variantCount: 1, generationNonce: "untrusted-capability",
        productCapability: {
          capabilityId: "forged-client-record", carrier: "Invented Carrier", product: "Invented Product",
          faceAmountMax: 1_000_000, medicalExamRequirement: "not_required", active: true,
        },
      },
    });

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.capabilitySource).toBe("safe_general");
    expect(body.capabilityNotice).toMatch(/not found as a current approved server record/i);
    expect(body.draft.displayAmount).toBeUndefined();
    expect(body.draft.capabilityBenefits).toEqual([]);
  });

  test.each([
    ["Veteran", "veteran", "veteran", [], []],
    ["Trucker", "trucker", "trucker", [["Semi-trailer truck"]], []],
    ["IUL", "iul", "standard", [["Life insurance"], ["Investment strategy", "Investment management"]], []],
    ["Final Expense", "final_expense", "standard", [["Life insurance"]], []],
    ["Spanish Final Expense", "final_expense", "spanish", [["Life insurance"]], [1002]],
  ] as const)(
    "%s keeps its exact targeting profile after Generate",
    (_label, leadType, audienceSegment, expectedInterestGroups, expectedLocales) => {
      const structure = buildCampaignStructure({
        campaignName: `${_label} Regression`,
        leadType,
        audienceSegment,
        licensedStates: ["AZ"],
        dailyBudgetCents: 1000,
        campaignType: "hosted_funnel",
        creatives: [{ primaryText: "Validated generated copy", headline: "Validated generated headline" }],
      });

      expect(structure.targetingProfile.interestGroups.map((group) => group.map((interest) => interest.name)))
        .toEqual(expectedInterestGroups);
      expect(structure.targetingProfile.locales).toEqual(expectedLocales);
      expect(structure.adSet.optimization_goal).toBe("OFFSITE_CONVERSIONS");
      expect(structure.campaign.special_ad_categories).toEqual(["FINANCIAL_PRODUCTS_SERVICES"]);
      expect(structure.campaign.status).toBe("PAUSED");
      expect(structure.adSet.status).toBe("PAUSED");
    }
  );
});
