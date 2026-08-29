import type {
  CreativeAudienceSegment,
  CreativeLanguage,
  CreativeVertical,
  SelectorContract,
  SelectorType,
} from "./types";

export type RendererCopy = {
  notice: string;
  coverageNotice: string;
  homeownerNotice: string;
  review: string;
  options: string;
  education: string;
  videoFramework: string;
  licensedAgentExplainer: string;
  whatToReview: string;
  howItWorks: string;
  keyTradeoffs: string;
  requestEducation: string;
  compareOptions: string;
  coverageFit: string;
  familyGoals: string;
  nextStep: string;
  privateCoverage: string;
  availabilityDisclosure: string;
  coverageOptionsUpTo: string;
  amountDisclosure: string;
};

const COPY: Record<CreativeLanguage, RendererCopy> = {
  en: {
    notice: "ELIGIBILITY NOTICE",
    coverageNotice: "COVERAGE REVIEW NOTICE",
    homeownerNotice: "HOMEOWNER COVERAGE NOTICE",
    review: "REVIEW",
    options: "OPTIONS",
    education: "EDUCATION",
    videoFramework: "VIDEO EXPLAINER FRAMEWORK",
    licensedAgentExplainer: "LICENSED AGENT EXPLAINER",
    whatToReview: "WHAT TO REVIEW",
    howItWorks: "HOW IT WORKS",
    keyTradeoffs: "KEY TRADEOFFS",
    requestEducation: "REQUEST EDUCATION",
    compareOptions: "Compare options",
    coverageFit: "Coverage fit",
    familyGoals: "Family priorities",
    nextStep: "Clear next step",
    privateCoverage: "PRIVATE COVERAGE REVIEW",
    availabilityDisclosure: "Availability and eligibility vary by state and product. Not affiliated with any government agency.",
    coverageOptionsUpTo: "COVERAGE OPTIONS UP TO",
    amountDisclosure: "Availability varies by carrier, state, age, health, and underwriting.",
  },
  es: {
    notice: "AVISO DE ELEGIBILIDAD",
    coverageNotice: "AVISO DE REVISIÓN DE COBERTURA",
    homeownerNotice: "AVISO DE COBERTURA PARA PROPIETARIOS",
    review: "REVISIÓN",
    options: "OPCIONES",
    education: "EDUCACIÓN",
    videoFramework: "FORMATO DE VIDEO EXPLICATIVO",
    licensedAgentExplainer: "EXPLICACIÓN DE UN AGENTE CON LICENCIA",
    whatToReview: "QUÉ REVISAR",
    howItWorks: "CÓMO FUNCIONA",
    keyTradeoffs: "PUNTOS IMPORTANTES",
    requestEducation: "SOLICITAR ORIENTACIÓN",
    compareOptions: "Comparar opciones",
    coverageFit: "Ajuste de cobertura",
    familyGoals: "Prioridades familiares",
    nextStep: "Próximo paso claro",
    privateCoverage: "REVISIÓN DE COBERTURA PRIVADA",
    availabilityDisclosure: "La disponibilidad y elegibilidad varían según el estado y el producto. No está afiliado con ninguna agencia gubernamental.",
    coverageOptionsUpTo: "OPCIONES DE COBERTURA HASTA",
    amountDisclosure: "La disponibilidad varía según la compañía, el estado, la edad, la salud y la evaluación.",
  },
};

export function getRendererCopy(language: CreativeLanguage): RendererCopy {
  return COPY[language] || COPY.en;
}

export function getVisibleIdentityLabel(input: {
  vertical: CreativeVertical | string;
  audienceSegment: CreativeAudienceSegment | string;
  language: CreativeLanguage;
}): string {
  const { vertical, audienceSegment, language } = input;
  const veteran = audienceSegment === "veteran" || vertical === "veteran";
  const trucker = audienceSegment === "trucker" || vertical === "trucker";
  const prefix = language === "es"
    ? veteran ? "VETERANOS + " : trucker ? "CONDUCTORES CDL + " : ""
    : veteran ? "VETERANS + " : trucker ? "CDL DRIVERS + " : "";
  const product = language === "es"
    ? vertical === "mortgage_protection" ? "PROTECCIÓN HIPOTECARIA"
      : vertical === "iul" ? "EDUCACIÓN IUL"
        : vertical === "final_expense" ? "GASTOS FINALES"
          : vertical === "trucker" ? "SEGURO DE VIDA"
            : "SEGURO DE VIDA"
    : vertical === "mortgage_protection" ? "MORTGAGE PROTECTION"
      : vertical === "iul" ? "IUL EDUCATION"
        : vertical === "final_expense" ? "FINAL EXPENSE INSURANCE"
          : vertical === "trucker" ? "LIFE INSURANCE"
            : "LIFE INSURANCE";
  return `${prefix}${product}`;
}

const SPANISH_SELECTOR_COPY: Record<SelectorType, { label: string; options?: Record<string, string> }> = {
  age_range: { label: "Seleccione su rango de edad" },
  coverage_amount: { label: "¿Qué monto de cobertura desea revisar?" },
  military_status: {
    label: "¿Para quién desea revisar opciones?",
    options: { Veteran: "Veterano/a", "Active duty": "Servicio activo", "Spouse or family": "Cónyuge o familia" },
  },
  branch: { label: "Seleccione su rama militar" },
  mortgage_balance: {
    label: "¿Qué desea proteger?",
    options: { "My home": "Mi hogar", "My family's monthly payment": "El pago mensual de mi familia", Both: "Ambos" },
  },
  occupation: {
    label: "¿Cuál opción le describe mejor?",
    options: { "Owner-operator": "Propietario-operador", "Company driver": "Conductor de empresa", "Other professional driver": "Otro conductor profesional" },
  },
  state: { label: "Seleccione su estado" },
  product_qualifier: {
    label: "¿Qué es más importante para usted?",
    options: { "Protecting family": "Proteger a mi familia", "Planning ahead": "Planificar con anticipación", "Understanding my options": "Entender mis opciones" },
  },
  other: { label: "Seleccione una opción" },
};

export function localizeSelectorContract(contract: SelectorContract, language: CreativeLanguage): SelectorContract {
  if (language !== "es") return contract;
  const localized = SPANISH_SELECTOR_COPY[contract.type];
  return {
    ...contract,
    label: localized.label,
    options: contract.options.map((option) => localized.options?.[option] || option),
  };
}

const MATERIAL_ENGLISH = [
  /\bselect your\b/i,
  /\bview options\b/i,
  /\blearn more\b/i,
  /\bcoverage review\b/i,
  /\bimportant coverage notice\b/i,
  /\blicensed agent explainer\b/i,
  /\bwhat to review\b/i,
  /\bmy home\b/i,
  /\bcompany driver\b/i,
  /\bprotecting family\b/i,
];

export function assertRenderedLanguageSafe(draft: Record<string, any>): true {
  if (draft.language !== "es") return true;
  const visible = [
    draft.headline,
    draft.primaryText,
    draft.description,
    draft.cta,
    draft.visibleIdentityLabel,
    ...(draft.buttonLabels || []),
    ...(draft.bulletPoints || []),
    draft.selectorContract?.label,
    ...(draft.selectorContract?.options || []),
  ].filter(Boolean).join(" ");
  const match = MATERIAL_ENGLISH.find((pattern) => pattern.test(visible));
  if (match) throw new Error(`Spanish creative failed rendered-language validation (${match.source}).`);
  return true;
}

export function assertVisibleIdentity(draft: Record<string, any>): true {
  const label = String(draft.visibleIdentityLabel || "").toLowerCase();
  const audience = String(draft.audienceSegment || "");
  const vertical = String(draft.leadType || "");
  const audiencePresent = audience === "veteran"
    ? /veteran/.test(label)
    : audience === "trucker" ? /(cdl|conductor|truck|driver)/.test(label) : true;
  const productPresent = vertical === "mortgage_protection"
    ? /(mortgage|hipotec)/.test(label)
    : vertical === "iul" ? /\biul\b/.test(label)
      : vertical === "final_expense" ? /(final expense|gastos finales)/.test(label)
        : /(life insurance|seguro de vida)/.test(label);
  if (!audiencePresent || !productPresent) {
    throw new Error("Creative failed feed-visible audience/product identity validation.");
  }
  return true;
}
