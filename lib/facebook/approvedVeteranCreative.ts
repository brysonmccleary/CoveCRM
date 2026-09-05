import { buildVeteran24MasterReview } from "@/lib/facebook/veteran24MasterReview";
import { buildVeteranReferenceLocked12 } from "@/lib/facebook/veteranReferenceLocked12";
import {
  chooseVeteranBackgroundTreatment,
  compatibleVeteranBackgroundTreatments,
  focalPositionForTreatment,
  treatmentSupportsAsset,
  VETERAN_BACKGROUND_TREATMENTS,
  type VeteranBackgroundTreatment,
} from "@/lib/facebook/veteranBackgroundTreatments";

export type ApprovedVeteranMasterKind = "existing" | "reference_locked" | "literal_replica" | "market_direct";
export type ApprovedVeteranCompositionMode = "graphic" | "image_backed" | "hybrid" | "typographic";
export type ApprovedVeteranQualityGateResult = "PASS" | "FAIL";

export type ApprovedVeteranVisualQuality = {
  dominantColorCount: number;
  accentColorCount: number;
  panelCount: number;
  copyWordCount: number;
  focalPointCount: number;
  minTextSizeEstimate: number;
  heroContrast: ApprovedVeteranQualityGateResult;
  heroProminence: ApprovedVeteranQualityGateResult;
  headlineContrast: ApprovedVeteranQualityGateResult;
  benefitReadability: ApprovedVeteranQualityGateResult;
  ageReadability: ApprovedVeteranQualityGateResult;
  imageCopyCollision: ApprovedVeteranQualityGateResult;
  paletteDiscipline: ApprovedVeteranQualityGateResult;
  simplicity: ApprovedVeteranQualityGateResult;
  imageOverlayReadability: ApprovedVeteranQualityGateResult;
  overflow: ApprovedVeteranQualityGateResult;
  clipping: ApprovedVeteranQualityGateResult;
  brokenBackground: ApprovedVeteranQualityGateResult;
  wrongCrop: ApprovedVeteranQualityGateResult;
  subjectCoveringCopy: ApprovedVeteranQualityGateResult;
  overlayFailure: ApprovedVeteranQualityGateResult;
};

export type ApprovedVeteranConcept = {
  lane: "veteran";
  language: "en";
  masterId: string;
  sourceMasterId: string;
  masterKind: ApprovedVeteranMasterKind;
  referenceTile: number | null;
  executionId: string;
  variantId: string;
  backgroundAssetId: string | null;
  backgroundUrl: string | null;
  imageTreatment: string;
  imageFocalPosition: string;
  compositionMode: ApprovedVeteranCompositionMode;
  palette: string;
  headlineHookId: string;
  headline: string[];
  heroTreatment: string;
  heroAmount: 40000 | 50000 | 100000 | null;
  heroContent: string[];
  claimMode: "TEST_CAPABILITY" | "SAFE_MODE" | "PRODUCTION_APPROVED";
  claimAuthority: "TEST_FIXTURE_ONLY" | "SAFE_COPY" | "OWNER_CONFIRMED";
  capabilityFixtureId: string | null;
  benefitPackageId: string;
  benefits: string[];
  ageTreatmentId: string;
  ageOptions: string[];
  ctaId: string;
  cta: string;
  borderTreatment: string;
  panelTreatment: string;
  renderFingerprint: string;
  nearFingerprint: string;
  approvedGeometryId: string;
  visualConceptId: string;
  selectionStyleCategory: "image_backed_direct_response" | "pure_graphic";
  customerEligible: boolean;
  eligibilityReasons: string[];
  visualQuality: ApprovedVeteranVisualQuality;
  originalIdentityRetained: true;
};

type VeteranSeed = {
  masterId: string;
  sourceMasterId: string;
  kind: ApprovedVeteranMasterKind;
  tile: number | null;
  backgroundTreatments: VeteranBackgroundTreatment[];
  approvedGeometryId: string;
  baseHeadline: string[];
};

const VET_PALETTES = ["navy_gold", "paper_red", "black_gold", "navy_white", "patriotic_split"];
const VET_CTA = ["SEE YOUR OPTIONS", "CHECK ELIGIBILITY", "SELECT YOUR AGE", "REVIEW PRIVATE OPTIONS"];
const VET_AGES = ["20–50", "51–60", "61–70", "71–80", "81+"];
const VET_HOOKS = [["PROTECT YOUR FAMILY"], ["COVERAGE FOR VETERANS"]];
const SAFE_HEROES = [["CHECK YOUR", "ELIGIBILITY"], ["SEE YOUR", "COVERAGE OPTIONS"], ["PROTECT YOUR", "FAMILY"], ["REVIEW YOUR", "OPTIONS"]];
const VET_BENEFITS = [
  ["PRIVATE REVIEW", "FAMILY PROTECTION", "OPTIONS BY AGE"],
  ["LIFETIME PROTECTION", "LEGACY PLANNING", "PRIVATE OPTIONS"],
  ["TEST: NO MEDICAL EXAM", "TEST: CASH VALUE", "TEST: NO 2-YEAR WAIT"],
];
const MARKET_DIRECT_PALETTES = [
  "midnight_gold", "navy_gold", "royal_gold", "slate_gold", "black_gold", "ink_amber",
  "navy_red", "royal_red", "cream_navy", "cream_red", "white_navy", "silver_navy",
];
const COMPLEX_GEOMETRY_SUFFIXES = new Set(["14", "16", "18", "19", "21", "22"]);
const EXISTING_PAPER_WEAK = new Set([2, 5, 9, 11, 16, 19, 20, 21]);
const EXISTING_PATRIOTIC_WEAK = new Set([1, 7, 9, 14, 16, 20, 21, 24]);
const EXISTING_NON_PAPER_WEAK = new Set([4, 8, 12, 15]);
const REFERENCE_NON_PAPER_WEAK = new Set([2, 4, 6, 8, 10, 12]);
const REFERENCE_PAPER_WEAK = new Set([5, 11]);
const CLEAN_LIGHT_MASTERS = new Set([
  "VET_M02", "VET_M04", "VET_M06", "VET_M10", "VET_M12", "VET_M17",
  "VET_REF_02", "VET_REF_04", "VET_REF_06", "VET_REF_10", "VET_REF_12",
  "VET_REPLICA_02", "VET_REPLICA_04", "VET_REPLICA_06", "VET_REPLICA_08", "VET_REPLICA_10", "VET_REPLICA_12",
]);
const HISTORICAL_OWNER_REJECTED_VETERAN_EXECUTION_IDS = [
  "VET_M01_EXEC_029",
  "VET_M18_EXEC_023",
  "VET_M18_EXEC_024",
] as const;
export const NEW_OWNER_REJECTED_VETERAN_EXECUTION_IDS = [
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
] as const;
export const OWNER_REJECTED_VETERAN_EXECUTION_IDS = [
  ...HISTORICAL_OWNER_REJECTED_VETERAN_EXECUTION_IDS,
  ...NEW_OWNER_REJECTED_VETERAN_EXECUTION_IDS,
] as const;
const ownerRejectedVeteranExecutionIds = new Set<string>(OWNER_REJECTED_VETERAN_EXECUTION_IDS);
export const VETERAN_PIXEL_QA_REJECTED_EXECUTION_IDS = [
  "VET_M01_EXEC_003",
  "VET_M01_EXEC_024",
  "VET_M07_EXEC_014",
  "VET_M20_EXEC_015",
  "VET_M21_EXEC_010",
  "VET_M22_EXEC_007",
  "VET_M22_EXEC_010",
  "VET_M22_EXEC_013",
  "VET_M22_EXEC_024",
  "VET_M24_EXEC_010",
  "VET_M24_EXEC_017",
  "VET_M24_EXEC_026",
  "VET_REF_08_EXEC_018",
] as const;
const veteranPixelQaRejectedExecutionIds = new Set<string>(VETERAN_PIXEL_QA_REJECTED_EXECUTION_IDS);

// Pixel authority: these are the exact customer-safe executions rendered in the
// final August 29 Veteran review sheets, including the final hero-contrast QA.
// Review-only permutations must never be made selectable merely because their
// metadata passes an automated gate.
export const AUG29_APPROVED_VETERAN_EXECUTION_IDS = [
  "VET_M01_EXEC_002", "VET_M01_EXEC_003", "VET_M01_EXEC_013", "VET_M01_EXEC_017",
  "VET_M01_EXEC_018", "VET_M01_EXEC_023", "VET_M01_EXEC_024", "VET_M01_EXEC_026",
  "VET_M02_EXEC_015", "VET_M02_EXEC_026", "VET_M04_EXEC_019",
  "VET_M05_EXEC_002", "VET_M05_EXEC_029", "VET_M06_EXEC_003", "VET_M06_EXEC_008",
  "VET_M07_EXEC_014", "VET_M07_EXEC_017", "VET_M08_EXEC_008", "VET_M08_EXEC_023",
  "VET_M08_EXEC_026", "VET_M09_EXEC_010", "VET_M10_EXEC_007", "VET_M10_EXEC_014",
  "VET_M10_EXEC_017", "VET_M10_EXEC_023", "VET_M11_EXEC_013", "VET_M12_EXEC_019",
  "VET_M13_EXEC_002", "VET_M13_EXEC_025", "VET_M13_EXEC_029", "VET_M14_EXEC_001",
  "VET_M14_EXEC_010", "VET_M14_EXEC_026", "VET_M15_EXEC_007", "VET_M15_EXEC_025",
  "VET_M16_EXEC_009", "VET_M16_EXEC_017", "VET_M17_EXEC_019", "VET_M18_EXEC_001",
  "VET_M18_EXEC_013", "VET_M19_EXEC_007", "VET_M19_EXEC_009", "VET_M19_EXEC_014",
  "VET_M19_EXEC_017", "VET_M20_EXEC_013", "VET_M20_EXEC_014", "VET_M20_EXEC_015",
  "VET_M20_EXEC_024", "VET_M21_EXEC_001", "VET_M21_EXEC_010", "VET_M21_EXEC_017",
  "VET_M21_EXEC_025", "VET_M21_EXEC_026", "VET_M22_EXEC_007", "VET_M22_EXEC_010",
  "VET_M22_EXEC_013", "VET_M22_EXEC_024", "VET_M23_EXEC_001", "VET_M23_EXEC_002",
  "VET_M23_EXEC_009", "VET_M23_EXEC_025", "VET_M23_EXEC_026", "VET_M24_EXEC_010",
  "VET_M24_EXEC_017", "VET_M24_EXEC_026", "VET_REF_01_EXEC_007", "VET_REF_01_EXEC_029",
  "VET_REF_02_EXEC_019", "VET_REF_03_EXEC_001", "VET_REF_03_EXEC_008", "VET_REF_03_EXEC_025",
  "VET_REF_04_EXEC_019", "VET_REF_05_EXEC_007", "VET_REF_05_EXEC_009", "VET_REF_05_EXEC_029",
  "VET_REF_06_EXEC_019", "VET_REF_07_EXEC_015", "VET_REF_08_EXEC_007", "VET_REF_08_EXEC_018",
  "VET_REF_08_EXEC_025", "VET_REF_09_EXEC_007", "VET_REF_09_EXEC_029", "VET_REF_10_EXEC_009",
  "VET_REF_10_EXEC_019", "VET_REF_10_EXEC_026", "VET_REF_11_EXEC_001", "VET_REF_11_EXEC_008",
  "VET_REF_11_EXEC_013", "VET_REF_11_EXEC_015", "VET_REF_11_EXEC_023", "VET_REF_12_EXEC_010",
  "VET_REF_12_EXEC_019", "VET_REF_12_EXEC_026", "VET_REPLICA_01_EXEC_002",
  "VET_REPLICA_01_EXEC_023", "VET_REPLICA_01_EXEC_030", "VET_REPLICA_02_EXEC_002",
  "VET_REPLICA_02_EXEC_008", "VET_REPLICA_03_EXEC_024", "VET_REPLICA_07_EXEC_026",
  "VET_REPLICA_07_EXEC_029", "VET_REPLICA_09_EXEC_003", "VET_REPLICA_09_EXEC_010",
  "VET_REPLICA_09_EXEC_018", "VET_REPLICA_10_EXEC_025", "VET_REPLICA_12_EXEC_013",
  "VET_REPLICA_12_EXEC_017",
] as const;
const aug29ApprovedVeteranExecutionIds = new Set<string>(AUG29_APPROVED_VETERAN_EXECUTION_IDS);

const CUSTOMER_VISIBLE_INTERNAL_LABEL = /(?:\bTEST\b|TEST_CAPABILITY|SAFE[_ ]MODE|PENDING[_ ]REVIEW|NOT DEPLOYED|PLACEHOLDER|\bDEBUG\b|\bMOCK\b)/i;

export function veteranCustomerVisibleCopy(execution: Pick<ApprovedVeteranConcept, "headline" | "heroContent" | "benefits" | "cta" | "ageOptions">) {
  return [...execution.headline, ...execution.heroContent, ...execution.benefits, execution.cta, ...execution.ageOptions].join(" ");
}

export function hasVeteranCustomerVisibleInternalLabel(execution: Pick<ApprovedVeteranConcept, "headline" | "heroContent" | "benefits" | "cta" | "ageOptions">) {
  return CUSTOMER_VISIBLE_INTERNAL_LABEL.test(veteranCustomerVisibleCopy(execution));
}

function fnv(text: string, seed = 2166136261) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function fingerprint(value: unknown) {
  const text = JSON.stringify(value);
  return `fp_${fnv(text)}${fnv([...text].reverse().join(""), 2246822519)}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function amountFor(index: number): 40000 | 50000 | 100000 | null {
  const values: [40000, 50000, 100000, null, null] = [40000, 50000, 100000, null, null];
  return values[index % values.length];
}

const MARKET_DIRECT_AMOUNTS = [40000, 50000, 100000] as const;

function marketDirectAmountFor(index: number): 40000 | 50000 | 100000 {
  return MARKET_DIRECT_AMOUNTS[index % MARKET_DIRECT_AMOUNTS.length];
}

function veteranSeeds(): VeteranSeed[] {
  const existing = buildVeteran24MasterReview().capabilityPreviews;
  const locked = buildVeteranReferenceLocked12().capabilityPreviews;
  return [
    ...existing.map((master, index) => {
      const masterId = `VET_M${pad(index + 1)}`;
      return {
        masterId,
        sourceMasterId: masterId,
        kind: "existing" as const,
        tile: null,
        backgroundTreatments: compatibleVeteranBackgroundTreatments(masterId),
        approvedGeometryId: `VET_EXISTING_LAYOUT_${pad(index + 1)}`,
        baseHeadline: master.headline,
      };
    }),
    ...locked.map((master, index) => {
      const masterId = `VET_REF_${pad(index + 1)}`;
      return {
        masterId,
        sourceMasterId: masterId,
        kind: "reference_locked" as const,
        tile: index + 1,
        backgroundTreatments: compatibleVeteranBackgroundTreatments(masterId),
        approvedGeometryId: `VET_REFERENCE_LOCKED_${pad(index + 1)}`,
        baseHeadline: master.headline,
      };
    }),
    ...Array.from({ length: 12 }, (_, index) => {
      const masterId = `VET_REPLICA_${pad(index + 1)}`;
      return {
        masterId,
        sourceMasterId: masterId,
        kind: "literal_replica" as const,
        tile: index + 1,
        backgroundTreatments: compatibleVeteranBackgroundTreatments(masterId),
        approvedGeometryId: `VET_LITERAL_REFERENCE_${pad(index + 1)}`,
        baseHeadline: VET_HOOKS[0],
      };
    }),
    ...[
      ["VETERANS", "WHOLE LIFE INSURANCE"],
      ["MILITARY", "WHOLE LIFE"],
      ["VETERANS", "DON’T LEAVE YOUR FAMILY WITH THE BILL"],
      ["VETERANS", "PRIVATE COVERAGE THAT PROTECTS"],
      ["VETERANS", "SECURE TODAY PROTECT TOMORROW"],
      ["VETERANS", "WE THANK YOU"],
      ["YOU SERVED", "NOW PROTECT WHAT MATTERS"],
      ["MILITARY FAMILIES", "DESERVE FINANCIAL PROTECTION"],
      ["VETERANS", "LIFE INSURANCE"],
      ["VETERANS", "BUILT FOR YOU. BACKED BY US."],
      ["SERVE WITH HONOR", "PROTECT WITH PURPOSE"],
      ["MILITARY STRONG", "FUTURE SECURE"],
    ].map((baseHeadline, index) => {
      const masterId = `VET_MARKET_${pad(index + 1)}`;
      return {
        masterId,
        sourceMasterId: masterId,
        kind: "market_direct" as const,
        tile: index + 1,
        backgroundTreatments: [],
        approvedGeometryId: `VET_MARKET_REFERENCE_${pad(index + 1)}`,
        baseHeadline,
      };
    }),
  ];
}

type BaseExecution = Omit<ApprovedVeteranConcept,
  "visualConceptId" | "selectionStyleCategory" | "customerEligible" | "eligibilityReasons" | "visualQuality" | "originalIdentityRetained"
>;

function buildExecution(seed: VeteranSeed, index: number, imageCounter: { value: number }): BaseExecution {
  if (seed.kind === "market_direct") {
    const palette = MARKET_DIRECT_PALETTES[index % MARKET_DIRECT_PALETTES.length];
    const surface = Math.floor(index / MARKET_DIRECT_PALETTES.length) % 10;
    const benefits = ["NO MEDICAL EXAM", "NO 2-YEAR WAIT", "PROTECT YOUR FAMILY"];
    const heroAmount = marketDirectAmountFor(index);
    const heroAmountText = `$${heroAmount.toLocaleString("en-US")}`;
    const renderFields = {
      lane: "veteran",
      language: "en",
      geometry: seed.approvedGeometryId,
      compositionMode: "pure_css",
      palette,
      surface,
      headline: seed.baseHeadline,
      heroContent: [heroAmountText],
      benefits,
      ageOptions: ["50–54", "55–59", "60–64", "65–69", "70–74", "75–85"],
      cta: "SEE MY OPTIONS",
    };
    return {
      lane: "veteran",
      language: "en",
      masterId: seed.masterId,
      sourceMasterId: seed.sourceMasterId,
      masterKind: seed.kind,
      referenceTile: seed.tile,
      executionId: `${seed.masterId}_EXEC_${String(index + 1).padStart(3, "0")}`,
      variantId: `market_${palette}_surface_${String(surface + 1).padStart(2, "0")}`,
      backgroundAssetId: null,
      backgroundUrl: null,
      imageTreatment: `css_surface_${String(surface + 1).padStart(2, "0")}`,
      imageFocalPosition: "center",
      compositionMode: "graphic",
      palette,
      headlineHookId: `MARKET_REFERENCE_${pad(seed.tile || 1)}`,
      headline: seed.baseHeadline,
      heroTreatment: "reference_layout",
      heroAmount,
      heroContent: [heroAmountText],
      claimMode: "PRODUCTION_APPROVED",
      claimAuthority: "OWNER_CONFIRMED",
      capabilityFixtureId: "OWNER_CONFIRMED_VETERAN_2026_09",
      benefitPackageId: `MARKET_REFERENCE_BENEFITS_${pad(seed.tile || 1)}`,
      benefits,
      ageTreatmentId: "MARKET_VETERAN_50_85",
      ageOptions: renderFields.ageOptions,
      ctaId: "MARKET_SEE_MY_OPTIONS",
      cta: renderFields.cta,
      borderTreatment: `market_border_${(surface % 4) + 1}`,
      panelTreatment: `market_surface_${surface + 1}`,
      renderFingerprint: fingerprint(renderFields),
      nearFingerprint: fingerprint({ ...renderFields, palette: "MARKET_PALETTE" }),
      approvedGeometryId: seed.approvedGeometryId,
    };
  }
  const palette = VET_PALETTES[Math.floor(index / 3) % 5];
  const sourceNumber = Number(seed.sourceMasterId.match(/(\d+)$/)?.[1] || 0);
  const safeDarkGraphicMaster = seed.kind === "existing"
    ? ![8, 15].includes(sourceNumber)
    : seed.kind === "reference_locked"
      ? ![2, 8, 10, 12].includes(sourceNumber)
      : true;
  const imageCompatible = seed.backgroundTreatments.length > 0;
  const forceSafeDarkGraphic = imageCompatible && safeDarkGraphicMaster && [0, 6, 15, 21].includes(index);
  const requested: ApprovedVeteranCompositionMode = imageCompatible && palette !== "paper_red" && !forceSafeDarkGraphic
    ? (index % 2 ? "image_backed" : "hybrid")
    : (index % 3 === 0 ? "graphic" : index % 3 === 1 ? "typographic" : "hybrid");
  const compositionMode: ApprovedVeteranCompositionMode = requested === "image_backed" && !imageCompatible ? "typographic" : requested;
  const hasImage = imageCompatible && (compositionMode === "image_backed" || compositionMode === "hybrid");
  const assetNumber = hasImage ? (imageCounter.value++ % 40) + 1 : null;
  const backgroundAssetId = assetNumber ? `VET_IMG_${pad(assetNumber)}` : null;
  const backgroundUrl = assetNumber ? `/ad-backgrounds/veteran/${assetNumber}.jpg` : null;
  const selectedTreatment = assetNumber ? chooseVeteranBackgroundTreatment(seed.masterId, index, assetNumber) : null;
  const imageTreatment = selectedTreatment || "none";
  const imageFocalPosition = assetNumber && selectedTreatment ? focalPositionForTreatment(selectedTreatment, assetNumber) : "center";
  const hookIndex = Math.floor(index / 15) % 2;
  const amount = amountFor(index);
  const claimMode = amount === null ? "SAFE_MODE" as const : "TEST_CAPABILITY" as const;
  const heroContent = amount ? [`$${amount.toLocaleString("en-US")}`] : SAFE_HEROES[index % 4];
  const benefitIndex = (Math.floor(index / 2) + hookIndex) % VET_BENEFITS.length;
  const ctaIndex = (index + hookIndex) % VET_CTA.length;
  const renderFields = {
    lane: "veteran",
    language: "en",
    geometry: seed.approvedGeometryId,
    compositionMode,
    palette,
    assetId: backgroundAssetId,
    imageTreatment,
    imageFocalPosition,
    headline: hookIndex === 0 ? seed.baseHeadline : VET_HOOKS[hookIndex],
    heroContent,
    heroTreatment: ["amount_panel", "open_typography", "outlined_panel"][index % 3],
    benefits: VET_BENEFITS[benefitIndex],
    ageOptions: VET_AGES,
    cta: VET_CTA[ctaIndex],
    borderTreatment: ["approved_frame", "double_rule", "accent_edge"][index % 3],
    panelTreatment: ["approved_panels", "soft_panels", "high_contrast_panels"][Math.floor(index / 3) % 3],
  };
  return {
    lane: "veteran",
    language: "en",
    masterId: seed.masterId,
    sourceMasterId: seed.sourceMasterId,
    masterKind: seed.kind,
    referenceTile: seed.tile,
    executionId: `${seed.masterId}_EXEC_${String(index + 1).padStart(3, "0")}`,
    variantId: `${compositionMode}_${palette}_H${hookIndex + 1}_${amount || "SAFE"}`,
    backgroundAssetId,
    backgroundUrl,
    imageTreatment,
    imageFocalPosition,
    compositionMode,
    palette,
    headlineHookId: `HOOK_${hookIndex + 1}`,
    headline: renderFields.headline,
    heroTreatment: renderFields.heroTreatment,
    heroAmount: amount,
    heroContent,
    claimMode,
    claimAuthority: amount ? "TEST_FIXTURE_ONLY" : "SAFE_COPY",
    capabilityFixtureId: amount ? "VET-MASS-TEST-CAPABILITY" : null,
    benefitPackageId: `BENEFIT_${benefitIndex + 1}`,
    benefits: renderFields.benefits,
    ageTreatmentId: "TEST_VETERAN_20_85",
    ageOptions: VET_AGES,
    ctaId: `CTA_${ctaIndex + 1}`,
    cta: VET_CTA[ctaIndex],
    borderTreatment: renderFields.borderTreatment,
    panelTreatment: renderFields.panelTreatment,
    renderFingerprint: fingerprint(renderFields),
    nearFingerprint: fingerprint({ ...renderFields, heroContent: amount ? "CAPABILITY_AMOUNT" : "SAFE_HERO" }),
    approvedGeometryId: seed.approvedGeometryId,
  };
}

function computeVisualConceptId(execution: BaseExecution) {
  const architecture = {
    masterGeometry: execution.approvedGeometryId,
    masterKind: execution.masterKind,
    composition: execution.compositionMode,
    palette: execution.palette,
    imagePresence: Boolean(execution.backgroundAssetId),
    asset: execution.backgroundAssetId,
    imageTreatment: execution.imageTreatment,
    imagePlacement: execution.backgroundAssetId ? execution.imageFocalPosition : "none",
    heroPlacement: execution.heroTreatment,
    benefitArchitecture: `${execution.benefits.length}_BENEFIT_REGIONS`,
    ageArchitecture: execution.ageTreatmentId,
    typography: execution.masterKind,
  };
  return `vc_${fnv(JSON.stringify(architecture))}${fnv(JSON.stringify(architecture), 2246822519)}`;
}

function wordCount(execution: BaseExecution) {
  return [...execution.headline, ...execution.heroContent, ...execution.benefits, execution.cta, ...execution.ageOptions]
    .join(" ").trim().split(/\s+/).filter(Boolean).length;
}

function assetNumber(execution: BaseExecution) {
  return Number(execution.backgroundAssetId?.match(/(\d+)$/)?.[1] || 0);
}

export function isApprovedVeteranLightExecution(execution: BaseExecution) {
  return ["paper_red", "reference_white", "white_red", "soft_blue"].includes(execution.palette);
}

function isCleanLight(execution: BaseExecution) {
  return CLEAN_LIGHT_MASTERS.has(execution.masterId)
    && execution.panelTreatment !== "soft_panels"
    && execution.borderTreatment !== "double_rule"
    && execution.heroTreatment !== "outlined_panel";
}

function knownContrastWeak(execution: BaseExecution) {
  if (execution.masterKind === "market_direct") return false;
  if (execution.backgroundAssetId || execution.masterKind === "literal_replica") return false;
  const number = Number(execution.sourceMasterId.match(/(\d+)$/)?.[1] || 0);
  if (execution.masterKind === "existing") {
    return (number === 17 && execution.palette !== "paper_red")
      || (EXISTING_PAPER_WEAK.has(number) && execution.palette === "paper_red")
      || (EXISTING_PATRIOTIC_WEAK.has(number) && execution.palette === "patriotic_split")
      || (EXISTING_NON_PAPER_WEAK.has(number) && execution.palette !== "paper_red");
  }
  return (REFERENCE_NON_PAPER_WEAK.has(number) && execution.palette !== "paper_red")
    || (REFERENCE_PAPER_WEAK.has(number) && execution.palette === "paper_red");
}

function classify(execution: BaseExecution) {
  const geometrySuffix = execution.approvedGeometryId.slice(-2);
  const light = isApprovedVeteranLightExecution(execution);
  const image = Boolean(execution.backgroundAssetId);
  const asset = assetNumber(execution);
  const treatmentKnown = !image || VETERAN_BACKGROUND_TREATMENTS.includes(execution.imageTreatment as VeteranBackgroundTreatment);
  const allowed = compatibleVeteranBackgroundTreatments(execution.masterId);
  const treatmentAllowed = !image || allowed.includes(execution.imageTreatment as VeteranBackgroundTreatment);
  const cropAllowed = !image || treatmentSupportsAsset(execution.imageTreatment as VeteranBackgroundTreatment, asset);
  const lightClean = !light || isCleanLight(execution);
  const cluttered = (!image && COMPLEX_GEOMETRY_SUFFIXES.has(geometrySuffix) && execution.panelTreatment === "soft_panels") || (light && !lightClean);
  const paletteComplex = !image && execution.palette === "patriotic_split" && execution.borderTreatment === "double_rule" && execution.heroTreatment === "outlined_panel";
  const heroWeak = knownContrastWeak(execution) || (light && !lightClean);
  const copyTooDense = wordCount(execution) > 70;
  const visualQuality: ApprovedVeteranVisualQuality = {
    dominantColorCount: 2,
    accentColorCount: paletteComplex ? 2 : 1,
    panelCount: cluttered ? 5 : 3,
    copyWordCount: wordCount(execution),
    focalPointCount: cluttered ? 4 : 2,
    minTextSizeEstimate: 14,
    heroContrast: heroWeak ? "FAIL" : "PASS",
    heroProminence: heroWeak ? "FAIL" : "PASS",
    headlineContrast: heroWeak || (light && !lightClean) ? "FAIL" : "PASS",
    benefitReadability: copyTooDense ? "FAIL" : "PASS",
    ageReadability: "PASS",
    imageCopyCollision: !treatmentAllowed || !cropAllowed ? "FAIL" : "PASS",
    paletteDiscipline: paletteComplex ? "FAIL" : "PASS",
    simplicity: cluttered ? "FAIL" : "PASS",
    imageOverlayReadability: !treatmentKnown || !treatmentAllowed ? "FAIL" : "PASS",
    overflow: copyTooDense ? "FAIL" : "PASS",
    clipping: "PASS",
    brokenBackground: image && !/^\/ad-backgrounds\/veteran\/(?:[1-9]|[1-3]\d|40)\.jpg$/.test(execution.backgroundUrl || "") ? "FAIL" : "PASS",
    wrongCrop: !cropAllowed ? "FAIL" : "PASS",
    subjectCoveringCopy: !treatmentAllowed || !cropAllowed ? "FAIL" : "PASS",
    overlayFailure: !treatmentKnown ? "FAIL" : "PASS",
  };
  const gates: Array<[keyof ApprovedVeteranVisualQuality, string]> = [
    ["heroContrast", "HERO_CONTRAST"], ["heroProminence", "HERO_PROMINENCE"], ["headlineContrast", "HEADLINE_CONTRAST"],
    ["benefitReadability", "BENEFIT_READABILITY"], ["ageReadability", "AGE_READABILITY"], ["imageCopyCollision", "IMAGE_COPY_COLLISION"],
    ["paletteDiscipline", "PALETTE_COMPLEXITY"], ["simplicity", "CLUTTER"], ["imageOverlayReadability", "IMAGE_OVERLAY_READABILITY"],
    ["overflow", "OVERFLOW"], ["clipping", "CLIPPING"], ["brokenBackground", "BROKEN_BACKGROUND"], ["wrongCrop", "WRONG_CROP"],
    ["subjectCoveringCopy", "SUBJECT_COVERING_COPY"], ["overlayFailure", "OVERLAY_FAILURE"],
  ];
  const eligibilityReasons = gates.filter(([gate]) => visualQuality[gate] === "FAIL").map(([, reason]) => reason);
  return {
    visualConceptId: computeVisualConceptId(execution),
    selectionStyleCategory: image ? "image_backed_direct_response" as const : "pure_graphic" as const,
    eligibilityReasons,
    visualQuality,
    originalIdentityRetained: true as const,
  };
}

function shuffled<T>(values: T[], seed: string) {
  const output = [...values];
  let state = parseInt(fnv(seed), 16) || 1;
  for (let index = output.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = Math.floor((state / 4294967296) * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function roundRobinTake(values: ApprovedVeteranConcept[], count: number, seed: string, group: (execution: ApprovedVeteranConcept) => string = execution => execution.masterId) {
  const groups = new Map<string, ApprovedVeteranConcept[]>();
  for (const execution of values) {
    const key = group(execution);
    const list = groups.get(key) || [];
    list.push(execution);
    groups.set(key, list);
  }
  const keys = [...groups.keys()].sort((left, right) => fnv(`${seed}:${left}`).localeCompare(fnv(`${seed}:${right}`)));
  for (const [key, list] of groups) list.sort((left, right) => (
    Number(right.heroAmount !== null) - Number(left.heroAmount !== null)
    || fnv(`${seed}:${key}:${left.executionId}`).localeCompare(fnv(`${seed}:${key}:${right.executionId}`))
  ));
  const selected: ApprovedVeteranConcept[] = [];
  let round = 0;
  while (selected.length < count) {
    let added = 0;
    for (const key of keys) {
      const candidate = groups.get(key)?.[round];
      if (candidate) {
        selected.push(candidate);
        added++;
        if (selected.length === count) break;
      }
    }
    if (!added) break;
    round++;
  }
  if (selected.length !== count) throw new Error(`Unable to select ${count} Veteran concepts from ${values.length}`);
  return selected;
}

export function buildApprovedVeteranLibrary() {
  const imageCounter = { value: 0 };
  const classified: ApprovedVeteranConcept[] = [];
  for (const seed of veteranSeeds()) {
    const executionCount = seed.kind === "market_direct" ? 20 : 30;
    for (let index = 0; index < executionCount; index++) {
      const execution = buildExecution(seed, index, imageCounter);
      classified.push({ ...execution, ...classify(execution), customerEligible: false });
    }
  }
  for (const execution of classified) {
    execution.customerEligible = (execution.masterKind === "market_direct" || aug29ApprovedVeteranExecutionIds.has(execution.executionId))
      && execution.eligibilityReasons.length === 0
      && !hasVeteranCustomerVisibleInternalLabel(execution)
      && !ownerRejectedVeteranExecutionIds.has(execution.executionId)
      && !veteranPixelQaRejectedExecutionIds.has(execution.executionId);
    if (!execution.customerEligible && execution.eligibilityReasons.length === 0) {
      execution.eligibilityReasons.push(hasVeteranCustomerVisibleInternalLabel(execution)
        ? "CUSTOMER_VISIBLE_INTERNAL_LABEL"
        : "NOT_IN_AUG29_FINAL_PIXEL_AUTHORITY");
    }
  }
  return classified;
}

export function isOwnerSelectableVeteranExecution(execution: ApprovedVeteranConcept) {
  return execution.customerEligible && !ownerRejectedVeteranExecutionIds.has(execution.executionId);
}

function veteranStylePattern(batchSize: number): ApprovedVeteranConcept["selectionStyleCategory"][] {
  if (batchSize === 3) return ["image_backed_direct_response", "image_backed_direct_response", "pure_graphic"];
  if (batchSize === 5) return ["image_backed_direct_response", "image_backed_direct_response", "image_backed_direct_response", "pure_graphic", "pure_graphic"];
  return Array.from({ length: batchSize }, (_, index) => (
    index < Math.ceil(batchSize * 0.6) ? "image_backed_direct_response" : "pure_graphic"
  ));
}

export function selectApprovedVeteranConcepts({
  seed,
  count,
  usedVisualConceptIds = new Set<string>(),
}: {
  seed: string;
  count: number;
  usedVisualConceptIds?: Set<string>;
}) {
  const requestedCount = Math.max(1, Math.min(5, count));
  const eligible = buildApprovedVeteranLibrary().filter(execution =>
    isOwnerSelectableVeteranExecution(execution)
    && !usedVisualConceptIds.has(execution.visualConceptId)
  );
  const marketDirect = eligible.filter(execution => (
    execution.masterKind === "market_direct"
    && MARKET_DIRECT_AMOUNTS.includes(execution.heroAmount as 40000 | 50000 | 100000)
    && execution.claimAuthority === "OWNER_CONFIRMED"
  ));
  if (marketDirect.length >= requestedCount) {
    const selectedMasters = roundRobinTake(
      marketDirect,
      requestedCount,
      `${seed}:veteran:market_direct`,
      execution => execution.masterId,
    );
    const amountOffset = parseInt(fnv(`${seed}:veteran:market_direct:amount`), 16) % MARKET_DIRECT_AMOUNTS.length;
    return selectedMasters.map((selected, index) => {
      const desiredAmount = MARKET_DIRECT_AMOUNTS[(amountOffset + index) % MARKET_DIRECT_AMOUNTS.length];
      return marketDirect
        .filter(execution => execution.masterId === selected.masterId && execution.heroAmount === desiredAmount)
        .sort((left, right) => fnv(`${seed}:${left.executionId}`).localeCompare(fnv(`${seed}:${right.executionId}`)))[0]
        || selected;
    });
  }
  const imageValues = eligible.filter(execution => execution.selectionStyleCategory === "image_backed_direct_response" && execution.heroAmount !== null);
  const pureGraphicValues = eligible.filter(execution => execution.selectionStyleCategory === "pure_graphic" && execution.heroAmount !== null);
  const pools: Record<ApprovedVeteranConcept["selectionStyleCategory"], ApprovedVeteranConcept[]> = {
    image_backed_direct_response: roundRobinTake(
      imageValues,
      imageValues.length,
      `${seed}:veteran:image_backed_direct_response`,
      execution => execution.backgroundAssetId || execution.masterId,
    ),
    pure_graphic: shuffled(
      pureGraphicValues,
      `${seed}:veteran:pure_graphic`,
    ),
  };
  const offsets: Record<ApprovedVeteranConcept["selectionStyleCategory"], number> = {
    image_backed_direct_response: 0,
    pure_graphic: 0,
  };
  const pattern = veteranStylePattern(requestedCount);
  const selected: ApprovedVeteranConcept[] = [];
  const usedMasters = new Set<string>();
  const usedConcepts = new Set<string>();
  const usedRenders = new Set<string>();
  const usedNear = new Set<string>();
  const usedImages = new Set<string>();
  const usedTreatments = new Set<string>();
  const canUse = (concept: ApprovedVeteranConcept, strictImageDiversity: boolean) => {
    if (usedMasters.has(concept.masterId) || usedConcepts.has(concept.visualConceptId)) return false;
    if (usedRenders.has(concept.renderFingerprint) || usedNear.has(concept.nearFingerprint)) return false;
    if (strictImageDiversity && concept.backgroundAssetId && (
      usedImages.has(concept.backgroundAssetId) || usedTreatments.has(concept.imageTreatment)
    )) return false;
    return true;
  };
  const takeNext = (style: ApprovedVeteranConcept["selectionStyleCategory"], strictImageDiversity: boolean) => {
    const pool = pools[style];
    for (let scanned = 0; scanned < pool.length; scanned++) {
      const offset = offsets[style]++;
      const concept = pool[offset % pool.length];
      if (!canUse(concept, strictImageDiversity)) continue;
      selected.push(concept);
      usedMasters.add(concept.masterId);
      usedConcepts.add(concept.visualConceptId);
      usedRenders.add(concept.renderFingerprint);
      usedNear.add(concept.nearFingerprint);
      if (concept.backgroundAssetId) usedImages.add(concept.backgroundAssetId);
      if (concept.backgroundAssetId) usedTreatments.add(concept.imageTreatment);
      return true;
    }
    return false;
  };
  for (const style of pattern) {
    if (takeNext(style, true)) continue;
    if (takeNext(style, false)) continue;
    const fallbackStyle = style === "image_backed_direct_response" ? "pure_graphic" : "image_backed_direct_response";
    if (!takeNext(fallbackStyle, false)) break;
  }
  if (selected.length !== requestedCount) throw new Error("The approved Veteran creative pool is temporarily exhausted.");
  return selected;
}

export function auditApprovedVeteranRuntime() {
  const library = buildApprovedVeteranLibrary();
  const eligible = library.filter(execution => execution.customerEligible);
  const ownerSelectable = eligible.filter(isOwnerSelectableVeteranExecution);
  return {
    masterCount: new Set(library.map(execution => execution.masterId)).size,
    existingApprovedCount: new Set(library.filter(execution => execution.masterKind === "existing").map(execution => execution.masterId)).size,
    referenceLockedCount: new Set(library.filter(execution => execution.masterKind === "reference_locked").map(execution => execution.masterId)).size,
    literalReplicaCount: new Set(library.filter(execution => execution.masterKind === "literal_replica").map(execution => execution.masterId)).size,
    imageCount: new Set(library.map(execution => execution.backgroundAssetId).filter(Boolean)).size,
    backgroundTreatmentCount: VETERAN_BACKGROUND_TREATMENTS.length,
    customerEligibleCount: eligible.length,
    ownerSelectableCount: ownerSelectable.length,
    visualConceptCount: new Set(eligible.map(execution => execution.visualConceptId)).size,
    customerEligibleImageShare: eligible.filter(execution => execution.backgroundAssetId).length / eligible.length,
    eligibleMasterCount: new Set(eligible.map(execution => execution.masterId)).size,
    failedEligibleGates: eligible.flatMap(execution => execution.eligibilityReasons),
  };
}
