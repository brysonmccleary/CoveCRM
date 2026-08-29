import { generateCreativeIntelligenceDrafts, scoreBatchDiversity } from "./engine";
import { buildSafeGeneralCapability } from "./capabilities";
import type { CreativeAudienceSegment, CreativeLanguage, CreativeVertical, ProductCapability } from "./types";

type QaConfig = {
  group: string; label: string; vertical: CreativeVertical; audienceSegment: CreativeAudienceSegment;
  language: CreativeLanguage; batches: number; requestedCount: number; capabilityFixture?: boolean;
};

const FINAL_QA_CONFIGS: QaConfig[] = [
  { group: "veteran", label: "Veteran", vertical: "veteran", audienceSegment: "veteran", language: "en", batches: 6, requestedCount: 5, capabilityFixture: true },
  { group: "final_expense", label: "Final Expense", vertical: "final_expense", audienceSegment: "standard", language: "en", batches: 6, requestedCount: 5, capabilityFixture: true },
  { group: "mortgage", label: "Mortgage", vertical: "mortgage_protection", audienceSegment: "standard", language: "en", batches: 6, requestedCount: 5, capabilityFixture: true },
  { group: "iul", label: "IUL", vertical: "iul", audienceSegment: "standard", language: "en", batches: 6, requestedCount: 5, capabilityFixture: true },
  { group: "trucker", label: "Trucker", vertical: "trucker", audienceSegment: "trucker", language: "en", batches: 6, requestedCount: 5, capabilityFixture: true },
  { group: "spanish", label: "Spanish Final Expense", vertical: "final_expense", audienceSegment: "spanish", language: "es", batches: 2, requestedCount: 5 },
  { group: "spanish", label: "Spanish Mortgage", vertical: "mortgage_protection", audienceSegment: "spanish", language: "es", batches: 2, requestedCount: 5 },
  { group: "spanish", label: "Spanish IUL", vertical: "iul", audienceSegment: "spanish", language: "es", batches: 2, requestedCount: 5 },
  { group: "spanish", label: "Spanish Veteran", vertical: "veteran", audienceSegment: "veteran", language: "es", batches: 2, requestedCount: 5 },
  { group: "spanish", label: "Spanish Trucker", vertical: "trucker", audienceSegment: "trucker", language: "es", batches: 2, requestedCount: 5 },
  { group: "combinations", label: "Veteran Mortgage", vertical: "mortgage_protection", audienceSegment: "veteran", language: "en", batches: 1, requestedCount: 5 },
  { group: "combinations", label: "Veteran IUL", vertical: "iul", audienceSegment: "veteran", language: "en", batches: 1, requestedCount: 5 },
  { group: "combinations", label: "Veteran Final Expense", vertical: "final_expense", audienceSegment: "veteran", language: "en", batches: 1, requestedCount: 5 },
  { group: "combinations", label: "Trucker Mortgage", vertical: "mortgage_protection", audienceSegment: "trucker", language: "en", batches: 1, requestedCount: 5 },
  { group: "combinations", label: "Trucker IUL", vertical: "iul", audienceSegment: "trucker", language: "en", batches: 1, requestedCount: 5 },
  { group: "combinations", label: "Trucker Final Expense", vertical: "final_expense", audienceSegment: "trucker", language: "en", batches: 1, requestedCount: 5 },
];

const COLLISION_CONFIGS: QaConfig[] = [
  { group: "veteran", label: "Veteran Collision", vertical: "veteran", audienceSegment: "veteran", language: "en", batches: 30, requestedCount: 5 },
  { group: "final_expense", label: "Final Expense Collision", vertical: "final_expense", audienceSegment: "standard", language: "en", batches: 30, requestedCount: 5 },
  { group: "mortgage", label: "Mortgage Collision", vertical: "mortgage_protection", audienceSegment: "standard", language: "en", batches: 30, requestedCount: 5 },
  { group: "iul", label: "IUL Collision", vertical: "iul", audienceSegment: "standard", language: "en", batches: 30, requestedCount: 5 },
  { group: "trucker", label: "Trucker Collision", vertical: "trucker", audienceSegment: "trucker", language: "en", batches: 30, requestedCount: 5 },
  { group: "spanish", label: "Spanish Final Expense Collision", vertical: "final_expense", audienceSegment: "spanish", language: "es", batches: 8, requestedCount: 5 },
  { group: "spanish", label: "Spanish Mortgage Collision", vertical: "mortgage_protection", audienceSegment: "spanish", language: "es", batches: 8, requestedCount: 5 },
  { group: "spanish", label: "Spanish IUL Collision", vertical: "iul", audienceSegment: "spanish", language: "es", batches: 8, requestedCount: 5 },
  { group: "spanish", label: "Spanish Veteran Collision", vertical: "veteran", audienceSegment: "veteran", language: "es", batches: 8, requestedCount: 5 },
  { group: "spanish", label: "Spanish Trucker Collision", vertical: "trucker", audienceSegment: "trucker", language: "es", batches: 8, requestedCount: 5 },
];

function qaCapability(vertical: CreativeVertical): ProductCapability {
  return {
    ...buildSafeGeneralCapability(vertical), capabilityId: `qa-test-${vertical}-depth-v3`,
    carrier: "QA TEST CARRIER — NOT PRODUCTION", product: `QA ${vertical} fixture`, productIdentifier: `QA-${vertical.toUpperCase()}`,
    states: ["AZ"], issueAgeMin: 45, issueAgeMax: 84, faceAmountMin: 10_000,
    faceAmountMax: vertical === "mortgage_protection" || vertical === "iul" ? 500_000 : 50_000,
    waitingPeriodRules: ["none"], immediateBenefitRules: ["immediate"], medicalExamRequirement: "not_required",
    premiumGuarantees: ["level guaranteed"], livingBenefits: vertical === "mortgage_protection" || vertical === "iul" ? ["benefit:living"] : [],
    effectiveDate: "2026-08-28", expiresAt: "2030-01-01", approvalSource: "isolated-visual-qa-fixture",
    approvalMetadata: { synthetic: true, productionEligible: false },
  };
}

function buildCorpus(configs: QaConfig[], prefix: string, expected: number) {
  const previews: Array<Record<string, any>> = [];
  const batches: Array<Record<string, any>> = [];
  let previewNumber = 0;
  let batchNumber = 0;
  for (const config of configs) for (let configBatch = 0; configBatch < config.batches; configBatch += 1) {
    batchNumber += 1;
    const batchId = `B${String(batchNumber).padStart(3, "0")}`;
    const useFixture = Boolean(config.capabilityFixture && configBatch === 0);
    let drafts: ReturnType<typeof generateCreativeIntelligenceDrafts> | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 32 && !drafts; attempt += 1) try {
      drafts = generateCreativeIntelligenceDrafts({
        vertical: config.vertical, audienceSegment: config.audienceSegment, language: config.language,
        userKey: `${prefix}-${config.group}-${config.label}-${configBatch}`, campaignName: `${config.label} QA`,
        requestedCount: config.requestedCount, generationNonce: `${prefix}-${config.label}-${configBatch}-${attempt}`,
        location: useFixture ? "AZ" : undefined, applicantAge: useFixture ? 60 : undefined,
        productCapability: useFixture ? qaCapability(config.vertical) : null, recentUsage: previews.slice(-5000),
      });
    } catch (error) { lastError = error; }
    if (!drafts) throw new Error(`Unable to generate ${batchId} (${config.label}): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    const batchDrafts = drafts.map((draft) => ({ ...draft, previewNumber: ++previewNumber, previewId: `P${String(previewNumber).padStart(4, "0")}`, qaGroup: config.group, qaConfigLabel: config.label, qaBatchId: batchId, qaCustomerBatch: configBatch + 1, qaCapabilityMode: useFixture ? "test_fixture" : "safe_fallback" }));
    previews.push(...batchDrafts);
    batches.push({ batchId, group: config.group, label: config.label, diversity: scoreBatchDiversity(batchDrafts) });
  }
  if (previews.length !== expected) throw new Error(`${prefix} corpus expected ${expected}, received ${previews.length}.`);
  return { generatedAt: new Date().toISOString(), previews, batches };
}

let finalCache: ReturnType<typeof buildCorpus> | null = null;
let collisionCache: ReturnType<typeof buildCorpus> | null = null;
export function buildCreativeVisualQaCorpus() { return finalCache ||= buildCorpus(FINAL_QA_CONFIGS, "visual-qa-v3", 230); }
export function buildCreativeDepthCollisionCorpus() { return collisionCache ||= buildCorpus(COLLISION_CONFIGS, "collision-v3", 950); }
export const CREATIVE_QA_GROUPS = ["veteran", "final_expense", "mortgage", "iul", "trucker", "spanish", "combinations"] as const;
