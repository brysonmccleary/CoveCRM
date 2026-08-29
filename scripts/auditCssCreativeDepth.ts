import fs from "fs";
import path from "path";
import { CSS_EXECUTIONS, getEligibleCssExecutions } from "../lib/facebook/creativeIntelligence/executions";
import { getEligibleCreativeFamilies } from "../lib/facebook/creativeIntelligence/families";
import type { CreativeAudienceSegment, CreativeLanguage, CreativeVertical } from "../lib/facebook/creativeIntelligence/types";

const lanes: Array<{ id: string; vertical: CreativeVertical; audience: CreativeAudienceSegment; language: CreativeLanguage }> = [
  { id: "veteran", vertical: "veteran", audience: "veteran", language: "en" },
  { id: "final_expense", vertical: "final_expense", audience: "standard", language: "en" },
  { id: "mortgage", vertical: "mortgage_protection", audience: "standard", language: "en" },
  { id: "iul", vertical: "iul", audience: "standard", language: "en" },
  { id: "trucker", vertical: "trucker", audience: "trucker", language: "en" },
  { id: "spanish_final_expense", vertical: "final_expense", audience: "spanish", language: "es" },
  { id: "spanish_mortgage", vertical: "mortgage_protection", audience: "spanish", language: "es" },
  { id: "spanish_iul", vertical: "iul", audience: "spanish", language: "es" },
  { id: "spanish_veteran", vertical: "veteran", audience: "veteran", language: "es" },
  { id: "spanish_trucker", vertical: "trucker", audience: "trucker", language: "es" },
];

const before: Record<string, { rawExecutionDefinitions: number; meaningfulStructuralMacros: number; themeAliasesPerMacro: number }> = {
  veteran: { rawExecutionDefinitions: 40, meaningfulStructuralMacros: 8, themeAliasesPerMacro: 5 },
  final_expense: { rawExecutionDefinitions: 30, meaningfulStructuralMacros: 6, themeAliasesPerMacro: 5 },
  mortgage: { rawExecutionDefinitions: 30, meaningfulStructuralMacros: 6, themeAliasesPerMacro: 5 },
  iul: { rawExecutionDefinitions: 30, meaningfulStructuralMacros: 6, themeAliasesPerMacro: 5 },
  trucker: { rawExecutionDefinitions: 30, meaningfulStructuralMacros: 6, themeAliasesPerMacro: 5 },
  spanish_final_expense: { rawExecutionDefinitions: 25, meaningfulStructuralMacros: 5, themeAliasesPerMacro: 5 },
  spanish_mortgage: { rawExecutionDefinitions: 30, meaningfulStructuralMacros: 6, themeAliasesPerMacro: 5 },
  spanish_iul: { rawExecutionDefinitions: 25, meaningfulStructuralMacros: 5, themeAliasesPerMacro: 5 },
  spanish_veteran: { rawExecutionDefinitions: 15, meaningfulStructuralMacros: 3, themeAliasesPerMacro: 5 },
  spanish_trucker: { rawExecutionDefinitions: 15, meaningfulStructuralMacros: 3, themeAliasesPerMacro: 5 },
};

function count(values: unknown[]) { return new Set(values.map((value) => String(value || ""))).size; }
function structuralSignature(row: any) {
  return [row.macroFamily, row.layoutId, row.rendererFamily, row.compositionVariant, row.hierarchyTreatment, row.panelStructure,
    row.typographyTreatment, row.selectorPresentation, row.benefitTreatment, row.backgroundTreatment, row.ctaTreatment,
    row.frameTreatment, row.heroTreatment, row.whitespaceTreatment].join("|");
}

function rawPermutationLowerBound(lane: typeof lanes[number], executions: typeof CSS_EXECUTIONS) {
  const families = getEligibleCreativeFamilies({
    vertical: lane.vertical, audienceSegment: lane.audience, language: lane.language,
  });
  let total = 0n;
  for (const execution of executions) for (const family of families.filter((entry) => entry.layoutIds.includes(execution.layoutId))) {
    const copy = lane.language === "es" && family.spanish ? family.spanish : family;
    total += BigInt(Math.max(1, copy.headlines.length)) * BigInt(Math.max(1, copy.hooks.length))
      * BigInt(Math.max(1, copy.benefitLists.length)) * BigInt(Math.max(1, copy.ctas.length))
      * BigInt(Math.max(1, family.imageDirections.length)) * BigInt(Math.max(1, family.backgroundDirections.length))
      * BigInt(Math.max(1, family.selectorTypes.length));
  }
  return total.toString();
}

const after = Object.fromEntries(lanes.map((lane) => {
  const rows = getEligibleCssExecutions({ vertical: lane.vertical, audienceSegment: lane.audience, language: lane.language });
  return [lane.id, {
    executionDefinitions: rows.length,
    meaningfulStructuralSignatures: count(rows.map(structuralSignature)),
    macroFamilies: count(rows.map((row) => row.macroFamily)),
    globalLayoutCategoriesRepresented: count(rows.map((row) => row.layoutId)),
    rendererFamilies: count(rows.map((row) => row.rendererFamily)),
    compositionVariants: count(rows.map((row) => row.compositionVariant)),
    hierarchyTreatments: count(rows.map((row) => row.hierarchyTreatment)),
    panelStructures: count(rows.map((row) => row.panelStructure)),
    typographyTreatments: count(rows.map((row) => row.typographyTreatment)),
    selectorPresentations: count(rows.map((row) => row.selectorPresentation)),
    benefitTreatments: count(rows.map((row) => row.benefitTreatment)),
    backgroundTreatments: count(rows.map((row) => row.backgroundTreatment)),
    ctaTreatments: count(rows.map((row) => row.ctaTreatment)),
    rawPermutationLowerBound: rawPermutationLowerBound(lane, rows),
  }];
}));

const report = {
  generatedAt: new Date().toISOString(), stage1ReadOnlyFinding: {
    conclusion: "PREVIOUS_TOTALS_WERE_THEME_PERMUTATIONS_NOT_GENUINE_FEED_VISIBLE_DEPTH",
    method: "Removed palette/background/theme aliases and counted macro/layout/renderer/hierarchy/panel/selector structure.",
    before,
  },
  expandedArchitecture: {
    reusableCompositionComponents: 10,
    globalLayoutCategoriesDefined: 12,
    globalLayoutIds: ["hero_amount_age_grid", "audience_benefit_grid", "problem_consequence_offer", "portrait_hero_offer", "full_bleed_text_overlay", "notice_letter_paper", "family_lifestyle_offer", "comparison_two_column", "educational_explainer_card", "calculator_quiz_assessment", "ugc_talking_head", "agent_trust_explainer"],
    after,
    englishTargetPass: ["veteran", "final_expense", "mortgage", "iul", "trucker"].every((id) => after[id].meaningfulStructuralSignatures >= 100),
    spanishLaneTargetPass: ["spanish_final_expense", "spanish_mortgage", "spanish_iul", "spanish_veteran", "spanish_trucker"].every((id) => after[id].meaningfulStructuralSignatures >= 60),
  },
};
const output = path.resolve("artifacts/creative-intelligence/css-first-direct-response/depth-audit.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, ...report }, null, 2)}\n`);
