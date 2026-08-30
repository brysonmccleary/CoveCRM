export type ApprovedTruckerLane = "regular_trucker" | "trucker_iul";

export type BackgroundTreatment =
  | "FULL_BLEED_DARK"
  | "FAINT_BACKGROUND"
  | "LEFT_GRADIENT"
  | "RIGHT_GRADIENT"
  | "SPLIT_BACKGROUND"
  | "HERO_PROTECTED"
  | "TOP_ENVIRONMENT_FADE"
  | "PATRIOTIC_TEXTURE";

export type MasterKind =
  | "age_selector"
  | "benefit_grid"
  | "truck_right"
  | "policy_poster"
  | "hook_poster"
  | "driver_qualifier"
  | "open_road"
  | "home_base"
  | "problem_solution"
  | "identity_badge"
  | "split_offer"
  | "editorial"
  | "route_vintage"
  | "future_steps";

export type PaletteId = "black_gold" | "navy_amber" | "dark_orange" | "purple_gold" | "cream_rust" | "patriotic" | "white_navy";

export interface TruckerMaster {
  id: string;
  lane: ApprovedTruckerLane;
  name: string;
  kind: MasterKind;
  headline: string;
  subhead: string;
  bullets: string[];
  cta: string;
  qualifier: string[];
  palette: PaletteId;
  backgroundEnabled: boolean;
  referenceFamily?: "TRK-REF-01" | "TRK-REF-02" | "TRK-REF-03" | "TRK-REF-04" | "TRK-REF-05" | "META-SUP-01" | "META-SUP-02";
  structureNote: string;
}

const regular = (id: number, value: Omit<TruckerMaster, "id" | "lane">): TruckerMaster => ({
  id: `RTRK-${String(id).padStart(2, "0")}`,
  lane: "regular_trucker",
  ...value,
});

const iul = (id: number, value: Omit<TruckerMaster, "id" | "lane">): TruckerMaster => ({
  id: `TIUL-${String(id).padStart(2, "0")}`,
  lane: "trucker_iul",
  ...value,
});

export const REGULAR_TRUCKER_MASTERS: TruckerMaster[] = [
  regular(1, { name: "Scenic Road Age Selector", kind: "age_selector", headline: "LIFE INSURANCE FOR TRUCKERS", subhead: "Private coverage options for CDL drivers and their families.", bullets: [], cta: "SEE YOUR OPTIONS", qualifier: ["AGE 35–49", "AGE 50–59", "AGE 60+"], palette: "navy_amber", backgroundEnabled: true, referenceFamily: "TRK-REF-01", structureNote: "Scenic hero, three large age buttons, full-width CTA." }),
  regular(2, { name: "Driver Benefit Package", kind: "benefit_grid", headline: "THE DRIVER PROTECTION PACKAGE", subhead: "Life insurance options built around the people waiting at home.", bullets: ["Family protection", "Private options review", "Clear next steps"], cta: "REQUEST INFORMATION", qualifier: ["CDL DRIVER"], palette: "navy_amber", backgroundEnabled: true, referenceFamily: "TRK-REF-02", structureNote: "Large occupation header, integrated hero, 2×2 benefit grid." }),
  regular(3, { name: "Truck Right Offer", kind: "truck_right", headline: "TRUCKERS: PROTECT THE HOME BASE", subhead: "Compare private life insurance options for working drivers.", bullets: ["Built for CDL households", "Simple options review", "Family-first planning"], cta: "COMPARE OPTIONS", qualifier: ["CDL?", "YOUR AGE", "YOUR STATE"], palette: "black_gold", backgroundEnabled: true, referenceFamily: "TRK-REF-03", structureNote: "Copy left, truck right, qualification row and high-contrast CTA." }),
  regular(4, { name: "Minimal Policy Poster", kind: "policy_poster", headline: "THE TRUCKER LIFE POLICY", subhead: "Protection for the road ahead and the family back home.", bullets: ["Private life insurance options", "Coverage varies by policy", "Review costs and terms"], cta: "LEARN MORE", qualifier: [], palette: "dark_orange", backgroundEnabled: true, referenceFamily: "TRK-REF-04", structureNote: "Minimal top copy over full-bleed road image." }),
  regular(5, { name: "Patriotic Driver Offer", kind: "age_selector", headline: "BUILT FOR AMERICA'S DRIVERS", subhead: "Explore life insurance options for CDL families.", bullets: [], cta: "VIEW OPTIONS", qualifier: ["35–49", "50–59", "60+"], palette: "patriotic", backgroundEnabled: true, referenceFamily: "TRK-REF-05", structureNote: "Patriotic environment with large selector cards." }),
  regular(6, { name: "Dark Highway Hook", kind: "hook_poster", headline: "YOUR ROUTE CHANGES. YOUR RESPONSIBILITY DOESN'T.", subhead: "Life insurance options for professional drivers.", bullets: [], cta: "START YOUR REVIEW", qualifier: ["CDL DRIVERS"], palette: "black_gold", backgroundEnabled: true, referenceFamily: "META-SUP-01", structureNote: "Short hook on a protected dark highway field." }),
  regular(7, { name: "Driver Beside Truck", kind: "driver_qualifier", headline: "YOU DRIVE. THEY COUNT ON YOU.", subhead: "See private life insurance options for CDL drivers.", bullets: [], cta: "CHECK OPTIONS", qualifier: ["CDL STATUS", "AGE", "STATE"], palette: "navy_amber", backgroundEnabled: true, referenceFamily: "META-SUP-02", structureNote: "Driver portrait hero with qualification rail." }),
  regular(8, { name: "Open Road Hero", kind: "open_road", headline: "PROTECTION FOR THE ROAD AHEAD", subhead: "Help protect what you are working for.", bullets: ["Family-focused", "Private review", "Policy terms explained"], cta: "EXPLORE COVERAGE", qualifier: [], palette: "dark_orange", backgroundEnabled: true, structureNote: "Panoramic road hero with floating message block." }),
  regular(9, { name: "Home Base Shield", kind: "home_base", headline: "PROTECT THE HOME BASE", subhead: "The miles are for them. The protection can be too.", bullets: ["For working drivers", "For growing families", "For the road ahead"], cta: "SEE HOW IT WORKS", qualifier: [], palette: "cream_rust", backgroundEnabled: true, structureNote: "Warm split poster with home-base shield motif." }),
  regular(10, { name: "Income Problem Solution", kind: "problem_solution", headline: "IF YOUR INCOME STOPS, WHAT HAPPENS AT HOME?", subhead: "A private life insurance review can help you plan.", bullets: ["Identify needs", "Compare options", "Review terms"], cta: "BUILD A PLAN", qualifier: ["CDL DRIVER"], palette: "black_gold", backgroundEnabled: true, structureNote: "Question-led architecture with a three-step solution band." }),
  regular(11, { name: "Truck Stop Identity", kind: "identity_badge", headline: "PROFESSIONAL DRIVER. FAMILY PROVIDER.", subhead: "Life insurance options for the people who keep moving.", bullets: ["Private review", "Clear choices"], cta: "GET INFORMATION", qualifier: ["OWNER OPERATOR", "COMPANY DRIVER"], palette: "cream_rust", backgroundEnabled: true, structureNote: "Truck-stop environment, stamped identity badge and role selector." }),
  regular(12, { name: "Black Gold Premium", kind: "editorial", headline: "WORK HARD. PROTECT WHAT MATTERS.", subhead: "A straightforward life insurance review for CDL drivers.", bullets: ["Family security", "Coverage choices", "Terms reviewed"], cta: "REVIEW OPTIONS", qualifier: [], palette: "black_gold", backgroundEnabled: false, structureNote: "Premium black/gold editorial poster with restrained rules." }),
  regular(13, { name: "CDL Status First", kind: "identity_badge", headline: "GOT YOUR CDL?", subhead: "Explore private life insurance options built around working drivers.", bullets: [], cta: "CONTINUE", qualifier: ["YES — CDL", "NO — NOT YET"], palette: "navy_amber", backgroundEnabled: false, structureNote: "Oversized CDL question with two-button qualification." }),
  regular(14, { name: "Age First Offer", kind: "age_selector", headline: "TRUCKERS — TAP YOUR AGE", subhead: "Start a private life insurance options review.", bullets: [], cta: "SEE NEXT STEP", qualifier: ["35–49", "50–59", "60+"], palette: "white_navy", backgroundEnabled: false, structureNote: "Qualification-first light poster with dominant age controls." }),
  regular(15, { name: "Split Truck Offer", kind: "split_offer", headline: "LIFE INSURANCE FOR CDL FAMILIES", subhead: "Protection on one side. Your next route on the other.", bullets: ["Compare private options", "Review policy details"], cta: "SEE OPTIONS", qualifier: ["DRIVER STATUS"], palette: "navy_amber", backgroundEnabled: true, structureNote: "Hard vertical split between copy and image." }),
  regular(16, { name: "Full Bleed Highway", kind: "open_road", headline: "KEEP THE FAMILY PLAN MOVING", subhead: "Private life insurance options for professional drivers.", bullets: [], cta: "START HERE", qualifier: [], palette: "dark_orange", backgroundEnabled: true, structureNote: "Full-bleed highway, bottom glass panel and single CTA." }),
  regular(17, { name: "Top Environment Fade", kind: "policy_poster", headline: "DRIVE FOR THEM. PLAN FOR THEM.", subhead: "See life insurance options for your household.", bullets: ["CDL-focused review", "Clear costs and terms"], cta: "LEARN MORE", qualifier: [], palette: "navy_amber", backgroundEnabled: true, structureNote: "Image-dominant top half fading into structured copy." }),
  regular(18, { name: "Minimal Black Type", kind: "hook_poster", headline: "THE LOAD ISN'T THE ONLY THING YOU CARRY.", subhead: "Protect the people counting on you.", bullets: [], cta: "REVIEW LIFE OPTIONS", qualifier: ["TRUCKERS"], palette: "black_gold", backgroundEnabled: false, structureNote: "Typography-only black poster with one sentence and one CTA." }),
  regular(19, { name: "Family Security Poster", kind: "home_base", headline: "MILES AWAY. STILL PROVIDING.", subhead: "Life insurance can be part of the family plan.", bullets: ["Private coverage review", "Options vary by policy"], cta: "SEE THE PLAN", qualifier: [], palette: "white_navy", backgroundEnabled: false, structureNote: "Light family-security poster with large central lockup." }),
  regular(20, { name: "Owner Operator Identity", kind: "driver_qualifier", headline: "OWNER OPERATORS: PROTECT THE BUSINESS AT HOME", subhead: "Explore private life insurance options for your family.", bullets: [], cta: "COMPARE OPTIONS", qualifier: ["OWNER OPERATOR", "AGE", "STATE"], palette: "cream_rust", backgroundEnabled: true, structureNote: "Owner-operator identity ribbon with stacked qualification." }),
  regular(21, { name: "Route 66 Vintage", kind: "route_vintage", headline: "ROAD-TESTED RESPONSIBILITY", subhead: "Private life insurance options for CDL drivers.", bullets: ["Family first", "Clear review", "Policy details"], cta: "VIEW THE ROUTE", qualifier: [], palette: "cream_rust", backgroundEnabled: true, structureNote: "Vintage route poster, circular badge and diagonal CTA." }),
  regular(22, { name: "Weather Proof Plan", kind: "problem_solution", headline: "THE ROAD CAN TURN FAST", subhead: "Make sure your family plan is ready for the unexpected.", bullets: ["Review needs", "Compare choices", "Understand terms"], cta: "PLAN AHEAD", qualifier: [], palette: "dark_orange", backgroundEnabled: true, structureNote: "Storm scene with protected copy slab and step rail." }),
  regular(23, { name: "Two Truck Comparison", kind: "split_offer", headline: "COMPANY DRIVER OR OWNER OPERATOR?", subhead: "Your route is different. Your family protection can be personal.", bullets: [], cta: "SEE PRIVATE OPTIONS", qualifier: ["COMPANY DRIVER", "OWNER OPERATOR"], palette: "patriotic", backgroundEnabled: true, structureNote: "Horizontal comparison split with role-specific selectors." }),
  regular(24, { name: "Dispatch Card Stack", kind: "future_steps", headline: "YOUR NEXT THREE STEPS", subhead: "A straightforward life insurance review for truckers.", bullets: ["Tell us your age", "Share your state", "Compare private options"], cta: "BEGIN REVIEW", qualifier: [], palette: "purple_gold", backgroundEnabled: false, structureNote: "Large numbered dispatch cards with vertical progression." }),
];

export const TRUCKER_IUL_MASTERS: TruckerMaster[] = [
  iul(1, { name: "Dark Highway Future Hook", kind: "hook_poster", headline: "YOUR RIG WON'T RUN FOREVER. WHAT'S YOUR NEXT PLAN?", subhead: "Learn how IUL may fit a long-term financial strategy.", bullets: [], cta: "LEARN ABOUT IUL", qualifier: ["CDL DRIVERS"], palette: "black_gold", backgroundEnabled: true, referenceFamily: "META-SUP-01", structureNote: "Dark highway, giant future hook, single educational CTA." }),
  iul(2, { name: "Driver Portrait IUL", kind: "driver_qualifier", headline: "TRUCKERS: BUILD BEYOND THE NEXT LOAD", subhead: "Explore indexed universal life with an educational review.", bullets: [], cta: "START IUL REVIEW", qualifier: ["DRIVER STATUS", "AGE", "STATE"], palette: "navy_amber", backgroundEnabled: true, referenceFamily: "META-SUP-02", structureNote: "Driver portrait plus large IUL identity and qualification rail." }),
  iul(3, { name: "Minimal Black IUL", kind: "hook_poster", headline: "BUILD SOMETHING THAT STAYS WITH YOU.", subhead: "IUL education for professional drivers.", bullets: [], cta: "SEE HOW IUL WORKS", qualifier: ["TRUCKERS IUL"], palette: "black_gold", backgroundEnabled: false, structureNote: "Pure black typography poster with one idea and one CTA." }),
  iul(4, { name: "Stopped Rig Problem", kind: "problem_solution", headline: "WHEN THE RIG STOPS, WHAT'S YOUR FUTURE PLAN?", subhead: "Learn how IUL may support protection and long-term planning.", bullets: ["Understand the policy", "Review costs", "Compare tradeoffs"], cta: "EXPLORE IUL", qualifier: [], palette: "dark_orange", backgroundEnabled: true, referenceFamily: "TRK-REF-04", structureNote: "Question, consequence, and educational solution over road hero." }),
  iul(5, { name: "Build For Yourself", kind: "editorial", headline: "YOU BUILD FOR EVERYONE ELSE. BUILD A PLAN FOR YOU.", subhead: "An educational IUL review for CDL drivers.", bullets: ["Protection focus", "Long-term planning", "Policy details"], cta: "LEARN ABOUT IUL", qualifier: [], palette: "white_navy", backgroundEnabled: false, structureNote: "Light editorial poster with oversized pull quote." }),
  iul(6, { name: "Owner Operator Future", kind: "identity_badge", headline: "OWNER OPERATOR. FUTURE PLANNER.", subhead: "See where IUL may fit your broader financial plan.", bullets: [], cta: "REQUEST IUL INFO", qualifier: ["OWNER OPERATOR", "AGE", "STATE"], palette: "cream_rust", backgroundEnabled: true, structureNote: "Truck-stop identity badge with qualification stack." }),
  iul(7, { name: "Large Future Hook", kind: "truck_right", headline: "YOUR BUSINESS MOVES FREIGHT. YOUR PLAN SHOULD MOVE FORWARD.", subhead: "Learn about indexed universal life for long-term planning.", bullets: ["Educational review", "Policy terms explained", "No promises or projections"], cta: "EXPLORE IUL", qualifier: [], palette: "black_gold", backgroundEnabled: true, referenceFamily: "TRK-REF-03", structureNote: "Truck-right poster with oversized future-oriented hook." }),
  iul(8, { name: "Age IUL Review", kind: "age_selector", headline: "TRUCKERS IUL", subhead: "Choose your age range to begin an educational review.", bullets: [], cta: "CONTINUE", qualifier: ["AGE 35–49", "AGE 50–59", "AGE 60+"], palette: "purple_gold", backgroundEnabled: true, referenceFamily: "TRK-REF-01", structureNote: "Scenic hero with large age selectors and lane-explicit IUL label." }),
  iul(9, { name: "Consequence Solution", kind: "problem_solution", headline: "WHAT ARE YOU BUILDING BEYOND THE CAB?", subhead: "IUL may combine life insurance protection with cash value potential, subject to policy terms.", bullets: ["Learn the mechanics", "Review costs and limits", "Decide if it fits"], cta: "GET IUL EDUCATION", qualifier: [], palette: "navy_amber", backgroundEnabled: true, structureNote: "Three-stage problem/education/decision architecture." }),
  iul(10, { name: "Today Tomorrow", kind: "benefit_grid", headline: "PROTECT TODAY. PLAN FOR TOMORROW.", subhead: "Explore IUL with a clear, educational policy review.", bullets: ["Life insurance protection", "Cash value potential", "Costs and terms"], cta: "LEARN HOW IUL WORKS", qualifier: ["CDL DRIVER"], palette: "purple_gold", backgroundEnabled: true, referenceFamily: "TRK-REF-02", structureNote: "Hero plus benefit architecture using qualified, non-guaranteed language." }),
  iul(11, { name: "Driver Family Future", kind: "home_base", headline: "THE ROAD PAYS TODAY. WHAT'S THE FAMILY PLAN FOR TOMORROW?", subhead: "Learn how IUL may fit protection and future planning goals.", bullets: ["Protection", "Planning", "Policy education"], cta: "REVIEW IUL", qualifier: [], palette: "cream_rust", backgroundEnabled: true, structureNote: "Warm home-base split with family/future hierarchy." }),
  iul(12, { name: "Black Gold IUL", kind: "editorial", headline: "TRUCKERS IUL — A DIFFERENT KIND OF LONG-TERM PLAN", subhead: "Understand the features, costs, limits, and tradeoffs.", bullets: ["Educational review", "Policy-specific details"], cta: "SEE IUL DETAILS", qualifier: [], palette: "black_gold", backgroundEnabled: false, structureNote: "Black/gold policy editorial with restrained typographic rules." }),
  iul(13, { name: "Highway Benefit Architecture", kind: "benefit_grid", headline: "IUL FOR THE LONG ROAD", subhead: "Life insurance protection plus cash value potential, subject to policy terms.", bullets: ["Protection component", "Cash value potential", "Policy costs and limits"], cta: "EXPLORE THE POLICY", qualifier: [], palette: "navy_amber", backgroundEnabled: true, structureNote: "Wide highway hero and three safe educational benefit cells." }),
  iul(14, { name: "Minimal White IUL", kind: "policy_poster", headline: "TRUCKERS: KNOW WHAT IUL IS — AND WHAT IT ISN'T.", subhead: "Get a plain-language educational review before deciding.", bullets: ["Features", "Costs", "Tradeoffs"], cta: "START THE REVIEW", qualifier: [], palette: "white_navy", backgroundEnabled: false, structureNote: "Light, highly legible myth-versus-fact policy poster." }),
  iul(15, { name: "Truck Stop Future", kind: "route_vintage", headline: "NEXT STOP: A CLEARER FUTURE PLAN", subhead: "Explore IUL as one possible long-term planning tool.", bullets: ["Learn", "Compare", "Decide"], cta: "GET IUL INFORMATION", qualifier: [], palette: "cream_rust", backgroundEnabled: true, referenceFamily: "TRK-REF-05", structureNote: "Vintage truck-stop poster with route badge and educational CTA." }),
  iul(16, { name: "Driver Status IUL", kind: "identity_badge", headline: "WHAT KIND OF DRIVER ARE YOU?", subhead: "Start an IUL education path built around your situation.", bullets: [], cta: "CONTINUE", qualifier: ["OWNER OPERATOR", "COMPANY DRIVER"], palette: "patriotic", backgroundEnabled: false, structureNote: "Role qualification dominates; IUL remains explicit in the subhead." }),
  iul(17, { name: "Split Future Plan", kind: "split_offer", headline: "PROTECTION NOW. LONG-TERM PLANNING NEXT.", subhead: "Learn how an IUL policy works before choosing.", bullets: ["Policy protection", "Cash value potential", "Costs and limits"], cta: "UNDERSTAND IUL", qualifier: [], palette: "purple_gold", backgroundEnabled: true, structureNote: "Hard split between protection and planning content." }),
  iul(18, { name: "Open Road IUL", kind: "open_road", headline: "A LONG ROAD DESERVES A LONG-TERM PLAN", subhead: "Explore indexed universal life with no hype and clear policy education.", bullets: [], cta: "LEARN ABOUT IUL", qualifier: [], palette: "dark_orange", backgroundEnabled: true, structureNote: "Open-road panorama with protected editorial slab." }),
  iul(19, { name: "IUL Education Steps", kind: "future_steps", headline: "THREE THINGS TO KNOW ABOUT IUL", subhead: "Protection. Cash value potential. Policy costs and limits.", bullets: ["Understand the structure", "Review policy details", "Ask informed questions"], cta: "START IUL EDUCATION", qualifier: [], palette: "navy_amber", backgroundEnabled: false, structureNote: "Numbered educational progression with no outcome promises." }),
  iul(20, { name: "Patriotic Long Haul", kind: "age_selector", headline: "LONG-HAUL DRIVERS. LONG-TERM PLANNERS.", subhead: "Choose your age range to explore IUL education.", bullets: [], cta: "VIEW IUL INFORMATION", qualifier: ["35–49", "50–59", "60+"], palette: "patriotic", backgroundEnabled: true, structureNote: "Patriotic reskin with lane-explicit qualification." }),
];

export const ALL_APPROVED_TRUCKER_MASTERS = [...REGULAR_TRUCKER_MASTERS, ...TRUCKER_IUL_MASTERS];

export const BACKGROUND_TREATMENTS: BackgroundTreatment[] = [
  "FULL_BLEED_DARK", "FAINT_BACKGROUND", "LEFT_GRADIENT", "RIGHT_GRADIENT",
  "SPLIT_BACKGROUND", "HERO_PROTECTED", "TOP_ENVIRONMENT_FADE", "PATRIOTIC_TEXTURE",
];

export const REGULAR_TRUCKER_CANONICAL_VALUES = { leadType: "trucker", audienceSegment: "trucker" } as const;
export const TRUCKER_IUL_CANONICAL_VALUES = { leadType: "iul", audienceSegment: "trucker" } as const;

export function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface ApprovedTruckerConceptBase {
  executionId: string;
  visualConceptId: string;
  lane: ApprovedTruckerLane;
  master: TruckerMaster;
  imageNumber?: number;
  treatment?: BackgroundTreatment;
  palette: PaletteId;
  customerId?: string;
  truckVisible: boolean;
  customerEligible: boolean;
  cropPosition?: "left" | "center" | "right" | "top";
  imageZoom?: "standard" | "tight";
}

// Images 25, 26, 36, and 38 remain preserved in the 40-image historical
// library, but their wide industrial, distant-convoy, flag/overpass, or aerial
// compositions make the truck too small for the owner's customer-eligibility
// rule. They are intentionally excluded from customer selection.
export const TRUCKER_CUSTOMER_ELIGIBLE_IMAGE_NUMBERS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 39, 40,
] as const;

const TREATMENTS_BY_KIND: Record<MasterKind, BackgroundTreatment[]> = {
  age_selector: ["FULL_BLEED_DARK", "HERO_PROTECTED", "TOP_ENVIRONMENT_FADE", "PATRIOTIC_TEXTURE", "FAINT_BACKGROUND"],
  benefit_grid: ["FULL_BLEED_DARK", "HERO_PROTECTED", "TOP_ENVIRONMENT_FADE", "LEFT_GRADIENT"],
  truck_right: ["LEFT_GRADIENT", "FULL_BLEED_DARK", "SPLIT_BACKGROUND", "HERO_PROTECTED"],
  policy_poster: ["FULL_BLEED_DARK", "TOP_ENVIRONMENT_FADE", "FAINT_BACKGROUND", "RIGHT_GRADIENT"],
  hook_poster: ["FULL_BLEED_DARK", "LEFT_GRADIENT", "RIGHT_GRADIENT", "HERO_PROTECTED", "FAINT_BACKGROUND"],
  driver_qualifier: ["LEFT_GRADIENT", "RIGHT_GRADIENT", "FULL_BLEED_DARK", "TOP_ENVIRONMENT_FADE"],
  open_road: ["FULL_BLEED_DARK", "HERO_PROTECTED", "TOP_ENVIRONMENT_FADE", "PATRIOTIC_TEXTURE"],
  home_base: ["FULL_BLEED_DARK", "RIGHT_GRADIENT", "LEFT_GRADIENT", "HERO_PROTECTED"],
  problem_solution: ["FULL_BLEED_DARK", "LEFT_GRADIENT", "RIGHT_GRADIENT", "TOP_ENVIRONMENT_FADE"],
  identity_badge: ["FULL_BLEED_DARK", "LEFT_GRADIENT", "RIGHT_GRADIENT", "HERO_PROTECTED", "PATRIOTIC_TEXTURE"],
  split_offer: ["SPLIT_BACKGROUND", "LEFT_GRADIENT", "RIGHT_GRADIENT", "FULL_BLEED_DARK"],
  editorial: ["FAINT_BACKGROUND", "FULL_BLEED_DARK", "LEFT_GRADIENT", "RIGHT_GRADIENT"],
  route_vintage: ["FULL_BLEED_DARK", "TOP_ENVIRONMENT_FADE", "PATRIOTIC_TEXTURE", "HERO_PROTECTED"],
  future_steps: ["FAINT_BACKGROUND", "FULL_BLEED_DARK", "LEFT_GRADIENT", "RIGHT_GRADIENT"],
};

const CROP_OPTIONS: NonNullable<ApprovedTruckerConceptBase["cropPosition"]>[] = ["left", "center", "right", "top"];
const PHOTO_DOMINANT_TREATMENTS = new Set<BackgroundTreatment>([
  "FULL_BLEED_DARK",
  "HERO_PROTECTED",
  "TOP_ENVIRONMENT_FADE",
  "PATRIOTIC_TEXTURE",
]);

export interface ApprovedTruckerConcept extends ApprovedTruckerConceptBase {
  libraryIndex: number;
  imageNumber: number;
  treatment: BackgroundTreatment;
  cropPosition: "left" | "center" | "right" | "top";
  imageZoom: "standard" | "tight";
  visualTreatment: "photo" | "graphic";
}

export function isApprovedTruckerSelection(leadType: string, audienceSegment: string): boolean {
  return audienceSegment === "trucker" && (leadType === "trucker" || leadType === "iul");
}

export function getApprovedTruckerLane(leadType: string, audienceSegment: string): ApprovedTruckerLane | null {
  if (audienceSegment !== "trucker") return null;
  if (leadType === "trucker") return "regular_trucker";
  if (leadType === "iul") return "trucker_iul";
  return null;
}

export function getApprovedTruckerImageUrl(imageNumber: number): string {
  return `/ad-backgrounds/trucker/${imageNumber}.jpg`;
}

export function buildApprovedTruckerLibrary(lane: ApprovedTruckerLane): ApprovedTruckerConcept[] {
  const masters = lane === "regular_trucker" ? REGULAR_TRUCKER_MASTERS : TRUCKER_IUL_MASTERS;
  const concepts: ApprovedTruckerConcept[] = [];
  for (const master of masters) {
    for (const imageNumber of TRUCKER_CUSTOMER_ELIGIBLE_IMAGE_NUMBERS) {
      for (const treatment of TREATMENTS_BY_KIND[master.kind]) {
        const seed = hashSeed(`${lane}:${master.id}:${imageNumber}:${treatment}`);
        const cropPosition = CROP_OPTIONS[seed % CROP_OPTIONS.length];
        const imageZoom = seed % 5 === 0 ? "tight" : "standard";
        const visualConceptId = [lane, master.id, `img${imageNumber}`, treatment, cropPosition, imageZoom, master.palette].join(":");
        concepts.push({
          libraryIndex: concepts.length,
          executionId: visualConceptId,
          visualConceptId,
          lane,
          master,
          imageNumber,
          treatment,
          palette: master.palette,
          truckVisible: true,
          customerEligible: true,
          cropPosition,
          imageZoom,
          visualTreatment: PHOTO_DOMINANT_TREATMENTS.has(treatment) ? "photo" : "graphic",
        });
      }
    }
  }
  return concepts;
}

export function selectApprovedTruckerConcepts(input: {
  lane: ApprovedTruckerLane;
  seed: string;
  count: number;
  usedVisualConceptIds?: ReadonlySet<string>;
}): ApprovedTruckerConcept[] {
  const count = Math.max(1, Math.min(5, Math.floor(Number(input.count) || 3)));
  const library = buildApprovedTruckerLibrary(input.lane);
  const masters = input.lane === "regular_trucker" ? REGULAR_TRUCKER_MASTERS : TRUCKER_IUL_MASTERS;
  const byMaster = new Map(masters.map((master) => [
    master.id,
    library.filter((concept) => concept.master.id === master.id),
  ]));
  const used = input.usedVisualConceptIds || new Set<string>();
  const selected: ApprovedTruckerConcept[] = [];
  const selectedMasters = new Set<string>();
  const startMaster = hashSeed(`${input.lane}:${input.seed}:master`) % masters.length;

  for (let masterOffset = 0; masterOffset < masters.length && selected.length < count; masterOffset += 1) {
    const master = masters[(startMaster + masterOffset * 7) % masters.length];
    if (selectedMasters.has(master.id)) continue;
    const concepts = byMaster.get(master.id) || [];
    const desiredTreatment = selected.length % 2 === 0 ? "photo" : "graphic";
    const candidates = concepts.filter((concept) => concept.visualTreatment === desiredTreatment);
    const fallback = candidates.length ? candidates : concepts;
    const startConcept = hashSeed(`${input.seed}:${master.id}:${selected.length}`) % Math.max(1, fallback.length);
    let selectedConcept: ApprovedTruckerConcept | undefined;
    for (let offset = 0; offset < fallback.length; offset += 1) {
      const candidate = fallback[(startConcept + offset) % fallback.length];
      if (!used.has(candidate.visualConceptId)
        && !selected.some((concept) => concept.visualConceptId === candidate.visualConceptId)) {
        selectedConcept = candidate;
        break;
      }
    }
    if (!selectedConcept) continue;
    selected.push(selectedConcept);
    selectedMasters.add(master.id);
  }

  if (selected.length !== count) {
    throw new Error(`Approved ${input.lane} creative inventory is exhausted for this request.`);
  }
  return selected;
}
