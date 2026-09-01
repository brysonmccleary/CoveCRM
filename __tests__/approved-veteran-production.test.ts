import { createMocks } from "node-mocks-http";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getServerSession } from "next-auth/next";
import ApprovedVeteranCreative from "@/components/FacebookAds/ApprovedVeteranCreative";
import handler from "@/pages/api/facebook/generate-ad";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import { loadGlobalGenerationHints } from "@/lib/facebook/globalIntelligence/anonymizedLearning";
import {
  AUG29_APPROVED_VETERAN_EXECUTION_IDS,
  auditApprovedVeteranRuntime,
  buildApprovedVeteranLibrary,
  hasVeteranCustomerVisibleInternalLabel,
  isOwnerSelectableVeteranExecution,
  OWNER_REJECTED_VETERAN_EXECUTION_IDS,
  selectApprovedVeteranConcepts,
  VETERAN_PIXEL_QA_REJECTED_EXECUTION_IDS,
} from "@/lib/facebook/approvedVeteranCreative";
import { VETERAN_AUG29_GOLDEN_VISUALS } from "@/lib/facebook/veteranGoldenVisualAuthority";

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
      customerEligibleCount: 94,
      ownerSelectableCount: 94,
      visualConceptCount: 93,
      eligibleMasterCount: 40,
      failedEligibleGates: [],
    });
    expect(audit.customerEligibleImageShare).toBeCloseTo(61 / 94, 3);
    const library = buildApprovedVeteranLibrary();
    expect(library).toHaveLength(1440);
    expect(library.filter((concept) => concept.customerEligible && concept.backgroundAssetId)).toHaveLength(61);
    expect(library.filter((concept) => concept.customerEligible && !concept.backgroundAssetId)).toHaveLength(33);
    expect(library.filter((concept) => concept.customerEligible).every((concept) => AUG29_APPROVED_VETERAN_EXECUTION_IDS.includes(concept.executionId as any))).toBe(true);
    expect(library.filter((concept) => concept.customerEligible).some(hasVeteranCustomerVisibleInternalLabel)).toBe(false);
  });

  test.each([3, 5])("allocates an owner-approved, diverse %i-ad Veteran batch", (count) => {
    const batch = selectApprovedVeteranConcepts({ seed: `veteran-recovery-${count}`, count });
    expect(batch).toHaveLength(count);
    expect(new Set(batch.map((concept) => concept.visualConceptId)).size).toBe(count);
    expect(new Set(batch.map((concept) => concept.masterId)).size).toBe(count);
    expect(batch.filter((concept) => concept.backgroundAssetId)).toHaveLength(Math.ceil(count * 0.6));
    expect(new Set(batch.filter((concept) => concept.backgroundAssetId).map((concept) => concept.backgroundAssetId)).size).toBe(Math.ceil(count * 0.6));
    expect(new Set(batch.filter((concept) => concept.backgroundAssetId).map((concept) => concept.imageTreatment)).size).toBe(Math.ceil(count * 0.6));
    expect(batch.every((concept) => (
      isOwnerSelectableVeteranExecution(concept)
      && concept.heroAmount !== null
      && !OWNER_REJECTED_VETERAN_EXECUTION_IDS.includes(concept.executionId as any)
      && Object.values(concept.visualQuality).every((value) => value !== "FAIL")
    ))).toBe(true);
  });

  test("permanently excludes every owner-rejected execution and preserves history exclusion", () => {
    const library = buildApprovedVeteranLibrary();
    for (const executionId of [...OWNER_REJECTED_VETERAN_EXECUTION_IDS, ...VETERAN_PIXEL_QA_REJECTED_EXECUTION_IDS]) {
      const rejected = library.find((concept) => concept.executionId === executionId);
      expect(rejected?.customerEligible).toBe(false);
      expect(rejected && isOwnerSelectableVeteranExecution(rejected)).toBe(false);
    }
    const first = selectApprovedVeteranConcepts({ seed: "owner-allocation-one", count: 5 });
    const second = selectApprovedVeteranConcepts({
      seed: "owner-allocation-two",
      count: 5,
      usedVisualConceptIds: new Set(first.map((concept) => concept.visualConceptId)),
    });
    expect(second.some((concept) => first.some((prior) => prior.visualConceptId === concept.visualConceptId))).toBe(false);
  });

  test("VET_M13 preserves the approved amount execution with the high-contrast image treatment", () => {
    const library = buildApprovedVeteranLibrary();
    const css = readFileSync("styles/Veteran24MasterReview.module.css", "utf8");
    expect(css).toContain(".creative.imageMode:not(.paper) .headline,.creative.imageMode:not(.paper) .heroValue{text-shadow:0 2px 8px rgba(0,0,0,.85)}");
    expect(css).toContain(".creative.imageMode:not(.paper) .heroValue{color:var(--accent)}");
    expect(css).not.toContain(".creative.imageMode:not(.paper).layout-13 .heroValue{color:#06192c;text-shadow:none}");
    const concept = library.find((candidate) => candidate.executionId === "VET_M13_EXEC_002");
    expect(concept && isOwnerSelectableVeteranExecution(concept)).toBe(true);
    const markup = renderToStaticMarkup(createElement(ApprovedVeteranCreative, { draft: { approvedVeteranConcept: concept } }));
    expect(markup).toContain("data-hero-kind=\"amount\"");
    expect(markup).toContain("$50,000");
  });

  test("ships the approved background visibility correction without customer-visible review labels", () => {
    const existingCss = readFileSync("styles/Veteran24MasterReview.module.css", "utf8");
    const referenceCss = readFileSync("styles/VeteranReferenceLocked.module.css", "utf8");
    const masterCard = readFileSync("components/FacebookAds/Veteran24MasterReviewCard.tsx", "utf8");
    const wizard = readFileSync("components/FacebookAds/AdWizard.tsx", "utf8");

    for (const css of [existingCss, referenceCss]) {
      expect(css).toContain('[data-background-treatment="full_bleed_dark_overlay"] .overlay{background:linear-gradient(180deg,rgba(2,13,24,.46),rgba(2,14,25,.68))}');
      expect(css).toContain('[data-background-treatment="faint_full_background"] .photo{inset:0;opacity:.5;background-size:cover;filter:saturate(.9) contrast(1)}');
      expect(css).toContain('[data-background-treatment="hero_protected_background"] .photo{inset:0;opacity:1;background-size:cover}');
      expect(css).toContain('[data-background-treatment="patriotic_texture"] .photo{inset:0;opacity:.68;background-size:cover;filter:grayscale(.12) saturate(.95) contrast(1.05)}');
    }
    expect(masterCard).not.toContain('replace("VET_", "MASTER ")');
    expect(wizard).not.toContain("Review the selected test set before launch.");
    expect(wizard).not.toContain("Family: {currentDraft.winningFamilyId}");
    expect(wizard).not.toContain("Style: {currentDraft.vendorStyleTag}");
    expect(wizard).not.toContain("Variant: {currentDraft.uniquenessFingerprint}");
  });

  test("keeps all twelve reference-locked tile labels out of customer-facing pixels", () => {
    const library = buildApprovedVeteranLibrary();

    for (let tile = 1; tile <= 12; tile += 1) {
      const concept = library.find((candidate) => (
        candidate.masterKind === "reference_locked"
        && candidate.referenceTile === tile
        && candidate.customerEligible
      ));
      expect(concept).toBeDefined();

      const markup = renderToStaticMarkup(createElement(ApprovedVeteranCreative, {
        draft: { approvedVeteranConcept: concept },
      }));
      const visibleText = markup.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

      expect(visibleText).not.toContain(`REFERENCE-LOCKED · TILE ${String(tile).padStart(2, "0")}`);
      expect(visibleText).not.toMatch(/REFERENCE-LOCKED|MASTER\s+M\d+|SAFE_MODE|TEST|DEBUG/i);
    }
  });

  test("locks twelve golden visual identities to the August 29 pixel authority", () => {
    const library = buildApprovedVeteranLibrary();
    expect(VETERAN_AUG29_GOLDEN_VISUALS).toHaveLength(12);
    for (const golden of VETERAN_AUG29_GOLDEN_VISUALS) {
      const concept = library.find((candidate) => candidate.executionId === golden.executionId);
      expect(concept).toMatchObject(golden);
      expect(concept?.customerEligible).toBe(true);
      expect(concept && hasVeteranCustomerVisibleInternalLabel(concept)).toBe(false);
    }
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
      && draft.approvedVeteranConcept?.customerEligible === true
      && !OWNER_REJECTED_VETERAN_EXECUTION_IDS.includes(draft.approvedVeteranConcept?.executionId)
      && draft.displayAmount === (draft.approvedVeteranConcept?.heroAmount
        ? `$${Number(draft.approvedVeteranConcept.heroAmount).toLocaleString("en-US")}`
        : "")
      && draft.variationType === draft.approvedVeteranConcept?.visualConceptId
    ))).toBe(true);
  });
});
