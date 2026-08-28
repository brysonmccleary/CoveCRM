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
    headlines: ["Veterans: Review Your Coverage Options", "You Served. Now Review What Protects Your Family.", "Military Families Deserve Clear Coverage Choices", "A Private Coverage Review for Those Who Served", "What Would Help Protect Your Family?", "Veterans and Spouses: Start a Clear Coverage Review"],
    hooks: ["A simple coverage review built for veterans and military families.", "See coverage options that may fit your family's priorities.", "Take a minute to review your protection options.", "Private insurance options can be reviewed alongside the protection you already have.", "Start with your family, budget, and long-term priorities.", "A licensed agent can explain available private coverage without obligation."],
    benefits: [["Personal coverage review", "Options explained clearly", "No obligation to review"], ["Family-focused planning", "Licensed-agent support", "A quick online start"], ["Private coverage education", "State-specific availability", "Policy terms explained"], ["Veteran and spouse review", "Your priorities first", "No government affiliation"]],
    ctas: ["Review Options", "Get Started", "Learn More", "Start My Review"],
    imageDirections: ["authentic older male veteran portrait without uniform insignia", "authentic older female veteran portrait without uniform insignia", "middle-aged veteran in civilian clothing", "veteran couple at home", "veteran and spouse reviewing paperwork", "veteran outdoors in natural light", "veteran at a kitchen table", "multigenerational military family", "civilian service-member silhouette without insignia", "veteran with subtle flag in background", "no-person folded flag-inspired abstract composition", "no-person premium navy graphic"],
    backgrounds: ["subtle navy and red graphic field", "respectful flag-inspired texture", "warm family home", "white and red editorial card", "black and gold premium field", "navy and gold geometric field", "cream paper notice texture", "outdoor sunrise", "subtle stars and stripes geometry", "clean navy benefit grid", "high-contrast white qualification card", "dark navy portrait vignette"],
  },
  final_expense: {
    headlines: ["Plan Ahead for Final Expenses", "Help Protect Your Family From Final-Cost Stress", "Explore Final Expense Coverage Options", "A Simple Final-Cost Planning Review", "Prepare Today With Your Family in Mind", "Understand Final Expense Insurance Options"],
    hooks: ["A simple review can help your family prepare for final costs.", "Learn about coverage designed for end-of-life expenses.", "See which final expense options may be available to you.", "Start with a clear explanation of coverage, costs, and eligibility.", "Planning ahead can make a difficult time less financially uncertain.", "Review available options with a licensed agent and no obligation."],
    benefits: [["Coverage options explained", "Family-focused planning", "Licensed-agent support"], ["Simple online start", "Personal review", "No obligation to explore"], ["State-specific availability", "Carrier options reviewed", "Policy terms explained"], ["Final-cost education", "Family priorities first", "Straightforward next step"]],
    ctas: ["Review Options", "See My Options", "Learn More", "Start Planning"],
    imageDirections: ["warm senior couple portrait", "adult child with older parent", "trusted licensed agent with family", "older woman reviewing a family plan", "older man at a kitchen table", "multigenerational family conversation", "no-person planning notebook", "quiet dignified senior portrait"],
    backgrounds: ["warm neutral paper texture", "quiet family home", "clean blue trust gradient", "cream and gold planning card", "soft green reassurance field", "dark navy trust panel"],
  },
  mortgage_protection: {
    headlines: ["Help Protect the Home Your Family Depends On", "Review Mortgage Protection Options", "A Coverage Review for Homeowners", "What Happens to the Mortgage if Life Changes?", "New Homeowners: Review Your Protection Plan", "Keep the Home at the Center of Your Plan"],
    hooks: ["Explore coverage that may help protect your family's home.", "See how life coverage can support a household through the unexpected.", "Start a personalized mortgage protection review.", "Understand how life insurance may help a family manage housing obligations.", "Your mortgage and household goals deserve a coordinated review.", "A licensed agent can explain options based on your state and priorities."],
    benefits: [["Home-focused planning", "Coverage options explained", "Licensed-agent guidance"], ["Personalized review", "Simple online start", "No obligation to explore"], ["Household priorities first", "State-specific availability", "Policy terms explained"], ["Mortgage-focused education", "Carrier options reviewed", "Clear next steps"]],
    ctas: ["Review Options", "Start My Review", "Learn More", "Protect My Home"],
    imageDirections: ["family outside their home", "new homeowners with keys", "agent explaining protection to a couple", "couple reviewing mortgage paperwork", "single homeowner at front door", "family in a warm living room", "no-person house key composition", "residential exterior with copy-safe sky"],
    backgrounds: ["welcoming residential exterior", "clean architectural blueprint motif", "warm living room", "red white and navy homeowner card", "cream and navy document field", "clean blue comparison grid"],
  },
  iul: {
    headlines: ["Learn How Indexed Universal Life Works", "Explore Long-Term Life Insurance Strategies", "An Educational IUL Review", "IUL Features, Costs, and Tradeoffs—Explained", "Could Permanent Life Insurance Fit Your Plan?", "Start With an Indexed Life Insurance Education Session"],
    hooks: ["Understand the features, costs, and tradeoffs of indexed universal life insurance.", "Explore how permanent life insurance may fit a long-term financial plan.", "Start with education—not a one-size-fits-all promise.", "Review an illustration carefully before deciding whether IUL fits your goals.", "Learn how index crediting, policy charges, and insurance protection interact.", "Compare long-term life insurance concepts with a licensed professional."],
    benefits: [["Educational review", "Costs and tradeoffs explained", "Licensed-agent guidance"], ["Long-term planning concepts", "Personalized illustration review", "No guaranteed market returns"], ["Policy mechanics explained", "Questions encouraged", "Individual suitability review"], ["Index-crediting education", "Insurance costs reviewed", "No tax or investment advice"]],
    ctas: ["Learn About IUL", "Start My Review", "Learn More", "Request Education"],
    imageDirections: ["professional reviewing a financial plan", "family discussing long-term goals", "licensed agent educational presentation", "professional couple at a planning table", "no-person index timeline diagram", "entrepreneur reviewing long-term goals", "agent at whiteboard", "clean no-person policy illustration concept"],
    backgrounds: ["clean financial diagram", "professional office setting", "subtle timeline graphic", "deep blue and gold education panel", "clean white comparison grid", "teal and navy explainer field"],
  },
  trucker: {
    headlines: ["Truck Drivers: Review Your Coverage Options", "Protection Planning Built Around Life on the Road", "Help Protect the Income Your Family Counts On", "Professional Drivers: Start a Coverage Review", "Life on the Road Needs a Family Protection Plan", "Owner-Operators and Drivers: Know Your Options"],
    hooks: ["A straightforward coverage review for professional drivers.", "Explore protection options that fit life on and off the road.", "Take a minute to review coverage for your family's priorities.", "Review protection planning around your work, household, and long-term goals.", "A licensed agent can explain available options without interrupting your route.", "Start online, then review realistic coverage choices for your state."],
    benefits: [["Driver-focused review", "Coverage options explained", "Licensed-agent support"], ["Family income planning", "Simple online start", "No obligation to explore"], ["Owner-operator perspective", "State-specific availability", "Policy terms explained"], ["Work and family priorities", "Clear next steps", "Personalized review"]],
    ctas: ["Review Options", "Start My Review", "Learn More", "Driver Coverage Review"],
    imageDirections: ["professional truck driver beside a semi-trailer", "driver video selfie in parked cab", "truck driver returning home to family", "owner-operator inspecting a parked tractor", "female professional driver portrait", "driver at a safe rest stop", "no-person semi-trailer silhouette", "driver and spouse at home"],
    backgrounds: ["semi-trailer at a safe rest stop", "open highway at sunrise", "clean industrial graphic field", "navy and orange driver card", "black and amber road texture", "cyan and navy qualification grid"],
  },
};

const SPANISH_COPY = {
  headlines: ["Protege lo que tu familia ha construido", "Conoce tus opciones de cobertura", "Una revisión clara para tu familia", "Planifica hoy pensando en quienes amas", "Entiende la cobertura antes de decidir", "Comienza una revisión en español"],
  hooks: ["Conoce opciones de protección según las prioridades de tu familia.", "Empieza con una revisión sencilla y sin obligación.", "Recibe orientación clara de un agente con licencia.", "Aclara tus preguntas sobre cobertura, costos y requisitos.", "Revisa opciones disponibles en tu estado con atención personal.", "Da el primer paso con información clara para tu familia."],
  benefits: [["Opciones explicadas claramente", "Revisión personalizada", "Apoyo de un agente con licencia"], ["Enfoque en tu familia", "Inicio sencillo en línea", "Sin obligación de continuar"], ["Disponibilidad según el estado", "Términos explicados", "Próximos pasos claros"], ["Prioridades de tu hogar", "Orientación en español", "Revisión sin compromiso"]],
  ctas: ["Ver opciones", "Comenzar revisión", "Más información", "Solicitar orientación"],
};

const SEEDS: FamilySeed[] = [
  { id: "VET_IDENTITY_AGE_AMOUNT_CORE", vertical: "veteran", creativeClass: "core", audiences: ["veteran"], layouts: ["hero_amount_age_grid", "audience_benefit_grid", "full_bleed_text_overlay"], hookClass: "identity_qualification", offerClass: "coverage_review" },
  { id: "VET_VA_GAP_FAMILY_PROTECTION", vertical: "veteran", creativeClass: "core", audiences: ["veteran"], layouts: ["problem_consequence_offer", "family_lifestyle_offer", "notice_letter_paper"], hookClass: "family_protection", offerClass: "coverage_review" },
  { id: "VET_AMOUNT_BENEFIT_GRID", vertical: "veteran", creativeClass: "core", audiences: ["veteran"], layouts: ["audience_benefit_grid", "hero_amount_age_grid"], hookClass: "benefit_summary", offerClass: "coverage_review" },
  { id: "VET_FLAG_PORTRAIT_AGE", vertical: "veteran", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["portrait_hero_offer", "full_bleed_text_overlay"], hookClass: "identity_portrait", offerClass: "personal_review" },
  { id: "VET_SPOUSE_WIDOW_ELIGIBILITY", vertical: "veteran", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["family_lifestyle_offer", "calculator_quiz_assessment"], hookClass: "household_eligibility", offerClass: "personal_review" },
  { id: "VET_STORY_VIDEO", vertical: "veteran", creativeClass: "experimental", audiences: ["veteran"], layouts: ["ugc_talking_head", "agent_trust_explainer"], hookClass: "personal_story", offerClass: "consultation" },
  { id: "VET_IUL_RETIREMENT_EDU", vertical: "iul", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["educational_explainer_card", "agent_trust_explainer", "comparison_two_column", "calculator_quiz_assessment"], hookClass: "retirement_education", offerClass: "education" },
  { id: "VET_MORTGAGE_HOME", vertical: "mortgage_protection", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["family_lifestyle_offer", "problem_consequence_offer"], hookClass: "veteran_home", offerClass: "coverage_review" },
  { id: "VET_FINAL_EXPENSE", vertical: "final_expense", creativeClass: "adjacent", audiences: ["veteran"], layouts: ["notice_letter_paper", "family_lifestyle_offer", "problem_consequence_offer", "audience_benefit_grid"], hookClass: "veteran_final_cost", offerClass: "coverage_review" },

  { id: "FE_COST_FAMILY_BURDEN", vertical: "final_expense", creativeClass: "core", layouts: ["problem_consequence_offer", "family_lifestyle_offer"], hookClass: "family_burden", offerClass: "coverage_review" },
  { id: "FE_AGE_AMOUNT_NOEXAM", vertical: "final_expense", creativeClass: "core", layouts: ["hero_amount_age_grid", "audience_benefit_grid"], hookClass: "eligibility", offerClass: "coverage_review" },
  { id: "FE_PRICE_COVERAGE_CARD", vertical: "final_expense", creativeClass: "core", layouts: ["portrait_hero_offer", "notice_letter_paper"], hookClass: "cost_planning", offerClass: "personal_review" },
  { id: "FE_WAITING_PERIOD_ELIGIBILITY", vertical: "final_expense", creativeClass: "adjacent", layouts: ["comparison_two_column", "calculator_quiz_assessment"], hookClass: "eligibility_education", offerClass: "education" },
  { id: "FE_CREMATION_GUIDE", vertical: "final_expense", creativeClass: "adjacent", layouts: ["educational_explainer_card", "notice_letter_paper"], hookClass: "planning_guide", offerClass: "education" },
  { id: "FE_AGENT_VIDEO", vertical: "final_expense", creativeClass: "experimental", layouts: ["agent_trust_explainer", "ugc_talking_head"], hookClass: "agent_explainer", offerClass: "consultation" },
  { id: "FE_FAMILY_TESTIMONIAL", vertical: "final_expense", creativeClass: "experimental", layouts: ["family_lifestyle_offer", "ugc_talking_head"], hookClass: "family_story", offerClass: "coverage_review" },

  { id: "MP_HOME_BALANCE_FAMILY", vertical: "mortgage_protection", creativeClass: "core", layouts: ["problem_consequence_offer", "family_lifestyle_offer"], hookClass: "home_consequence", offerClass: "coverage_review" },
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

  { id: "TRK_OCCUPATION_AMOUNT_BENEFITS", vertical: "trucker", creativeClass: "core", audiences: ["trucker"], layouts: ["audience_benefit_grid", "hero_amount_age_grid"], hookClass: "driver_identity", offerClass: "coverage_review" },
  { id: "TRK_CAREER_PHYSICAL_RISK", vertical: "trucker", creativeClass: "core", audiences: ["trucker"], layouts: ["problem_consequence_offer", "full_bleed_text_overlay"], hookClass: "career_risk", offerClass: "coverage_review" },
  { id: "TRK_FAMILY_INCOME_PROTECTION", vertical: "trucker", creativeClass: "core", audiences: ["trucker"], layouts: ["family_lifestyle_offer", "problem_consequence_offer"], hookClass: "family_income", offerClass: "coverage_review" },
  { id: "TRK_HIGHWAY_AGE_CARD", vertical: "trucker", creativeClass: "adjacent", audiences: ["trucker"], layouts: ["full_bleed_text_overlay", "portrait_hero_offer"], hookClass: "driver_qualification", offerClass: "personal_review" },
  { id: "TRK_DRIVER_UGC", vertical: "trucker", creativeClass: "experimental", audiences: ["trucker"], layouts: ["ugc_talking_head", "agent_trust_explainer"], hookClass: "driver_story", offerClass: "consultation" },
  { id: "TRK_IUL_RETIREMENT", vertical: "iul", creativeClass: "adjacent", audiences: ["trucker"], layouts: ["educational_explainer_card", "agent_trust_explainer", "comparison_two_column", "calculator_quiz_assessment"], hookClass: "driver_retirement", offerClass: "education" },
  { id: "TRK_MORTGAGE_HOME", vertical: "mortgage_protection", creativeClass: "adjacent", audiences: ["trucker"], layouts: ["family_lifestyle_offer", "problem_consequence_offer", "full_bleed_text_overlay", "agent_trust_explainer"], hookClass: "driver_home", offerClass: "coverage_review" },
  { id: "TRK_FINAL_EXPENSE", vertical: "final_expense", creativeClass: "adjacent", audiences: ["trucker"], layouts: ["family_lifestyle_offer", "audience_benefit_grid", "problem_consequence_offer", "agent_trust_explainer"], hookClass: "driver_final_cost", offerClass: "coverage_review" },

  { id: "ES_FE_FAMILY_BURDEN", vertical: "final_expense", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["problem_consequence_offer", "family_lifestyle_offer"], hookClass: "responsabilidad_familiar", offerClass: "revision" },
  { id: "ES_FE_AGE_PRICE_NOEXAM", vertical: "final_expense", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["hero_amount_age_grid", "portrait_hero_offer"], hookClass: "elegibilidad", offerClass: "revision" },
  { id: "ES_FE_AGENT_TRUST_VIDEO", vertical: "final_expense", creativeClass: "experimental", audiences: ["spanish"], languages: ["es"], layouts: ["agent_trust_explainer", "ugc_talking_head"], hookClass: "confianza_agente", offerClass: "consulta" },
  { id: "ES_MP_LIVING_BENEFIT", vertical: "mortgage_protection", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["audience_benefit_grid", "educational_explainer_card", "family_lifestyle_offer", "agent_trust_explainer"], hookClass: "proteccion_hogar", offerClass: "educacion" },
  { id: "ES_IUL_EDUCATION", vertical: "iul", creativeClass: "core", audiences: ["spanish"], languages: ["es"], layouts: ["educational_explainer_card", "comparison_two_column", "calculator_quiz_assessment", "agent_trust_explainer"], hookClass: "educacion_iul", offerClass: "educacion" },
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
