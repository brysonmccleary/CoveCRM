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
  compositionVariant: CssCompositionVariant;
  benefitTreatment: string;
  heroTreatment: string;
  whitespaceTreatment: string;
  paletteIndex: number;
  photoCompatible: boolean;
};

export type CssCompositionVariant =
  | "centered_offer_stack"
  | "selector_first_board"
  | "split_response_columns"
  | "framed_hero_notice"
  | "oversized_type_bleed"
  | "side_benefit_rail"
  | "editorial_notice_card"
  | "compact_action_grid"
  | "stepped_qualification"
  | "horizontal_action_strip";

type MacroBlueprint = {
  id: string;
  layoutId: LayoutId;
  rendererFamily: CssRendererFamily;
  hierarchyTreatment: string;
  panelStructure: string;
  selectorPresentation: string;
  photoCompatible?: boolean;
};

const COMPOSITIONS: Array<{
  id: CssCompositionVariant;
  background: string;
  typography: string;
  cta: string;
  frame: string;
  benefit: string;
  hero: string;
  whitespace: string;
}> = [
  { id: "centered_offer_stack", background: "navy_gradient", typography: "condensed_military", cta: "solid_bar", frame: "double_border", benefit: "stacked_checks", hero: "identity_then_offer", whitespace: "roomy_center" },
  { id: "selector_first_board", background: "clean_modern", typography: "bold_sans", cta: "arrow_bar", frame: "clean_card", benefit: "compact_footer", hero: "selector_then_headline", whitespace: "dense_board" },
  { id: "split_response_columns", background: "vertical_abstract", typography: "problem_first", cta: "contrast_bar", frame: "red_blue_frame", benefit: "paired_consequences", hero: "headline_then_split", whitespace: "balanced_split" },
  { id: "framed_hero_notice", background: "dark_texture", typography: "amount_first", cta: "gold_bar", frame: "gold_outline", benefit: "trust_ribbon", hero: "offer_inside_frame", whitespace: "formal_frame" },
  { id: "oversized_type_bleed", background: "vertical_abstract", typography: "condensed_military", cta: "contrast_bar", frame: "clean_card", benefit: "micro_chips", hero: "oversized_headline", whitespace: "edge_bleed" },
  { id: "side_benefit_rail", background: "navy_gradient", typography: "bold_sans", cta: "solid_bar", frame: "double_border", benefit: "vertical_rail", hero: "offer_beside_benefits", whitespace: "asymmetric" },
  { id: "editorial_notice_card", background: "paper_notice", typography: "notice_editorial", cta: "stamp_bar", frame: "paper_notice", benefit: "editorial_rules", hero: "notice_then_explanation", whitespace: "editorial" },
  { id: "compact_action_grid", background: "clean_modern", typography: "bold_sans", cta: "arrow_bar", frame: "clean_card", benefit: "icon_grid", hero: "compact_headline", whitespace: "compact_grid" },
  { id: "stepped_qualification", background: "dark_texture", typography: "problem_first", cta: "gold_bar", frame: "gold_outline", benefit: "numbered_steps", hero: "step_then_selector", whitespace: "guided_steps" },
  { id: "horizontal_action_strip", background: "navy_gradient", typography: "amount_first", cta: "contrast_bar", frame: "red_blue_frame", benefit: "horizontal_badges", hero: "offer_then_action_strip", whitespace: "wide_bands" },
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
  { id: "service_legacy", layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "service_legacy_steps", panelStructure: "three_step_diagram", selectorPresentation: "age_tiles" },
  { id: "eligibility_compare", layoutId: "educational_explainer_card", rendererFamily: "comparison_table", hierarchyTreatment: "eligibility_comparison_action", panelStructure: "comparison_columns", selectorPresentation: "qualification_strip" },
];

const FINAL_EXPENSE_MACROS: MacroBlueprint[] = [
  { id: "cost_amount_age", layoutId: "hero_amount_age_grid", rendererFamily: "amount_hero", hierarchyTreatment: "cost_amount_selector", panelStructure: "hero_amount_panel", selectorPresentation: "age_tiles" },
  { id: "family_burden", layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "burden_consequence_plan", panelStructure: "consequence_columns", selectorPresentation: "qualification_strip", photoCompatible: true },
  { id: "benefit_grid", layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "benefits_then_age", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "eligibility_notice", layoutId: "notice_letter_paper", rendererFamily: "aged_parchment", hierarchyTreatment: "notice_eligibility", panelStructure: "notice_box", selectorPresentation: "age_tiles" },
  { id: "coverage_compare", layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "comparison_action", panelStructure: "comparison_columns", selectorPresentation: "qualification_strip" },
  { id: "age_qualification", layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "age_first", panelStructure: "qualification_box", selectorPresentation: "large_age_buttons" },
  { id: "family_plan", layoutId: "family_lifestyle_offer", rendererFamily: "poster_stack", hierarchyTreatment: "family_plan_action", panelStructure: "photo_offer_stack", selectorPresentation: "age_tiles", photoCompatible: true },
  { id: "simple_steps", layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "three_steps_age", panelStructure: "three_step_diagram", selectorPresentation: "age_tiles" },
  { id: "amount_options", layoutId: "hero_amount_age_grid", rendererFamily: "price_table", hierarchyTreatment: "options_amount_age", panelStructure: "education_table", selectorPresentation: "age_tiles" },
  { id: "response_card", layoutId: "audience_benefit_grid", rendererFamily: "premium_dark_gold", hierarchyTreatment: "response_benefits_action", panelStructure: "trust_strip_benefits", selectorPresentation: "qualification_strip" },
];

const MORTGAGE_MACROS: MacroBlueprint[] = [
  { id: "home_consequence", layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "home_problem_response", panelStructure: "consequence_columns", selectorPresentation: "balance_strip", photoCompatible: true },
  { id: "balance_selector", layoutId: "hero_amount_age_grid", rendererFamily: "homeowner_table", hierarchyTreatment: "balance_first", panelStructure: "balance_table", selectorPresentation: "balance_tiles" },
  { id: "home_benefits", layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "home_benefit_action", panelStructure: "benefit_grid", selectorPresentation: "balance_tiles" },
  { id: "homeowner_notice", layoutId: "notice_letter_paper", rendererFamily: "aged_parchment", hierarchyTreatment: "notice_home_action", panelStructure: "notice_box", selectorPresentation: "balance_strip" },
  { id: "with_without", layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "comparison_home", panelStructure: "comparison_columns", selectorPresentation: "balance_strip" },
  { id: "family_home", layoutId: "family_lifestyle_offer", rendererFamily: "poster_stack", hierarchyTreatment: "family_home_offer", panelStructure: "photo_offer_stack", selectorPresentation: "balance_tiles", photoCompatible: true },
  { id: "mortgage_steps", layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "balance_steps_action", panelStructure: "three_step_diagram", selectorPresentation: "balance_strip" },
  { id: "equity_notice", layoutId: "notice_letter_paper", rendererFamily: "patriotic_notice", hierarchyTreatment: "home_equity_notice", panelStructure: "notice_box", selectorPresentation: "balance_tiles" },
  { id: "balance_quiz", layoutId: "calculator_quiz_assessment", rendererFamily: "quiz_card", hierarchyTreatment: "balance_assessment_first", panelStructure: "assessment_box", selectorPresentation: "balance_tiles" },
  { id: "home_offer_stack", layoutId: "hero_amount_age_grid", rendererFamily: "premium_dark_gold", hierarchyTreatment: "home_offer_balance", panelStructure: "ornate_offer_frame", selectorPresentation: "balance_strip" },
];

const IUL_MACROS: MacroBlueprint[] = [
  { id: "cash_value_education", layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "education_steps", panelStructure: "three_step_diagram", selectorPresentation: "assessment_tiles" },
  { id: "retirement_comparison", layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "comparison_education", panelStructure: "comparison_columns", selectorPresentation: "assessment_strip" },
  { id: "legacy_benefits", layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "legacy_benefits", panelStructure: "benefit_grid", selectorPresentation: "assessment_tiles", photoCompatible: true },
  { id: "planning_assessment", layoutId: "calculator_quiz_assessment", rendererFamily: "quiz_card", hierarchyTreatment: "assessment_first", panelStructure: "assessment_box", selectorPresentation: "large_assessment_buttons" },
  { id: "policy_mechanics", layoutId: "educational_explainer_card", rendererFamily: "price_table", hierarchyTreatment: "mechanics_table", panelStructure: "education_table", selectorPresentation: "assessment_strip" },
  { id: "future_consequence", layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "future_problem_education", panelStructure: "consequence_columns", selectorPresentation: "assessment_strip" },
  { id: "index_basics", layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "index_basics_steps", panelStructure: "three_step_diagram", selectorPresentation: "assessment_tiles" },
  { id: "protection_growth", layoutId: "comparison_two_column", rendererFamily: "price_table", hierarchyTreatment: "protection_growth_compare", panelStructure: "education_table", selectorPresentation: "assessment_strip" },
  { id: "goal_selector", layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "goal_selector_first", panelStructure: "qualification_box", selectorPresentation: "large_assessment_buttons" },
  { id: "planning_notice", layoutId: "educational_explainer_card", rendererFamily: "aged_parchment", hierarchyTreatment: "planning_notice_education", panelStructure: "notice_box", selectorPresentation: "assessment_strip" },
];

const TRUCKER_MACROS: MacroBlueprint[] = [
  { id: "driver_identity", layoutId: "hero_amount_age_grid", rendererFamily: "amount_hero", hierarchyTreatment: "driver_amount_age", panelStructure: "hero_amount_panel", selectorPresentation: "age_tiles" },
  { id: "driver_benefits", layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "driver_benefits", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "highway_offer", layoutId: "full_bleed_text_overlay", rendererFamily: "trucker_highway", hierarchyTreatment: "road_identity_offer", panelStructure: "highway_offer", selectorPresentation: "qualification_strip", photoCompatible: true },
  { id: "income_consequence", layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "income_problem_response", panelStructure: "consequence_columns", selectorPresentation: "qualification_strip" },
  { id: "cdl_qualification", layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "occupation_first", panelStructure: "qualification_box", selectorPresentation: "occupation_buttons" },
  { id: "family_home_base", layoutId: "family_lifestyle_offer", rendererFamily: "poster_stack", hierarchyTreatment: "family_income_offer", panelStructure: "photo_offer_stack", selectorPresentation: "age_tiles", photoCompatible: true },
  { id: "owner_operator_plan", layoutId: "educational_explainer_card", rendererFamily: "comparison_table", hierarchyTreatment: "owner_operator_compare", panelStructure: "comparison_columns", selectorPresentation: "occupation_buttons" },
  { id: "route_notice", layoutId: "notice_letter_paper", rendererFamily: "aged_parchment", hierarchyTreatment: "route_notice_action", panelStructure: "notice_box", selectorPresentation: "occupation_buttons" },
  { id: "driver_steps", layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "driver_steps_action", panelStructure: "three_step_diagram", selectorPresentation: "occupation_buttons" },
  { id: "coverage_selector", layoutId: "hero_amount_age_grid", rendererFamily: "price_table", hierarchyTreatment: "coverage_selector_offer", panelStructure: "education_table", selectorPresentation: "age_tiles" },
];

const SPANISH_MACROS: Array<MacroBlueprint & { vertical: CreativeVertical; audiences: CreativeAudienceSegment[] }> = [
  { id: "familia_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "familia_consecuencia_opciones", panelStructure: "consequence_columns", selectorPresentation: "age_tiles" },
  { id: "edad_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "edad_primero", panelStructure: "qualification_box", selectorPresentation: "large_age_buttons" },
  { id: "comparar_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "comparison_two_column", rendererFamily: "comparison_table", hierarchyTreatment: "comparacion_accion", panelStructure: "comparison_columns", selectorPresentation: "qualification_strip" },
  { id: "beneficios_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "beneficios_edad", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "aviso_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "notice_letter_paper", rendererFamily: "aged_parchment", hierarchyTreatment: "aviso_elegibilidad", panelStructure: "notice_box", selectorPresentation: "age_tiles" },
  { id: "pasos_gastos", vertical: "final_expense", audiences: ["spanish"], layoutId: "educational_explainer_card", rendererFamily: "clean_white_diagram", hierarchyTreatment: "pasos_familia_opciones", panelStructure: "three_step_diagram", selectorPresentation: "age_tiles" },
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
  { id: "iul_mecanica", vertical: "iul", audiences: ["spanish"], layoutId: "educational_explainer_card", rendererFamily: "price_table", hierarchyTreatment: "mecanica_educacion", panelStructure: "education_table", selectorPresentation: "assessment_strip" },
  { id: "familia_veterana", vertical: "veteran", audiences: ["veteran", "spanish"], layoutId: "audience_benefit_grid", rendererFamily: "patriotic_notice", hierarchyTreatment: "identidad_familia_opciones", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "plan_veterano", vertical: "veteran", audiences: ["veteran", "spanish"], layoutId: "problem_consequence_offer", rendererFamily: "split_panel", hierarchyTreatment: "identidad_consecuencia_plan", panelStructure: "consequence_columns", selectorPresentation: "age_tiles" },
  { id: "hogar_veterano", vertical: "veteran", audiences: ["veteran", "spanish"], layoutId: "family_lifestyle_offer", rendererFamily: "poster_stack", hierarchyTreatment: "familia_veterana_plan", panelStructure: "photo_offer_stack", selectorPresentation: "age_tiles" },
  { id: "edad_veterana", vertical: "veteran", audiences: ["veteran", "spanish"], layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "edad_veterana_primero", panelStructure: "qualification_box", selectorPresentation: "large_age_buttons" },
  { id: "aviso_veterano", vertical: "veteran", audiences: ["veteran", "spanish"], layoutId: "notice_letter_paper", rendererFamily: "patriotic_notice", hierarchyTreatment: "aviso_servicio_accion", panelStructure: "notice_box", selectorPresentation: "age_tiles" },
  { id: "comparar_veterano", vertical: "veteran", audiences: ["veteran", "spanish"], layoutId: "educational_explainer_card", rendererFamily: "comparison_table", hierarchyTreatment: "comparar_opciones_veterano", panelStructure: "comparison_columns", selectorPresentation: "qualification_strip" },
  { id: "conductor_familia", vertical: "trucker", audiences: ["trucker", "spanish"], layoutId: "problem_consequence_offer", rendererFamily: "trucker_highway", hierarchyTreatment: "conductor_familia_opciones", panelStructure: "highway_offer", selectorPresentation: "age_tiles" },
  { id: "conductor_beneficios", vertical: "trucker", audiences: ["trucker", "spanish"], layoutId: "audience_benefit_grid", rendererFamily: "benefit_grid", hierarchyTreatment: "conductor_beneficios_opciones", panelStructure: "benefit_grid", selectorPresentation: "age_tiles" },
  { id: "conductor_ruta", vertical: "trucker", audiences: ["trucker", "spanish"], layoutId: "full_bleed_text_overlay", rendererFamily: "amount_hero", hierarchyTreatment: "ruta_identidad_accion", panelStructure: "hero_amount_panel", selectorPresentation: "age_tiles" },
  { id: "conductor_edad", vertical: "trucker", audiences: ["trucker", "spanish"], layoutId: "calculator_quiz_assessment", rendererFamily: "age_selector", hierarchyTreatment: "edad_conductor_primero", panelStructure: "qualification_box", selectorPresentation: "large_age_buttons" },
  { id: "conductor_aviso", vertical: "trucker", audiences: ["trucker", "spanish"], layoutId: "full_bleed_text_overlay", rendererFamily: "aged_parchment", hierarchyTreatment: "aviso_conductor_accion", panelStructure: "notice_box", selectorPresentation: "occupation_buttons" },
  { id: "conductor_compara", vertical: "trucker", audiences: ["trucker", "spanish"], layoutId: "educational_explainer_card", rendererFamily: "comparison_table", hierarchyTreatment: "comparar_conductor", panelStructure: "comparison_columns", selectorPresentation: "occupation_buttons" },
];

function buildExecutions(input: {
  prefix: string;
  vertical: CreativeVertical;
  audiences: CreativeAudienceSegment[];
  language: CreativeLanguage;
  macros: MacroBlueprint[];
}): CssExecutionDefinition[] {
  return input.macros.flatMap((macro, macroIndex) => COMPOSITIONS.map((composition, compositionIndex) => ({
    executionId: `${input.prefix}_${String(macroIndex + 1).padStart(2, "0")}_${composition.id}`,
    vertical: input.vertical,
    audienceSegments: input.audiences,
    language: input.language,
    macroFamily: macro.id,
    layoutId: macro.layoutId,
    rendererFamily: macro.rendererFamily,
    hierarchyTreatment: macro.hierarchyTreatment,
    panelStructure: macro.panelStructure,
    backgroundTreatment: composition.background,
    typographyTreatment: composition.typography,
    selectorPresentation: macro.selectorPresentation,
    ctaTreatment: composition.cta,
    frameTreatment: composition.frame,
    compositionVariant: composition.id,
    benefitTreatment: composition.benefit,
    heroTreatment: composition.hero,
    whitespaceTreatment: composition.whitespace,
    paletteIndex: compositionIndex % 5,
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

const SPANISH_EXECUTIONS: CssExecutionDefinition[] = SPANISH_MACROS.flatMap((macro, macroIndex) => COMPOSITIONS.map((composition, compositionIndex) => ({
  executionId: `ES_CSS_${String(macroIndex + 1).padStart(2, "0")}_${composition.id}`,
  vertical: macro.vertical,
  audienceSegments: macro.audiences,
  language: "es" as const,
  macroFamily: macro.id,
  layoutId: macro.layoutId,
  rendererFamily: macro.rendererFamily,
  hierarchyTreatment: macro.hierarchyTreatment,
  panelStructure: macro.panelStructure,
  backgroundTreatment: composition.background,
  typographyTreatment: composition.typography,
  selectorPresentation: macro.selectorPresentation,
  ctaTreatment: composition.cta,
  frameTreatment: composition.frame,
  compositionVariant: composition.id,
  benefitTreatment: composition.benefit,
  heroTreatment: composition.hero,
  whitespaceTreatment: composition.whitespace,
  paletteIndex: compositionIndex % 5,
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
