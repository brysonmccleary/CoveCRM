import { createMocks } from "node-mocks-http";
import { getServerSession } from "next-auth/next";
import handler from "@/pages/api/facebook/generate-ad";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import { loadGlobalGenerationHints } from "@/lib/facebook/globalIntelligence/anonymizedLearning";
import {
  REGULAR_TRUCKER_MASTERS,
  TRUCKER_CUSTOMER_ELIGIBLE_IMAGE_NUMBERS,
  TRUCKER_IUL_MASTERS,
  buildApprovedTruckerLibrary,
  getApprovedTruckerLane,
  selectApprovedTruckerConcepts,
} from "@/lib/facebook/approvedTruckerCreative";
import { getFunnelTemplate } from "@/lib/facebook/funnels/funnelTemplates";

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

describe("approved Trucker production library", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getServerSession as jest.Mock).mockResolvedValue({ user: { email: "agent@example.com" } });
    (loadGlobalGenerationHints as jest.Mock).mockResolvedValue([]);
    (MetaCreativeUsage.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });
  });

  test("preserves the immutable approved inventories and eligibility exclusions", () => {
    const regular = buildApprovedTruckerLibrary("regular_trucker");
    const iul = buildApprovedTruckerLibrary("trucker_iul");

    expect(REGULAR_TRUCKER_MASTERS).toHaveLength(24);
    expect(TRUCKER_IUL_MASTERS).toHaveLength(20);
    expect(regular).toHaveLength(3708);
    expect(iul).toHaveLength(3096);
    expect(TRUCKER_CUSTOMER_ELIGIBLE_IMAGE_NUMBERS).toHaveLength(36);
    expect(TRUCKER_CUSTOMER_ELIGIBLE_IMAGE_NUMBERS).not.toEqual(expect.arrayContaining([25, 26, 36, 38]));
    expect([...regular, ...iul].every((concept) => (
      concept.truckVisible
      && concept.customerEligible
      && Boolean(concept.imageNumber)
      && Boolean(concept.treatment)
    ))).toBe(true);
  });

  test.each([
    ["regular_trucker", 3],
    ["regular_trucker", 5],
    ["trucker_iul", 3],
    ["trucker_iul", 5],
  ] as const)("%s allocates a safe unique %i-ad batch", (lane, count) => {
    const batch = selectApprovedTruckerConcepts({ lane, count, seed: `qa-${lane}-${count}` });
    expect(batch).toHaveLength(count);
    expect(new Set(batch.map((concept) => concept.visualConceptId)).size).toBe(count);
    expect(new Set(batch.map((concept) => concept.master.id)).size).toBeGreaterThanOrEqual(count === 5 ? 4 : 3);
    expect(batch.every((concept) => concept.lane === lane && concept.truckVisible && concept.customerEligible)).toBe(true);
    expect(batch.some((concept) => concept.visualTreatment === "photo")).toBe(true);
    if (count > 1) expect(batch.some((concept) => concept.visualTreatment === "graphic")).toBe(true);
  });

  test("keeps product routing and claims isolated", () => {
    const forbiddenRegular = /\b(IUL|indexed universal life|personal pension|tax[- ]free|cash value|living benefits?|\$1[, ]?000[, ]?000|guaranteed|market index)\b/i;
    const unsupported = /\b(tax[- ]free income|tax[- ]free retirement|guaranteed returns?|guaranteed gains?|guaranteed cash value|living benefits?|no medical exam|guaranteed acceptance|\$1[, ]?000[, ]?000|approved in|approval in)\b/i;

    expect(getApprovedTruckerLane("trucker", "trucker")).toBe("regular_trucker");
    expect(getApprovedTruckerLane("iul", "trucker")).toBe("trucker_iul");
    expect(getApprovedTruckerLane("iul", "standard")).toBeNull();
    expect(getApprovedTruckerLane("mortgage_protection", "trucker")).toBeNull();

    expect(REGULAR_TRUCKER_MASTERS.some((master) => forbiddenRegular.test(
      [master.headline, master.subhead, ...master.bullets, master.cta, ...master.qualifier].join(" ")
    ))).toBe(false);
    expect(TRUCKER_IUL_MASTERS.every((master) => /\bIUL\b|indexed universal life/i.test(
      [master.headline, master.subhead, ...master.bullets, master.cta, ...master.qualifier].join(" ")
    ))).toBe(true);
    expect(TRUCKER_IUL_MASTERS.some((master) => unsupported.test(
      [master.headline, master.subhead, ...master.bullets, master.cta, ...master.qualifier].join(" ")
    ))).toBe(false);
  });

  test("uses the complete existing Regular Trucker and Trucker IUL funnels", () => {
    expect(getFunnelTemplate("trucker", "trucker").displayName).toBe("Trucker Insurance Review");
    expect(getFunnelTemplate("iul", "trucker").displayName).toBe("Trucker IUL Review");
  });

  test.each([
    ["trucker", "trucker", "regular_trucker", 3],
    ["trucker", "trucker", "regular_trucker", 5],
    ["iul", "trucker", "trucker_iul", 3],
    ["iul", "trucker", "trucker_iul", 5],
  ] as const)(
    "production handler routes %s/%s to %s with %i drafts",
    async (leadType, audienceSegment, lane, variantCount) => {
      const { req, res } = createMocks({
        method: "POST",
        body: {
          mode: "wizard",
          clientCreativeVersion: 5,
          leadType,
          audienceSegment,
          licensedStates: ["AZ"],
          location: "Arizona",
          dailyBudget: 10,
          variantCount,
          regenerationAttempt: 0,
          generationNonce: `approved-${lane}-${variantCount}`,
        },
      });

      await handler(req as any, res as any);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res._getData());
      expect(body.drafts).toHaveLength(variantCount);
      expect(body.drafts.every((draft: any) => (
        draft.leadType === leadType
        && draft.audienceSegment === audienceSegment
        && draft.approvedTruckerConcept?.lane === lane
        && draft.approvedTruckerConcept?.truckVisible === true
        && draft.variationType === draft.approvedTruckerConcept?.visualConceptId
      ))).toBe(true);
      expect(new Set(body.drafts.map((draft: any) => draft.variationType)).size).toBe(variantCount);
      expect(new Set(body.drafts.map((draft: any) => draft.winningFamilyId)).size)
        .toBeGreaterThanOrEqual(variantCount === 5 ? 4 : 3);
    }
  );
});
