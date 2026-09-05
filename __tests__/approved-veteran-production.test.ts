import { createMocks } from "node-mocks-http";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getServerSession } from "next-auth/next";
import ApprovedVeteranCreative from "@/components/FacebookAds/ApprovedVeteranCreative";
import { ProductionFeedCreative } from "@/components/FacebookAds/AdPreviewCard";
import { isDecodedCreativePhoto, measurePhotoContribution } from "@/components/FacebookAds/AdWizard";
import handler from "@/pages/api/facebook/generate-ad";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import { loadGlobalGenerationHints } from "@/lib/facebook/globalIntelligence/anonymizedLearning";
import {
  AUG29_APPROVED_VETERAN_EXECUTION_IDS,
  auditApprovedVeteranRuntime,
  buildApprovedVeteranLibrary,
  hasVeteranCustomerVisibleInternalLabel,
  isOwnerSelectableVeteranExecution,
  NEW_OWNER_REJECTED_VETERAN_EXECUTION_IDS,
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

function makeCapturePair(alpha: number, paintedCells = 16) {
  const width = 32;
  const height = 32;
  const normal = new Uint8ClampedArray(width * height * 4);
  const hidden = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const base = 28 + ((x * 3 + y * 5) % 24);
      const cell = Math.floor(y / 8) * 4 + Math.floor(x / 8);
      const photo = [60 + ((x * 11) % 150), 45 + ((y * 13) % 155), 35 + (((x + y) * 7) % 165)];
      for (let channel = 0; channel < 3; channel += 1) {
        hidden[offset + channel] = base;
        normal[offset + channel] = cell < paintedCells
          ? Math.round(base * (1 - alpha) + photo[channel] * alpha)
          : base;
      }
      hidden[offset + 3] = 255;
      normal[offset + 3] = 255;
    }
  }
  return { normal, hidden, width, height };
}

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
      masterCount: 60,
      existingApprovedCount: 24,
      referenceLockedCount: 12,
      literalReplicaCount: 12,
      imageCount: 40,
      backgroundTreatmentCount: 8,
      customerEligibleCount: 315,
      ownerSelectableCount: 315,
      visualConceptCount: 314,
      eligibleMasterCount: 49,
      failedEligibleGates: [],
    });
    expect(audit.customerEligibleImageShare).toBeCloseTo(45 / 315, 3);
    const library = buildApprovedVeteranLibrary();
    expect(library).toHaveLength(1680);
    expect(library.filter((concept) => concept.customerEligible && concept.backgroundAssetId)).toHaveLength(45);
    expect(library.filter((concept) => concept.customerEligible && !concept.backgroundAssetId)).toHaveLength(270);
    expect(library.filter((concept) => concept.masterKind === "market_direct")).toHaveLength(240);
    expect(library.filter((concept) => concept.masterKind === "market_direct" && concept.customerEligible)).toHaveLength(240);
    expect(library.filter((concept) => concept.customerEligible).every((concept) => (
      concept.masterKind === "market_direct"
      || AUG29_APPROVED_VETERAN_EXECUTION_IDS.includes(concept.executionId as any)
    ))).toBe(true);
    expect(library.filter((concept) => concept.customerEligible).some(hasVeteranCustomerVisibleInternalLabel)).toBe(false);
  });

  test("restores one marked real photo node for every image-backed production execution", () => {
    const imageBacked = buildApprovedVeteranLibrary().filter((concept) => concept.customerEligible && concept.backgroundAssetId);
    expect(imageBacked).toHaveLength(45);

    for (const concept of imageBacked) {
      const markup = renderToStaticMarkup(createElement(ApprovedVeteranCreative, {
        draft: { approvedVeteranConcept: concept },
      }));
      const markedPhotos = markup.match(/<img\b[^>]*data-creative-photo="true"[^>]*>/g) || [];

      expect(markedPhotos).toHaveLength(1);
      expect(markedPhotos[0]).toContain(`data-creative-photo-src="${concept.backgroundUrl}"`);
      expect(markedPhotos[0]).toContain(`src="${concept.backgroundUrl}"`);
      expect(markup).toMatch(/data-veteran-master-preview="true"|data-reference-locked-preview="true"|data-reference-replica="07"/);
      expect(markup).not.toContain(`background-image:url(&quot;${concept.backgroundUrl}&quot;)`);
    }
  });

  test("uses causal paired captures and restores the marked photo state", () => {
    const wizard = readFileSync("components/FacebookAds/AdWizard.tsx", "utf8");
    expect(wizard).toContain("img[data-creative-photo=\"true\"]");
    expect(wizard).toContain("await inlineCreativeImages(node)");
    expect(wizard).toContain("const photoExpectation = getPhotoExpectation(node)");
    expect(wizard).toContain("captureWithMarkedPhotoHidden");
    expect(wizard).toContain('photo.style.setProperty("visibility", "hidden", "important")');
    expect(wizard).toContain('photo.setAttribute("style", originalStyle)');
    expect(wizard).toContain("finally {");
    expect(wizard).not.toContain("photoCorrelation >= 0.72 && photoMeanError <= 60");
    expect(wizard).toContain("for (let attempt = 0; attempt < 3; attempt += 1)");
  });

  test.each([
    ["faint background", 0.12, 16],
    ["full dark overlay", 0.24, 16],
    ["hero-protected background", 0.2, 8],
    ["patriotic texture", 0.16, 16],
    ["split background", 0.3, 8],
    ["top environment fade", 0.14, 12],
    ["left image gradient", 0.18, 8],
    ["right image gradient", 0.18, 8],
  ])("detects material photo contribution under %s", (_label, alpha, paintedCells) => {
    const pair = makeCapturePair(alpha as number, paintedCells as number);
    const result = measurePhotoContribution(
      pair.normal,
      pair.hidden,
      pair.width,
      pair.height,
      { left: 0, top: 0, width: 1, height: 1 },
    );
    expect(result.detected).toBe(true);
    expect(result.changedPixelRatio).toBeGreaterThan(0);
    expect(result.changedCellRatio).toBeGreaterThan(0);
  });

  test("rejects CSS-only, missing/non-painted, and invalid-bounds paired captures", () => {
    const pair = makeCapturePair(0.2);
    const identical = measurePhotoContribution(
      pair.hidden,
      pair.hidden,
      pair.width,
      pair.height,
      { left: 0, top: 0, width: 1, height: 1 },
    );
    expect(identical).toMatchObject({
      detected: false,
      meanColorDelta: 0,
      changedPixelRatio: 0,
      changedCellRatio: 0,
    });
    expect(measurePhotoContribution(
      pair.normal,
      pair.hidden,
      pair.width,
      pair.height,
      { left: 0, top: 0, width: 0, height: 1 },
    ).detected).toBe(false);
  });

  test("rejects broken or unloaded marked photos before capture", () => {
    const rect = { left: 0, top: 0, width: 1, height: 1 };
    expect(isDecodedCreativePhoto(rect, "data:image/png;base64,valid", true, 100, 100)).toBe(true);
    expect(isDecodedCreativePhoto(rect, "data:image/png;base64,broken", false, 0, 0)).toBe(false);
    expect(isDecodedCreativePhoto(rect, "https://example.com/not-inlined.png", true, 100, 100)).toBe(false);
    expect(isDecodedCreativePhoto({ ...rect, width: 0 }, "data:image/png;base64,valid", true, 100, 100)).toBe(false);
    expect(isDecodedCreativePhoto(null, "data:image/png;base64,valid", true, 100, 100)).toBe(false);
  });

  test.each([3, 5])("allocates an owner-approved, market-direct %i-ad Veteran batch", (count) => {
    const batch = selectApprovedVeteranConcepts({ seed: `veteran-recovery-${count}`, count });
    expect(batch).toHaveLength(count);
    expect(new Set(batch.map((concept) => concept.visualConceptId)).size).toBe(count);
    expect(new Set(batch.map((concept) => concept.masterId)).size).toBe(count);
    expect(batch.every((concept) => concept.backgroundAssetId === null)).toBe(true);
    expect(batch.every((concept) => (
      isOwnerSelectableVeteranExecution(concept)
      && concept.masterKind === "market_direct"
      && [40000, 50000, 100000].includes(Number(concept.heroAmount))
      && concept.claimAuthority === "OWNER_CONFIRMED"
      && !OWNER_REJECTED_VETERAN_EXECUTION_IDS.includes(concept.executionId as any)
      && Object.values(concept.visualQuality).every((value) => value !== "FAIL")
    ))).toBe(true);
    expect(new Set(batch.map((concept) => concept.heroAmount))).toEqual(new Set([40000, 50000, 100000]));
  });

  test("distributes $40k, $50k, and $100k across every market-direct layout", () => {
    const market = buildApprovedVeteranLibrary().filter((concept) => concept.masterKind === "market_direct");
    expect(new Set(market.map((concept) => concept.heroAmount))).toEqual(new Set([40000, 50000, 100000]));
    for (const masterId of Array.from({ length: 12 }, (_, index) => `VET_MARKET_${String(index + 1).padStart(2, "0")}`)) {
      const amounts = new Set(market.filter((concept) => concept.masterId === masterId).map((concept) => concept.heroAmount));
      expect(amounts).toEqual(new Set([40000, 50000, 100000]));
    }
  });

  test("renders all twelve fixed reference layouts with no generated-image dependency", () => {
    const market = buildApprovedVeteranLibrary().filter((concept) => concept.masterKind === "market_direct");
    for (const masterId of Array.from({ length: 12 }, (_, index) => `VET_MARKET_${String(index + 1).padStart(2, "0")}`)) {
      const concept = market.find((candidate) => candidate.masterId === masterId && candidate.customerEligible);
      expect(concept).toBeDefined();
      const markup = renderToStaticMarkup(createElement(ApprovedVeteranCreative, {
        draft: { approvedVeteranConcept: concept },
      }));
      const tile = Number(masterId.slice(-2));
      expect(markup).toContain(`data-market-direct-layout="reference-${String(tile).padStart(2, "0")}"`);
      expect(markup).toContain(`data-reference-replica="${String(tile).padStart(2, "0")}"`);
      expect(markup).toContain('data-creative-aspect="4:5"');
      if (tile !== 3) expect(markup).toContain(concept?.heroContent[0]);
      else expect(markup).toContain("$8,000");
      expect(markup).not.toContain("<img");
      expect(concept?.backgroundUrl).toBeNull();
    }
  });

  test("renders approved Veteran production captures at native size without the legacy scale wrapper", () => {
    const concept = selectApprovedVeteranConcepts({ seed: "native-production-capture", count: 1 })[0];
    const markup = renderToStaticMarkup(createElement(ProductionFeedCreative, {
      draft: { leadType: "veteran", approvedVeteranConcept: concept },
    }));
    expect(markup).toContain('data-creative-root="true"');
    expect(markup).toContain('data-approved-veteran-runtime="true"');
    expect(markup).not.toContain('data-creative-design-canvas="true"');

    const wizardSource = readFileSync("components/FacebookAds/AdWizard.tsx", "utf8");
    expect(wizardSource).toContain("left: -10000");
    expect(wizardSource).toContain("zIndex: 0");
  });

  test("keeps each reference geometry fixed while exposing 20 distinct CSS color treatments", () => {
    const market = buildApprovedVeteranLibrary().filter((concept) => concept.masterKind === "market_direct");
    for (const masterId of Array.from({ length: 12 }, (_, index) => `VET_MARKET_${String(index + 1).padStart(2, "0")}`)) {
      const treatments = market
        .filter((concept) => concept.masterId === masterId)
        .map((concept) => renderToStaticMarkup(createElement(ApprovedVeteranCreative, {
          draft: { approvedVeteranConcept: concept },
        })))
        .map((markup) => markup.match(/filter:([^;"]+)/)?.[1]);
      expect(new Set(treatments).size).toBe(20);
      expect(treatments.every((treatment) => !String(treatment).includes("hue-rotate"))).toBe(true);
    }
  });

  test("permanently excludes every owner-rejected execution and preserves history exclusion", () => {
    expect(NEW_OWNER_REJECTED_VETERAN_EXECUTION_IDS).toEqual([
      "VET_M18_EXEC_001",
      "VET_M18_EXEC_013",
      "VET_REF_08_EXEC_007",
      "VET_REF_08_EXEC_025",
      "VET_M01_EXEC_002",
      "VET_M01_EXEC_013",
      "VET_M02_EXEC_015",
      "VET_M05_EXEC_029",
      "VET_M13_EXEC_002",
      "VET_M14_EXEC_010",
      "VET_M21_EXEC_025",
      "VET_REF_03_EXEC_025",
      "VET_REF_05_EXEC_009",
      "VET_REF_11_EXEC_015",
      "VET_REF_11_EXEC_023",
      "VET_REF_12_EXEC_010",
      "VET_REF_12_EXEC_026",
      "VET_REPLICA_09_EXEC_010",
      "VET_REPLICA_10_EXEC_025",
    ]);
    expect(new Set(NEW_OWNER_REJECTED_VETERAN_EXECUTION_IDS)).toHaveProperty("size", 19);
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

  test("VET_M13 preserves its readability correction while the proven collision execution is non-selectable", () => {
    const library = buildApprovedVeteranLibrary();
    const css = readFileSync("styles/Veteran24MasterReview.module.css", "utf8");
    expect(css).toContain(".creative.imageMode:not(.paper) .headline,.creative.imageMode:not(.paper) .heroValue{text-shadow:0 2px 8px rgba(0,0,0,.85)}");
    expect(css).toContain(".creative.imageMode:not(.paper) .heroValue{color:var(--accent)}");
    expect(css).not.toContain(".creative.imageMode:not(.paper).layout-13 .heroValue{color:#06192c;text-shadow:none}");
    const concept = library.find((candidate) => candidate.executionId === "VET_M13_EXEC_002");
    expect(concept).toMatchObject({
      approvedGeometryId: "VET_EXISTING_LAYOUT_13",
      heroAmount: 50_000,
      imageTreatment: "hero_protected_background",
      customerEligible: false,
    });
    expect(concept && isOwnerSelectableVeteranExecution(concept)).toBe(false);
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
        && AUG29_APPROVED_VETERAN_EXECUTION_IDS.includes(candidate.executionId as any)
      ));
      expect(concept).toBeDefined();

      const markup = renderToStaticMarkup(createElement(ApprovedVeteranCreative, {
        draft: { approvedVeteranConcept: { ...concept, customerEligible: true } },
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
      expect(concept?.customerEligible).toBe(!NEW_OWNER_REJECTED_VETERAN_EXECUTION_IDS.includes(golden.executionId as any));
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
    const winningFamilies = new Set<string>(body.drafts.map((draft: any) => draft.winningFamilyId));
    expect(winningFamilies.size).toBe(variantCount);
    expect([...winningFamilies].every((id) => /^vet_approved_vet_market_\d{2}$/.test(id))).toBe(true);
    expect(body.drafts.filter((draft: any) => draft.approvedVeteranConcept.backgroundAssetId)).toHaveLength(0);
    expect(body.drafts.every((draft: any) => (
      draft.leadType === "veteran"
      && draft.audienceSegment === "veteran"
      && draft.generatedBy === "approved_veteran_library"
      && draft.approvedVeteranConcept?.masterKind === "market_direct"
      && draft.approvedVeteranConcept?.claimAuthority === "OWNER_CONFIRMED"
      && draft.cta === "GET_QUOTE"
      && draft.primaryText.includes(draft.displayAmount)
      && draft.approvedVeteranConcept?.customerEligible === true
      && !OWNER_REJECTED_VETERAN_EXECUTION_IDS.includes(draft.approvedVeteranConcept?.executionId)
      && draft.displayAmount === (draft.approvedVeteranConcept?.heroAmount
        ? `$${Number(draft.approvedVeteranConcept.heroAmount).toLocaleString("en-US")}`
        : "")
      && draft.variationType === draft.approvedVeteranConcept?.visualConceptId
    ))).toBe(true);
    expect(new Set(body.drafts.map((draft: any) => draft.displayAmount))).toEqual(new Set(["$40,000", "$50,000", "$100,000"]));
  });
});
