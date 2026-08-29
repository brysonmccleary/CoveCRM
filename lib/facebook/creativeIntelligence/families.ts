import type {
  CreativeAudienceSegment,
  CreativeClass,
  CreativeFamilyDefinition,
  CreativeLanguage,
  CreativeVertical,
  LayoutId,
  MarketEvidence,
} from "./types";

type FamilySeed = {
  id: string;
  vertical: CreativeVertical;
  creativeClass: CreativeClass;
  audiences?: CreativeAudienceSegment[];
  languages?: CreativeLanguage[];
  layouts: LayoutId[];
  hookClass: string;
  offerClass: string;
  requiredCapabilities?: string[];
};

const EVIDENCE: MarketEvidence = {
  observedCount: 1,
  advertiserCount: 1,
  observationDate: "2026-08-28",
  longevityClass: "emerging",
  evidenceStrength: "low",
  performanceKnown: false,
  statuses: ["OBSERVED_IN_MARKET"],
};

const SAFE_COPY: Record<CreativeVertical, {
  headlines: string[];
  hooks: string[];
  benefits: string[][];
  ctas: string[];
  imageDirections: string[];
  backgrounds: string[];
}> = {
  veteran: {
    headlines: ["Protect What You Built", "Do Not Leave Final Costs Without a Plan", "Life Insurance Options for Veterans", "Your Family Still Counts on You", "Veterans: See Your Options", "Military Families: Plan Ahead"],
    hooks: ["Explore private life insurance options that may help protect your family.", "Do not leave final expenses without a plan. See what options may be available.", "Your service protected others. Take the next step for the people you love.", "See private coverage options by age and state in a few quick steps.", "Build a plan around your family before the unexpected becomes their burden.", "Veterans and spouses can start a private coverage eligibility check online."],
    benefits: [["Coverage options", "Family protection", "Simple eligibility check"], ["Private life insurance", "Options by age and state", "No obligation to apply"], ["Final-cost planning", "Spouse and family focus", "Clear next step"], ["Veteran-focused start", "Personal options review", "No government affiliation"]],
    ctas: ["See My Options", "Check Eligibility", "Protect My Family", "Review My Options"],
    imageDirections: ["authentic older male veteran portrait without uniform insignia", "authentic older female veteran portrait without uniform insignia", "middle-aged veteran in civilian clothing", "veteran couple at home", "veteran and spouse reviewing paperwork", "veteran outdoors in natural light", "veteran at a kitchen table", "multigenerational military family", "civilian service-member silhouette without insignia", "veteran with subtle flag in background", "no-person folded flag-inspired abstract composition", "no-person premium navy graphic"],
    backgrounds: ["subtle navy and red graphic field", "respectful flag-inspired texture", "warm family home", "white and red editorial card", "black and gold premium field", "navy and gold geometric field", "cream paper notice texture", "outdoor sunrise", "subtle stars and stripes geometry", "clean navy benefit grid", "high-contrast white qualification card", "dark navy portrait vignette"],
  },
  final_expense: {
    headlines: ["Do Not Leave Funeral Costs to Your Family", "Make a Plan for Final Expenses", "Final Expense Options by Age", "Protect Your Family From Final-Cost Stress", "Plan Today for the Costs They Could Face", "See Your Final Expense Options"],
    hooks: ["Explore coverage options that may help your family prepare for final costs.", "A few quick answers can show which options may be available by age and state.", "Funeral and final costs can arrive fast. Start a private coverage review.", "Make a plan before final expenses become someone else's responsibility.", "See private life insurance options designed for final-cost planning.", "Take the first step toward a clearer plan for the people you love."],
    benefits: [["Final-cost options", "Family-focused planning", "Simple eligibility check"], ["Options by age and state", "Private life insurance", "No obligation to apply"], ["Funeral-cost planning", "Clear next step", "Personal options review"], ["Coverage education", "Family protection focus", "Terms explained clearly"]],
    ctas: ["See My Options", "Check Eligibility", "Make My Plan", "Review Coverage"],
    imageDirections: ["warm senior couple portrait", "adult child with older parent", "trusted licensed agent with family", "older woman reviewing a family plan", "older man at a kitchen table", "multigenerational family conversation", "no-person planning notebook", "quiet dignified senior portrait"],
    backgrounds: ["warm neutral paper texture", "quiet family home", "clean blue trust gradient", "cream and gold planning card", "soft green reassurance field", "dark navy trust panel"],
  },
  mortgage_protection: {
    headlines: ["Protect the Home Your Family Depends On", "What Happens to the Mortgage Without You?", "Mortgage Protection Options for Homeowners", "Keep Your Family's Home in the Plan", "New Homeowners: Protect What You Bought", "Start a Home Protection Check", "Your Mortgage Needs a Backup Plan", "Keep the House Payment in the Plan", "Homeowners: Review Your Protection Gap", "Protect the Keys Your Family Counts On"],
    hooks: ["Explore life insurance options that may help your family manage the mortgage.", "The house payment does not stop when life changes. See your options.", "Match a protection review to your mortgage balance and household goals.", "Take a few quick steps to review options for the home your family relies on.", "Build a plan around the mortgage before the unexpected reaches your family.", "See mortgage-focused life insurance options available by state.", "Your family should have a plan for the balance still owed on the home.", "Review private coverage choices built around your mortgage and household.", "A simple online check can help you compare options for protecting the home.", "Make the mortgage part of the protection conversation before life changes."],
    benefits: [["Home protection focus", "Mortgage-balance review", "Simple online start"], ["Family income planning", "Options by state", "No obligation to apply"], ["Mortgage-focused options", "Clear eligibility steps", "Personal review"], ["Household protection", "Policy terms explained", "Clear next step"], ["Balance-based review", "Family continuity focus", "Private coverage choices"], ["Homeowner eligibility", "Quick online start", "Options explained clearly"]],
    ctas: ["Protect My Home", "See My Options", "Start My Check", "Review Coverage", "Check My Home Plan", "See Home Options"],
    imageDirections: ["family outside their home", "new homeowners with keys", "agent explaining protection to a couple", "couple reviewing mortgage paperwork", "single homeowner at front door", "family in a warm living room", "no-person house key composition", "residential exterior with copy-safe sky"],
    backgrounds: ["welcoming residential exterior", "clean architectural blueprint motif", "warm living room", "red white and navy homeowner card", "cream and navy document field", "clean blue comparison grid"],
  },
  iul: {
    headlines: ["Could IUL Fit Your Long-Term Plan?", "Life Protection and Cash Value Education", "See How Indexed Universal Life Works", "Build a Smarter Legacy Conversation", "IUL Costs, Features, and Tradeoffs", "Start Your IUL Assessment"],
    hooks: ["Explore how life protection and cash value potential may work together.", "Learn the costs, policy mechanics, and tradeoffs before you decide.", "See how index crediting and life insurance protection interact over time.", "Start an educational assessment built around retirement and legacy goals.", "Compare IUL concepts without promises of market returns or tax results.", "Review an illustration carefully and ask what happens in multiple scenarios."],
    benefits: [["Life protection", "Cash value education", "Policy-cost review"], ["Retirement concepts", "Legacy planning", "Illustration review"], ["Index-crediting education", "Tradeoffs explained", "No market-return promise"], ["Long-term assessment", "Questions encouraged", "Individual suitability review"]],
    ctas: ["Start My Assessment", "Explore IUL", "See How It Works", "Request Education"],
    imageDirections: ["professional reviewing a financial plan", "family discussing long-term goals", "licensed agent educational presentation", "professional couple at a planning table", "no-person index timeline diagram", "entrepreneur reviewing long-term goals", "agent at whiteboard", "clean no-person policy illustration concept"],
    backgrounds: ["clean financial diagram", "professional office setting", "subtle timeline graphic", "deep blue and gold education panel", "clean white comparison grid", "teal and navy explainer field"],
  },
  trucker: {
    headlines: ["Truck Drivers: Protect the Income They Count On", "Life on the Road Needs a Family Plan", "CDL Drivers: See Your Coverage Options", "Owner-Operators: Protect Your Home Base", "Your Route Is Long. Your Plan Should Be Ready.", "Start a Driver Coverage Check"],
    hooks: ["Explore life insurance options built around drivers and their families.", "Your income keeps the household moving. See what options may be available.", "Start online and review private coverage choices by age and state.", "Protect the people at home while you handle the miles ahead.", "Professional drivers can take a simple eligibility check between routes.", "Build a family protection plan around life on and off the road."],
    benefits: [["Driver-focused options", "Family income protection", "Simple eligibility check"], ["CDL and owner-operator focus", "Options by age and state", "No obligation to apply"], ["Life insurance options", "Home-base protection", "Clear next step"], ["Work and family focus", "Personal options review", "Policy terms explained"]],
    ctas: ["See Driver Options", "Check Eligibility", "Protect My Family", "Start My Check"],
    imageDirections: ["professional truck driver beside a semi-trailer", "driver video selfie in parked cab", "truck driver returning home to family", "owner-operator inspecting a parked tractor", "female professional driver portrait", "driver at a safe rest stop", "no-person semi-trailer silhouette", "driver and spouse at home"],
    backgrounds: ["semi-trailer at a safe rest stop", "open highway at sunrise", "clean industrial graphic field", "navy and orange driver card", "black and amber road texture", "cyan and navy qualification grid"],
  },
};

const SPANISH_COPY = {
  headlines: ["Protege lo que tu familia ha construido", "No dejes los gastos finales sin un plan", "Tu hogar y tu familia cuentan contigo", "Conoce tus opciones por edad", "Haz un plan para quienes más quieres", "Comienza tu evaluación hoy"],
  hooks: ["Explora opciones privadas que pueden ayudar a proteger a tu familia.", "Da unos pasos rápidos para conocer opciones por edad y estado.", "No dejes que un gasto inesperado se convierta en carga familiar.", "Empieza una evaluación sencilla basada en las metas de tu hogar.", "Conoce beneficios, costos y requisitos antes de tomar una decisión.", "Haz hoy el plan que tu familia podría necesitar mañana."],
  benefits: [["Opciones de cobertura", "Protección familiar", "Evaluación sencilla"], ["Opciones por edad y estado", "Inicio rápido en línea", "Sin obligación de solicitar"], ["Enfoque en tu hogar", "Próximo paso claro", "Revisión personal"], ["Información en español", "Términos claros", "Plan para tu familia"]],
  ctas: ["Ver mis opciones", "Revisar elegibilidad", "Proteger mi familia", "Comenzar evaluación"],
};

const SEEDS: FamilySeed[] = [
  { id: "VET_IDENTITY_AGE_AMOUNT_CORE", vertical: "veteran", creativeClass: "core", audiences: ["veteran"], layouts: ["hero_amount_age_grid", "audience_benefit_grid", "full_bleed_text_overlay"], hookClass: "identity_qualification", offerClass: "eligibility_review" },
  { id: "VET_VA_GAP_FAMILY_PROTECTION", vertical: "veteran", creativeClass: "core", audiences: ["veteran"], layouts: ["problem_consequence_offer", "family_lifestyle_offer", "notice_letter_paper"], hookClass: "family_protection", offerClass: "private_coverage_options" },
  { id: "VET_AMOUNT_BENEFIT_GRID", vertical: "veteran", creativeClass: "core", audiences: ["veteran"], layouts: ["audience_benefit_grid", "hero_amount_age_grid"], hookClass: "benefit_summary", offerClass: "benefit_comparison" },
  { id: "VET_FLAG_PORTRAIT_AGE", vertical: "veteran", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["portrait_hero_offer", "full_bleed_text_overlay"], hookClass: "identity_portrait", offerClass: "personal_review" },
  { id: "VET_SPOUSE_WIDOW_ELIGIBILITY", vertical: "veteran", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["family_lifestyle_offer", "calculator_quiz_assessment"], hookClass: "household_eligibility", offerClass: "spouse_eligibility_review" },
  { id: "VET_STORY_VIDEO", vertical: "veteran", creativeClass: "experimental", audiences: ["veteran"], layouts: ["ugc_talking_head", "agent_trust_explainer"], hookClass: "personal_story", offerClass: "consultation" },
  { id: "VET_IUL_RETIREMENT_EDU", vertical: "iul", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["educational_explainer_card", "agent_trust_explainer", "comparison_two_column", "calculator_quiz_assessment"], hookClass: "retirement_education", offerClass: "education" },
  { id: "VET_MORTGAGE_HOME", vertical: "mortgage_protection", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["family_lifestyle_offer", "problem_consequence_offer"], hookClass: "veteran_home", offerClass: "mortgage_protection_review" },
  { id: "VET_FINAL_EXPENSE", vertical: "final_expense", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["notice_letter_paper", "family_lifestyle_offer", "problem_consequence_offer", "audience_benefit_grid"], hookClass: "veteran_final_cost", offerClass: "final_cost_planning" },

  { id: "FE_COST_FAMILY_BURDEN", vertical: "final_expense", creativeClass: "core", layouts: ["problem_consequence_offer", "family_lifestyle_offer"], hookClass: "family_burden", offerClass: "final_cost_planning" },
  { id: "FE_AGE_AMOUNT_NOEXAM", vertical: "final_expense", creativeClass: "core", layouts: ["hero_amount_age_grid", "audience_benefit_grid"], hookClass: "eligibility", offerClass: "eligibility_review" },
  { id: "FE_PRICE_COVERAGE_CARD", vertical: "final_expense", creativeClass: "core", layouts: ["portrait_hero_offer", "notice_letter_paper"], hookClass: "cost_planning", offerClass: "personal_review" },
  { id: "FE_WAITING_PERIOD_ELIGIBILITY", vertical: "final_expense", creativeClass: "adjacent", layouts: ["comparison_two_column", "calculator_quiz_assessment"], hookClass: "eligibility_education", offerClass: "education" },
  { id: "FE_CREMATION_GUIDE", vertical: "final_expense", creativeClass: "adjacent", layouts: ["educational_explainer_card", "notice_letter_paper"], hookClass: "planning_guide", offerClass: "education" },
  { id: "FE_AGENT_VIDEO", vertical: "final_expense", creativeClass: "experimental", layouts: ["agent_trust_explainer", "ugc_talking_head"], hookClass: "agent_explainer", offerClass: "consultation" },
  { id: "FE_FAMILY_TESTIMONIAL", vertical: "final_expense", creativeClass: "experimental", layouts: ["family_lifestyle_offer", "ugc_talking_head"], hookClass: "family_story", offerClass: "coverage_review" },

  { id: "MP_HOME_BALANCE_FAMILY", vertical: "mortgage_protection", creativeClass: "core", layouts: ["problem_consequence_offer", "family_lifestyle_offer"], hookClass: "home_consequence", offerClass: "mortgage_protection_review" },
  { id: "MP_LIVING_BENEFIT_STACK", vertical: "mortgage_protection", creativeClass: "core", layouts: ["audience_benefit_grid", "educational_explainer_card"], hookClass: "benefit_education", offerClass: "education" },
  { id: "MP_AMOUNT_NOEXAM", vertical: "mortgage_protection", creativeClass: "core", layouts: ["hero_amount_age_grid", "portrait_hero_offer"], hookClass: "coverage_amount", offerClass: "coverage_review" },
  { id: "MP_NEW_HOMEOWNER", vertical: "mortgage_protection", creativeClass: "adjacent", layouts: ["full_bleed_text_overlay", "family_lifestyle_offer"], hookClass: "new_homeowner", offerClass: "personal_review" },
  { id: "MP_AGENT_EXPLAINER", vertical: "mortgage_protection", creativeClass: "experimental", layouts: ["agent_trust_explainer", "educational_explainer_card"], hookClass: "agent_explainer", offerClass: "consultation" },
  { id: "MP_NOTICE_TEXT_CARD", vertical: "mortgage_protection", creativeClass: "adjacent", layouts: ["notice_letter_paper", "comparison_two_column"], hookClass: "homeowner_notice", offerClass: "coverage_review" },
  { id: "MP_VETERAN_HOMEOWNER", vertical: "mortgage_protection", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["family_lifestyle_offer", "audience_benefit_grid"], hookClass: "veteran_home", offerClass: "coverage_review" },

  { id: "IUL_TAX_CASH_EDUCATION", vertical: "iul", creativeClass: "core", layouts: ["educational_explainer_card", "comparison_two_column"], hookClass: "cash_value_education", offerClass: "education" },
  { id: "IUL_MARKET_DOWNSIDE_EXPLAINER", vertical: "iul", creativeClass: "core", layouts: ["educational_explainer_card", "problem_consequence_offer"], hookClass: "index_education", offerClass: "education" },
  { id: "IUL_RETIREMENT_COMPARISON", vertical: "iul", creativeClass: "core", layouts: ["comparison_two_column", "educational_explainer_card"], hookClass: "retirement_comparison", offerClass: "education" },
  { id: "IUL_LEGACY_FAMILY", vertical: "iul", creativeClass: "adjacent", layouts: ["family_lifestyle_offer", "portrait_hero_offer"], hookClass: "legacy_planning", offerClass: "personal_review" },
  { id: "IUL_AGENT_TALKING_HEAD", vertical: "iul", creativeClass: "adjacent", layouts: ["agent_trust_explainer", "ugc_talking_head"], hookClass: "agent_education", offerClass: "consultation" },
  { id: "IUL_CALCULATOR_QUIZ", vertical: "iul", creativeClass: "experimental", layouts: ["calculator_quiz_assessment", "educational_explainer_card"], hookClass: "planning_assessment", offerClass: "education" },
  { id: "IUL_OCCUPATION_EDUCATION", vertical: "iul", creativeClass: "experimental", layouts: ["educational_explainer_card", "agent_trust_explainer"], hookClass: "occupation_education", offerClass: "education" },

  { id: "TRK_OCCUPATION_AMOUNT_BENEFITS", vertical: "trucker", creativeClass: "core", audiences: ["trucker"], layouts: ["audience_benefit_grid", "hero_amount_age_grid"], hookClass: "driver_identity", offerClass: "driver_family_protection" },
  { id: "TRK_CAREER_PHYSICAL_RISK", vertical: "trucker", creativeClass: "core", audiences: ["trucker"], layouts: ["problem_consequence_offer", "full_bleed_text_overlay"], hookClass: "career_risk", offerClass: "driver_coverage_review" },
  { id: "TRK_FAMILY_INCOME_PROTECTION", vertical: "trucker", creativeClass: "core", audiences: ["trucker"], layouts: ["family_lifestyle_offer", "problem_consequence_offer"], hookClass: "family_income", offerClass: "driver_family_protection" },
  { id: "TRK_HIGHWAY_AGE_CARD", vertical: "trucker", creativeClass: "adjacent", audiences: ["trucker"], layouts: ["full_bleed_text_overlay", "portrait_hero_offer"], hookClass: "driver_qualification", offerClass: "personal_review" },
  { id: "TRK_DRIVER_UGC", vertical: "trucker", creativeClass: "experimental", audiences: ["trucker"], layouts: ["ugc_talking_head", "agent_trust_explainer"], hookClass: "driver_story", offerClass: "consultation" },
  { id: "TRK_IUL_RETIREMENT", vertical: "iul", creativeClass: "adjacent", audiences: ["trucker"], layouts: ["educational_explainer_card", "agent_trust_explainer", "comparison_two_column", "calculator_quiz_assessment"], hookClass: "driver_retirement", offerClass: "education" },
  { id: "TRK_MORTGAGE_HOME", vertical: "mortgage_protection", creativeClass: "adjacent", audiences: ["trucker"], layouts: ["family_lifestyle_offer", "problem_consequence_offer", "full_bleed_text_overlay", "agent_trust_explainer"], hookClass: "driver_home", offerClass: "mortgage_protection_review" },
  { id: "TRK_FINAL_EXPENSE", vertical: "final_expense", creativeClass: "adjacent", audiences: ["trucker"], layouts: ["family_lifestyle_offer", "audience_benefit_grid", "problem_consequence_offer", "agent_trust_explainer"], hookClass: "driver_final_cost", offerClass: "final_cost_planning" },

  { id: "ES_FE_FAMILY_BURDEN", vertical: "final_expense", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["problem_consequence_offer", "family_lifestyle_offer"], hookClass: "responsabilidad_familiar", offerClass: "revision" },
  { id: "ES_FE_AGE_PRICE_NOEXAM", vertical: "final_expense", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["hero_amount_age_grid", "portrait_hero_offer", "calculator_quiz_assessment"], hookClass: "elegibilidad", offerClass: "revision" },
  { id: "ES_FE_COST_COMPARISON", vertical: "final_expense", creativeClass: "adjacent", audiences: ["spanish"], languages: ["es"], layouts: ["comparison_two_column"], hookClass: "comparacion_costos", offerClass: "comparacion" },
  { id: "ES_FE_BENEFIT_OPTIONS", vertical: "final_expense", creativeClass: "adjacent", audiences: ["spanish"], languages: ["es"], layouts: ["audience_benefit_grid"], hookClass: "opciones_beneficios", offerClass: "opciones" },
  { id: "ES_FE_COVERAGE_NOTICE", vertical: "final_expense", creativeClass: "experimental", audiences: ["spanish"], languages: ["es"], layouts: ["notice_letter_paper"], hookClass: "aviso_cobertura", offerClass: "elegibilidad" },
  { id: "ES_FE_AGENT_TRUST_VIDEO", vertical: "final_expense", creativeClass: "experimental", audiences: ["spanish"], languages: ["es"], layouts: ["agent_trust_explainer", "ugc_talking_head"], hookClass: "confianza_agente", offerClass: "consulta" },
  { id: "ES_MP_LIVING_BENEFIT", vertical: "mortgage_protection", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["audience_benefit_grid", "educational_explainer_card", "family_lifestyle_offer", "agent_trust_explainer"], hookClass: "proteccion_hogar", offerClass: "educacion" },
  { id: "ES_MP_BALANCE_OPTIONS", vertical: "mortgage_protection", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["hero_amount_age_grid"], hookClass: "saldo_hipotecario", offerClass: "opciones" },
  { id: "ES_MP_HOME_CONSEQUENCE", vertical: "mortgage_protection", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["problem_consequence_offer"], hookClass: "consecuencia_hogar", offerClass: "revision" },
  { id: "ES_MP_COVERAGE_COMPARISON", vertical: "mortgage_protection", creativeClass: "adjacent", audiences: ["spanish"], languages: ["es"], layouts: ["comparison_two_column"], hookClass: "comparacion_hipoteca", offerClass: "comparacion" },
  { id: "ES_MP_HOMEOWNER_NOTICE", vertical: "mortgage_protection", creativeClass: "experimental", audiences: ["spanish"], languages: ["es"], layouts: ["notice_letter_paper"], hookClass: "aviso_propietario", offerClass: "elegibilidad" },
  { id: "ES_IUL_EDUCATION", vertical: "iul", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["educational_explainer_card", "comparison_two_column", "calculator_quiz_assessment", "agent_trust_explainer"], hookClass: "educacion_iul", offerClass: "educacion" },
  { id: "ES_IUL_RETIREMENT_COMPARISON", vertical: "iul", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["comparison_two_column"], hookClass: "comparacion_retiro", offerClass: "comparacion" },
  { id: "ES_IUL_PLANNING_ASSESSMENT", vertical: "iul", creativeClass: "adjacent", audiences: ["spanish"], languages: ["es"], layouts: ["calculator_quiz_assessment"], hookClass: "evaluacion_plan", offerClass: "evaluacion" },
  { id: "ES_IUL_DOWNSIDE_EDUCATION", vertical: "iul", creativeClass: "adjacent", audiences: ["spanish"], languages: ["es"], layouts: ["problem_consequence_offer"], hookClass: "riesgo_mercado", offerClass: "educacion" },
  { id: "ES_IUL_LEGACY_OPTIONS", vertical: "iul", creativeClass: "experimental", audiences: ["spanish"], languages: ["es"], layouts: ["audience_benefit_grid"], hookClass: "opciones_legado", offerClass: "opciones" },
  { id: "ES_VETERAN_FAMILY", vertical: "veteran", creativeClass: "adjacent", audiences: ["veteran", "spanish"], languages: ["es"], layouts: ["family_lifestyle_offer", "audience_benefit_grid", "problem_consequence_offer", "agent_trust_explainer"], hookClass: "familia_veterana", offerClass: "revision" },
  { id: "ES_TRUCKER_OCCUPATION", vertical: "trucker", creativeClass: "adjacent", audiences: ["trucker", "spanish"], languages: ["es"], layouts: ["full_bleed_text_overlay", "audience_benefit_grid", "problem_consequence_offer", "agent_trust_explainer"], hookClass: "conductor_profesional", offerClass: "revision" },
  { id: "ES_WHATSAPP_CONSULTATION", vertical: "final_expense", creativeClass: "experimental", audiences: ["spanish"], languages: ["es"], layouts: ["agent_trust_explainer", "ugc_talking_head"], hookClass: "consulta_whatsapp", offerClass: "consulta", requiredCapabilities: ["channel:whatsapp"] },
];

const CLASS_WEIGHTS: Record<CreativeVertical, Record<CreativeClass, number>> = {
  veteran: { core: 0.65, adjacent: 0.25, experimental: 0.1 },
  final_expense: { core: 0.55, adjacent: 0.3, experimental: 0.15 },
  mortgage_protection: { core: 0.5, adjacent: 0.35, experimental: 0.15 },
  iul: { core: 0.45, adjacent: 0.4, experimental: 0.15 },
  trucker: { core: 0.45, adjacent: 0.35, experimental: 0.2 },
};

function buildFamily(seed: FamilySeed): CreativeFamilyDefinition {
  const copy = SAFE_COPY[seed.vertical];
  const languages = seed.languages || ["en"];
  return {
    familyId: seed.id,
    vertical: seed.vertical,
    audienceSegments: seed.audiences || ["standard"],
    products: [seed.vertical],
    languages,
    marketEvidence: { ...EVIDENCE },
    creativeClass: seed.creativeClass,
    formats: ["graphic", "photo"],
    layoutIds: seed.layouts,
    hookClass: seed.hookClass,
    headlineClass: seed.hookClass,
    offerClass: seed.offerClass,
    imageDirections: copy.imageDirections,
    backgroundDirections: copy.backgrounds,
    selectorTypes: seed.vertical === "mortgage_protection" ? ["mortgage_balance"] : seed.vertical === "trucker" ? ["occupation"] : ["age_range"],
    ctaClass: "qualification_review",
    requiredCapabilities: seed.requiredCapabilities || [],
    allowedClaims: [],
    requiredDisclosures: ["availability_varies", "not_affiliated_with_government"],
    funnelCompatibility: [seed.vertical],
    targetingCompatibility: seed.audiences || ["standard"],
    initialWeight: CLASS_WEIGHTS[seed.vertical][seed.creativeClass],
    explorationFloor: seed.creativeClass === "experimental" ? 0.05 : 0.02,
    headlines: copy.headlines,
    hooks: copy.hooks,
    benefitLists: copy.benefits,
    ctas: copy.ctas,
    spanish: languages.includes("es") ? {
      headlines: SPANISH_COPY.headlines,
      hooks: SPANISH_COPY.hooks,
      benefitLists: SPANISH_COPY.benefits,
      ctas: SPANISH_COPY.ctas,
    } : undefined,
  };
}

export const CREATIVE_FAMILIES = SEEDS.map(buildFamily);

export function getEligibleCreativeFamilies(input: {
  vertical: CreativeVertical;
  audienceSegment: CreativeAudienceSegment;
  language: CreativeLanguage;
}): CreativeFamilyDefinition[] {
  return CREATIVE_FAMILIES.filter((family) => {
    if (family.vertical !== input.vertical) return false;
    if (!family.languages.includes(input.language)) return false;
    if (input.language === "es") {
      return family.audienceSegments.includes("spanish") || family.audienceSegments.includes(input.audienceSegment);
    }
    return family.audienceSegments.includes(input.audienceSegment) || family.audienceSegments.includes("standard");
  });
}

export function getCreativeFamily(familyId: string): CreativeFamilyDefinition | undefined {
  return CREATIVE_FAMILIES.find((family) => family.familyId === familyId);
}
