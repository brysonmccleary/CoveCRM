import type {
  CreativeAudienceSegment,
  CreativeLanguage,
  CreativeVertical,
  LayoutId,
} from "./types";

export type CssRendererFamily =
  | "amount_hero"
  | "age_selector"
  | "benefit_grid"
  | "split_panel"
  | "aged_parchment"
  | "premium_dark_gold"
  | "patriotic_notice"
  | "comparison_table"
  | "clean_white_diagram"
  | "price_table"
  | "homeowner_table"
  | "trucker_highway"
  | "ornate_gold_frame"
  | "quiz_card"
  | "poster_stack";

export type CssExecutionDefinition = {
  executionId: string;
  vertical: CreativeVertical;
  audienceSegments: CreativeAudienceSegment[];
  language: CreativeLanguage;
  macroFamily: string;
  layoutId: LayoutId;
  rendererFamily: CssRendererFamily;
  hierarchyTreatment: string;
  panelStructure: string;
  backgroundTreatment: string;
  typographyTreatment: string;
  selectorPresentation: string;
  ctaTreatment: string;
  frameTreatment: string;
  paletteIndex: number;
  photoCompatible: boolean;
};

type MacroBlueprint = {
  id: string;
  layoutId: LayoutId;
  rendererFamily: CssRendererFamily;
  hierarchyTreatment: string;
  panelStructure: string;
  selectorPresentation: string;
  photoCompatible?: boolean;
};

const THEMES = [
  { id: "navy_command", background: "navy_gradient", typography: "condensed_military", cta: "solid_bar", frame: "double_border" },
  { id: "clean_response", background: "clean_modern", typography: "bold_sans", cta: "arrow_bar", frame: "clean_card" },
  { id: "notice_paper", background: "paper_notice", typography: "notice_editorial", cta: "stamp_bar", frame: "paper_notice" },
  { id: "dark_premium", background: "dark_texture", typography: "amount_first", cta: "gold_bar", frame: "gold_outline" },
  { id: "high_contrast", background: "vertical_abstract", typography: "problem_first", cta: "contrast_bar", frame: "red_blue_frame" },
] as const;

const VETERAN_MACROS: MacroBlueprint[] = [
  { id: "identity_amount_age", layoutId: "hero_amount_age_grid", rendererFamily: "amount_hero", hierarchyTreatment: "identity_amount_selector", panelStructure: "hero_amount_panel", selectorPresentation: "age_tiles", photoCompatible: true },
  { id: "identity_benefit_grid", layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "identity_benefits_selector", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "va_final_cost_gap", layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "problem_consequence_response", panelStructure: "consequence_columns", selectorPresentation: "qualification_strip", photoCompatible: true },
  { id: "age_first", layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "selector_first", panelStructure: "qualification_box", selectorPresentation: "large_age_buttons", photoCompatible: true },
  { id: "amount_first", layoutId: "hero_amount_age_grid", rendererFamily: "ornate_gold_frame", hierarchyTreatment: "amount_first", panelStructure: "ornate_offer_frame", selectorPresentation: "age_tiles" },
  { id: "notice", layoutId: "notice_letter_paper", rendererFamily: "patriotic_notice", hierarchyTreatment: "notice_problem_action", panelStructure: "notice_box", selectorPresentation: "qualification_strip" },
  { id: "spouse_family", layoutId: "audience_benefit_grid", rendererFamily: "premium_dark_gold", hierarchyTreatment: "family_benefit_action", panelStructure: "trust_strip_benefits", selectorPresentation: "age_tiles", photoCompatible: true },
  { id: "problem_consequence", layoutId: "problem_consequence_offer", rendererFamily: "aged_parchment", hierarchyTreatment: "consequence_offer", panelStructure: "paper_problem_card", selectorPresentation: "qualification_strip" },
];

const FINAL_EXPENSE_MACROS: MacroBlueprint[] = [
  { id: "cost_amount_age", layoutId: "hero_amount_age_grid", rendererFamily: "amount_hero", hierarchyTreatment: "cost_amount_selector", panelStructure: "hero_amount_panel", selectorPresentation: "age_tiles" },
  { id: "family_burden", layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "burden_consequence_plan", panelStructure: "consequence_columns", selectorPresentation: "qualification_strip", photoCompatible: true },
  { id: "benefit_grid", layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "benefits_then_age", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "eligibility_notice", layoutId: "notice_letter_paper", rendererFamily: "aged_parchment", hierarchyTreatment: "notice_eligibility", panelStructure: "notice_box", selectorPresentation: "age_tiles" },
  { id: "coverage_compare", layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "comparison_action", panelStructure: "comparison_columns", selectorPresentation: "qualification_strip" },
  { id: "age_qualification", layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "age_first", panelStructure: "qualification_box", selectorPresentation: "large_age_buttons" },
];

const MORTGAGE_MACROS: MacroBlueprint[] = [
  { id: "home_consequence", layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "home_problem_response", panelStructure: "consequence_columns", selectorPresentation: "balance_strip", photoCompatible: true },
  { id: "balance_selector", layoutId: "hero_amount_age_grid", rendererFamily: "homeowner_table", hierarchyTreatment: "balance_first", panelStructure: "balance_table", selectorPresentation: "balance_tiles" },
  { id: "home_benefits", layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "home_benefit_action", panelStructure: "benefit_grid", selectorPresentation: "balance_tiles" },
  { id: "homeowner_notice", layoutId: "notice_letter_paper", rendererFamily: "aged_parchment", hierarchyTreatment: "notice_home_action", panelStructure: "notice_box", selectorPresentation: "balance_strip" },
  { id: "with_without", layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "comparison_home", panelStructure: "comparison_columns", selectorPresentation: "balance_strip" },
  { id: "family_home", layoutId: "family_lifestyle_offer", rendererFamily: "poster_stack", hierarchyTreatment: "family_home_offer", panelStructure: "photo_offer_stack", selectorPresentation: "balance_tiles", photoCompatible: true },
];

const IUL_MACROS: MacroBlueprint[] = [
  { id: "cash_value_education", layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "education_steps", panelStructure: "three_step_diagram", selectorPresentation: "assessment_tiles" },
  { id: "retirement_comparison", layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "comparison_education", panelStructure: "comparison_columns", selectorPresentation: "assessment_strip" },
  { id: "legacy_benefits", layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "legacy_benefits", panelStructure: "benefit_grid", selectorPresentation: "assessment_tiles", photoCompatible: true },
  { id: "planning_assessment", layoutId: "calculator_quiz_assessment", rendererFamily: "quiz_card", hierarchyTreatment: "assessment_first", panelStructure: "assessment_box", selectorPresentation: "large_assessment_buttons" },
  { id: "policy_mechanics", layoutId: "educational_explainer_card", rendererFamily: "price_table", hierarchyTreatment: "mechanics_table", panelStructure: "education_table", selectorPresentation: "assessment_strip" },
  { id: "future_consequence", layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "future_problem_education", panelStructure: "consequence_columns", selectorPresentation: "assessment_strip" },
];

const TRUCKER_MACROS: MacroBlueprint[] = [
  { id: "driver_identity", layoutId: "hero_amount_age_grid", rendererFamily: "amount_hero", hierarchyTreatment: "driver_amount_age", panelStructure: "hero_amount_panel", selectorPresentation: "age_tiles" },
  { id: "driver_benefits", layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "driver_benefits", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "highway_offer", layoutId: "full_bleed_text_overlay", rendererFamily: "trucker_highway", hierarchyTreatment: "road_identity_offer", panelStructure: "highway_offer", selectorPresentation: "qualification_strip", photoCompatible: true },
  { id: "income_consequence", layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "income_problem_response", panelStructure: "consequence_columns", selectorPresentation: "qualification_strip" },
  { id: "cdl_qualification", layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "occupation_first", panelStructure: "qualification_box", selectorPresentation: "occupation_buttons" },
  { id: "family_home_base", layoutId: "family_lifestyle_offer", rendererFamily: "poster_stack", hierarchyTreatment: "family_income_offer", panelStructure: "photo_offer_stack", selectorPresentation: "age_tiles", photoCompatible: true },
];

const SPANISH_MACROS: Array<MacroBlueprint & { vertical: CreativeVertical; audiences: CreativeAudienceSegment[] }> = [
  { id: "familia_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "familia_consecuencia_opciones", panelStructure: "consequence_columns", selectorPresentation: "age_tiles" },
  { id: "edad_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "edad_primero", panelStructure: "qualification_box", selectorPresentation: "large_age_buttons" },
  { id: "comparar_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "comparacion_accion", panelStructure: "comparison_columns", selectorPresentation: "qualification_strip" },
  { id: "beneficios_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "beneficios_edad", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "aviso_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "notice_letter_paper", rendererFamily: "aged_parchment", hierarchyTreatment: "aviso_elegibilidad", panelStructure: "notice_box", selectorPresentation: "age_tiles" },
  { id: "hogar_familia", vertical: "mortgage_protection", audiences: ["spanish"], layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "hogar_beneficios_opciones", panelStructure: "benefit_grid", selectorPresentation: "balance_tiles" },
  { id: "hogar_evaluacion", vertical: "mortgage_protection", audiences: ["spanish"], layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "hogar_pasos_opciones", panelStructure: "three_step_diagram", selectorPresentation: "balance_strip" },
  { id: "hogar_saldo", vertical: "mortgage_protection", audiences: ["spanish"], layoutId: "hero_amount_age_grid", rendererFamily: "homeowner_table", hierarchyTreatment: "saldo_primero", panelStructure: "balance_table", selectorPresentation: "balance_tiles" },
  { id: "hogar_consecuencia", vertical: "mortgage_protection", audiences: ["spanish"], layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "problema_hogar_plan", panelStructure: "consequence_columns", selectorPresentation: "balance_strip" },
  { id: "hogar_comparacion", vertical: "mortgage_protection", audiences: ["spanish"], layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "comparacion_hogar", panelStructure: "comparison_columns", selectorPresentation: "balance_strip" },
  { id: "hogar_aviso", vertical: "mortgage_protection", audiences: ["spanish"], layoutId: "notice_letter_paper", rendererFamily: "aged_parchment", hierarchyTreatment: "aviso_hogar", panelStructure: "notice_box", selectorPresentation: "balance_strip" },
  { id: "iul_educacion", vertical: "iul", audiences: ["spanish"], layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "educacion_pasos", panelStructure: "three_step_diagram", selectorPresentation: "assessment_tiles" },
  { id: "iul_legado", vertical: "iul", audiences: ["spanish"], layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "legado_comparacion", panelStructure: "comparison_columns", selectorPresentation: "assessment_strip" },
  { id: "iul_evaluacion", vertical: "iul", audiences: ["spanish"], layoutId: "calculator_quiz_assessment", rendererFamily: "quiz_card", hierarchyTreatment: "evaluacion_primero", panelStructure: "assessment_box", selectorPresentation: "large_assessment_buttons" },
  { id: "iul_riesgo", vertical: "iul", audiences: ["spanish"], layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "riesgo_educacion", panelStructure: "consequence_columns", selectorPresentation: "assessment_strip" },
  { id: "iul_beneficios", vertical: "iul", audiences: ["spanish"], layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "beneficios_legado", panelStructure: "benefit_grid", selectorPresentation: "assessment_tiles" },
  { id: "familia_veterana", vertical: "veteran", audiences: ["veteran", "spanish"], layoutId: "audience_benefit_grid", rendererFamily: "patriotic_notice", hierarchyTreatment: "identidad_familia_opciones", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "plan_veterano", vertical: "veteran", audiences: ["veteran", "spanish"], layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "identidad_consecuencia_plan", panelStructure: "consequence_columns", selectorPresentation: "age_tiles" },
  { id: "hogar_veterano", vertical: "veteran", audiences: ["veteran", "spanish"], layoutId: "family_lifestyle_offer", rendererFamily: "poster_stack", hierarchyTreatment: "familia_veterana_plan", panelStructure: "photo_offer_stack", selectorPresentation: "age_tiles" },
  { id: "conductor_familia", vertical: "trucker", audiences: ["trucker", "spanish"], layoutId: "problem_consequence_offer", rendererFamily: "trucker_highway", hierarchyTreatment: "conductor_familia_opciones", panelStructure: "highway_offer", selectorPresentation: "age_tiles" },
  { id: "conductor_beneficios", vertical: "trucker", audiences: ["trucker", "spanish"], layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "conductor_beneficios_opciones", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "conductor_ruta", vertical: "trucker", audiences: ["trucker", "spanish"], layoutId: "full_bleed_text_overlay", rendererFamily: "amount_hero", hierarchyTreatment: "ruta_identidad_accion", panelStructure: "hero_amount_panel", selectorPresentation: "age_tiles" },
];

function buildExecutions(input: {
  prefix: string;
  vertical: CreativeVertical;
  audiences: CreativeAudienceSegment[];
  language: CreativeLanguage;
  macros: MacroBlueprint[];
}): CssExecutionDefinition[] {
  return input.macros.flatMap((macro, macroIndex) => THEMES.map((theme, themeIndex) => ({
    executionId: `${input.prefix}_${String(macroIndex + 1).padStart(2, "0")}_${theme.id}`,
    vertical: input.vertical,
    audienceSegments: input.audiences,
    language: input.language,
    macroFamily: macro.id,
    layoutId: macro.layoutId,
    rendererFamily: macro.rendererFamily,
    hierarchyTreatment: macro.hierarchyTreatment,
    panelStructure: macro.panelStructure,
    backgroundTreatment: theme.background,
    typographyTreatment: theme.typography,
    selectorPresentation: macro.selectorPresentation,
    ctaTreatment: theme.cta,
    frameTreatment: theme.frame,
    paletteIndex: themeIndex,
    photoCompatible: Boolean(macro.photoCompatible),
  })));
}

const ENGLISH_EXECUTIONS = [
  ...buildExecutions({ prefix: "VET_CSS", vertical: "veteran", audiences: ["veteran"], language: "en", macros: VETERAN_MACROS }),
  ...buildExecutions({ prefix: "FE_CSS", vertical: "final_expense", audiences: ["standard", "veteran", "trucker"], language: "en", macros: FINAL_EXPENSE_MACROS }),
  ...buildExecutions({ prefix: "MP_CSS", vertical: "mortgage_protection", audiences: ["standard", "veteran", "trucker"], language: "en", macros: MORTGAGE_MACROS }),
  ...buildExecutions({ prefix: "IUL_CSS", vertical: "iul", audiences: ["standard", "veteran", "trucker"], language: "en", macros: IUL_MACROS }),
  ...buildExecutions({ prefix: "TRK_CSS", vertical: "trucker", audiences: ["trucker"], language: "en", macros: TRUCKER_MACROS }),
];

const SPANISH_EXECUTIONS: CssExecutionDefinition[] = SPANISH_MACROS.flatMap((macro, macroIndex) => THEMES.map((theme, themeIndex) => ({
  executionId: `ES_CSS_${String(macroIndex + 1).padStart(2, "0")}_${theme.id}`,
  vertical: macro.vertical,
  audienceSegments: macro.audiences,
  language: "es" as const,
  macroFamily: macro.id,
  layoutId: macro.layoutId,
  rendererFamily: macro.rendererFamily,
  hierarchyTreatment: macro.hierarchyTreatment,
  panelStructure: macro.panelStructure,
  backgroundTreatment: theme.background,
  typographyTreatment: theme.typography,
  selectorPresentation: macro.selectorPresentation,
  ctaTreatment: theme.cta,
  frameTreatment: theme.frame,
  paletteIndex: themeIndex,
  photoCompatible: false,
})));

export const CSS_EXECUTIONS: CssExecutionDefinition[] = [...ENGLISH_EXECUTIONS, ...SPANISH_EXECUTIONS];

export function getEligibleCssExecutions(input: {
  vertical: CreativeVertical;
  audienceSegment: CreativeAudienceSegment;
  language: CreativeLanguage;
  compatibleLayouts?: LayoutId[];
}): CssExecutionDefinition[] {
  return CSS_EXECUTIONS.filter((execution) => execution.vertical === input.vertical
    && execution.language === input.language
    && execution.audienceSegments.includes(input.audienceSegment)
    && (!input.compatibleLayouts?.length || input.compatibleLayouts.includes(execution.layoutId)));
}

export function cssExecutionCounts() {
  return {
    veteran: CSS_EXECUTIONS.filter((execution) => execution.language === "en" && execution.vertical === "veteran").length,
    finalExpense: CSS_EXECUTIONS.filter((execution) => execution.language === "en" && execution.vertical === "final_expense").length,
    mortgage: CSS_EXECUTIONS.filter((execution) => execution.language === "en" && execution.vertical === "mortgage_protection").length,
    iul: CSS_EXECUTIONS.filter((execution) => execution.language === "en" && execution.vertical === "iul").length,
    trucker: CSS_EXECUTIONS.filter((execution) => execution.language === "en" && execution.vertical === "trucker").length,
    spanish: CSS_EXECUTIONS.filter((execution) => execution.language === "es").length,
  };
}
