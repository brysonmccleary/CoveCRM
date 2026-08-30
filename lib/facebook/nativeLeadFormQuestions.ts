export type NativeLeadFormQuestion = {
  type: string;
  label?: string;
  key?: string;
  options?: Array<{ key: string; value: string }>;
};

const AGE_RANGE_OPTIONS = [
  { key: "18_39", value: "18-39" },
  { key: "40_49", value: "40-49" },
  { key: "50_59", value: "50-59" },
  { key: "60_69", value: "60-69" },
  { key: "70_79", value: "70-79" },
  { key: "80_plus", value: "80+" },
];

const COVERAGE_RANGE_OPTIONS = [
  { key: "10000_24999", value: "$10,000-$24,999" },
  { key: "25000_49999", value: "$25,000-$49,999" },
  { key: "50000_99999", value: "$50,000-$99,999" },
  { key: "100000_plus", value: "$100,000+" },
];

const VETERAN_COVERAGE_SUBJECT_OPTIONS = [
  { key: "veteran", value: "Veteran" },
  { key: "spouse", value: "Spouse" },
  { key: "military_family_dependent", value: "Military family / dependent" },
];

function standardContactQuestions(): NativeLeadFormQuestion[] {
  return [
    { type: "FULL_NAME" },
    { type: "PHONE" },
    { type: "EMAIL" },
    { type: "STATE" },
  ];
}

function ageRangeQuestion(label = "What is your age range?"): NativeLeadFormQuestion {
  return { type: "CUSTOM", label, key: "age", options: AGE_RANGE_OPTIONS };
}

export function buildNativeLeadFormQuestions(input: {
  leadType: string;
  audienceSegment: string;
  spanish?: boolean;
}): NativeLeadFormQuestion[] {
  const spanish = Boolean(input.spanish);

  if (input.leadType === "veteran") {
    return [
      ...standardContactQuestions(),
      ageRangeQuestion(spanish ? "¿Cuál es su rango de edad?" : "What is your age range?"),
      {
        type: "CUSTOM",
        label: spanish ? "¿Quién necesita la cobertura?" : "Who needs coverage?",
        key: "who_needs_coverage",
        options: VETERAN_COVERAGE_SUBJECT_OPTIONS,
      },
      {
        type: "CUSTOM",
        label: spanish ? "¿Cuánta cobertura desea revisar?" : "How much coverage would you like to review?",
        key: "coverage_amount",
        options: COVERAGE_RANGE_OPTIONS,
      },
    ];
  }

  const leadSpecific: Record<string, NativeLeadFormQuestion> = spanish
    ? {
        mortgage_protection: { type: "CUSTOM", label: "¿Cuál es el saldo aproximado de su hipoteca?", key: "mortgage_balance" },
        final_expense: { type: "CUSTOM", label: "¿Qué cantidad de cobertura le interesa?", key: "coverage_amount" },
        iul: { type: "CUSTOM", label: "¿Busca protección, potencial de valor en efectivo o ambos?", key: "iul_goal" },
        trucker: { type: "CUSTOM", label: "¿Actualmente conduce con licencia CDL?", key: "cdl_driver_status" },
      }
    : {
        mortgage_protection: { type: "CUSTOM", label: "What is your mortgage balance?", key: "mortgage_balance" },
        final_expense: { type: "CUSTOM", label: "What coverage amount are you interested in?", key: "coverage_amount" },
        iul: { type: "CUSTOM", label: "Are you looking for protection, cash value growth, or both?", key: "iul_goal" },
        trucker: { type: "CUSTOM", label: "Are you currently an active CDL driver?", key: "cdl_driver_status" },
      };

  return [
    ...standardContactQuestions(),
    ageRangeQuestion(spanish ? "¿Cuál es su rango de edad?" : "What is your age range?"),
    leadSpecific[input.leadType] || {
      type: "CUSTOM",
      label: spanish ? "¿Qué le interesa más?" : "What are you most interested in?",
      key: "lead_question",
    },
  ];
}

