import { createMocks } from "node-mocks-http";
import { getServerSession } from "next-auth/next";
import handler from "@/pages/api/facebook/generate-ad";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import { loadGlobalGenerationHints } from "@/lib/facebook/globalIntelligence/anonymizedLearning";
import {
  auditApprovedVeteranRuntime,
  buildApprovedVeteranLibrary,
  selectApprovedVeteranConcepts,
} from "@/lib/facebook/approvedVeteranCreative";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/lib/facebook/globalIntelligence/anonymizedLearning", () => ({
  loadGlobalGenerationHints: jest.fn(),
  applyGlobalWinnerHints: <T>(variants: T[]) => variants,
}));
jest.mock("@/models/MetaCreativeUsage", () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

describe("approved Veteran production recovery", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: "agent@example.com" } });
    (loadGlobalGenerationHints as jest.Mock).mockResolvedValue([]);
    (MetaCreativeUsage.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });
  });

  test("recovers the exact approved inventory and customer-quality direction", () => {
    const audit = auditApprovedVeteranRuntime();
    expect(audit).toMatchObject({
      masterCount: 48,
      existingApprovedCount: 24,
      referenceLockedCount: 12,
      literalReplicaCount: 12,
      imageCount: 40,
      backgroundTreatmentCount: 8,
      customerEligibleCount: 1005,
      eligibleMasterCount: 48,
      failedEligibleGates: [],
    });
    expect(audit.customerEligibleImageShare).toBeCloseTo(0.604, 3);
    expect(buildApprovedVeteranLibrary()).toHaveLength(1440);
  });

  test.each([3, 5])("allocates a safe, diverse %i-ad Veteran batch", (count) => {
    const batch = selectApprovedVeteranConcepts({ seed: `veteran-recovery-${count}`, count });
    expect(batch).toHaveLength(count);
    expect(new Set(batch.map((concept) => concept.visualConceptId)).size).toBe(count);
    expect(new Set(batch.map((concept) => concept.masterId)).size).toBe(count);
    expect(batch.filter((concept) => concept.backgroundAssetId)).toHaveLength(Math.ceil(count * 0.6));
    expect(batch.every((concept) => (
      concept.customerEligible
      && concept.claimMode === "SAFE_MODE"
      && concept.claimAuthority === "SAFE_COPY"
      && concept.benefitPackageId === "BENEFIT_1"
      && Object.values(concept.visualQuality).every((value) => value !== "FAIL")
    ))).toBe(true);
  });

  test.each([3, 5])("production handler routes canonical Veteran input to %i recovered drafts", async (variantCount) => {
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
        variantCount,
        regenerationAttempt: 0,
        generationNonce: `approved-veteran-${variantCount}`,
      },
    });

    await handler(req as any, res as any);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.drafts).toHaveLength(variantCount);
    expect(new Set(body.drafts.map((draft: any) => draft.variationType)).size).toBe(variantCount);
    expect(new Set(body.drafts.map((draft: any) => draft.winningFamilyId)).size).toBe(variantCount);
    expect(body.drafts.filter((draft: any) => draft.approvedVeteranConcept.backgroundAssetId)).toHaveLength(Math.ceil(variantCount * 0.6));
    expect(body.drafts.every((draft: any) => (
      draft.leadType === "veteran"
      && draft.audienceSegment === "veteran"
      && draft.generatedBy === "approved_veteran_library"
      && draft.approvedVeteranConcept?.claimMode === "SAFE_MODE"
      && draft.approvedVeteranConcept?.customerEligible === true
      && draft.displayAmount === ""
      && draft.variationType === draft.approvedVeteranConcept?.visualConceptId
    ))).toBe(true);
  });
});
