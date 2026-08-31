export type VeteranMasterSource = "BOARD_DERIVED" | "ORIGINAL_COVE";
export type VeteranReviewMode = "TEST_CAPABILITY" | "SAFE_MODE" | "IMAGE_VARIANT";

export type VeteranMasterDefinition = {
  masterId: string;
  layout: string;
  structuralFamily: string;
  source: VeteranMasterSource;
  imageCompatible: boolean;
  imageUrl: string;
  imageTreatment: string;
  imageFocalPosition?: string;
  palette: "navy" | "paper" | "black" | "split" | "poster";
  eyebrow: string;
  headline: string[];
  capabilityHeroLabel: string;
  safeHero: string[];
  subhead: string;
  benefits: string[];
  cta: string;
};

export type VeteranMasterPreview = VeteranMasterDefinition & {
  previewId: string;
  mode: VeteranReviewMode;
  hero: string[];
  heroKind: "amount" | "safe";
  ownerApprovalStatus: "PENDING_REVIEW";
  deployed: false;
  capabilityFixtureId: string | null;
  ageOptions: string[];
};

export const VETERAN_24_TEST_CAPABILITY_FIXTURE = {
  fixtureId: "VET-24-MASTER-OWNER-REVIEW-50K",
  productionClaimData: false,
  issueAgeMin: 20,
  issueAgeMax: 85,
  faceAmount: 50_000,
  medicalExamRequirement: "not_required",
  waitingPeriodRules: ["no_2_year_wait"],
  cashValueCapability: true,
  disclosure: "TEST CAPABILITY PREVIEW / NOT PRODUCTION CLAIM DATA",
} as const;

export const VETERAN_24_AGE_OPTIONS = ["20–50", "51–60", "61–70", "71–80", "81+"];

const definitions: VeteranMasterDefinition[] = [
  { masterId:"VET_M01", layout:"layout-01", structuralFamily:"Navy/gold amount-first", source:"BOARD_DERIVED", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/1.jpg", imageTreatment:"full-bleed navy veil", palette:"navy", eyebrow:"VETERANS", headline:["WHOLE LIFE","INSURANCE"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["CHECK YOUR","ELIGIBILITY"], subhead:"PRIVATE COVERAGE OPTIONS", benefits:["NO MEDICAL EXAM","CASH VALUE GROWS","PROTECT YOUR FAMILY"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M02", layout:"layout-02", structuralFamily:"White/red military checklist", source:"BOARD_DERIVED", imageCompatible:false, imageUrl:"", imageTreatment:"none", palette:"paper", eyebrow:"MILITARY", headline:["WHOLE LIFE"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["SEE YOUR","OPTIONS"], subhead:"PROTECT YOUR FAMILY. LEAVE A LEGACY.", benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M03", layout:"layout-03", structuralFamily:"Problem-first funeral-cost", source:"BOARD_DERIVED", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/3.jpg", imageTreatment:"dark full-bleed problem frame", palette:"navy", eyebrow:"VETERANS", headline:["DON'T LEAVE YOUR FAMILY","WITH THE BILL"], capabilityHeroLabel:"FUNERAL COSTS CAN ADD UP — OPTIONS UP TO", safeHero:["PLAN AHEAD","WITH OPTIONS"], subhead:"WHOLE LIFE INSURANCE CAN HELP", benefits:["LOCK IN YOUR RATE","CASH VALUE GROWS","PEACE OF MIND"], cta:"SEE YOUR OPTIONS" },
  { masterId:"VET_M04", layout:"layout-04", structuralFamily:"White private-coverage amount", source:"BOARD_DERIVED", imageCompatible:false, imageUrl:"", imageTreatment:"none", palette:"paper", eyebrow:"VETERANS", headline:["PRIVATE COVERAGE","THAT PROTECTS"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["PRIVATE COVERAGE","REVIEW"], subhead:"WHOLE LIFE INSURANCE", benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M05", layout:"layout-05", structuralFamily:"Black/gold benefit-first", source:"BOARD_DERIVED", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/5.jpg", imageTreatment:"black-gold background wash", palette:"black", eyebrow:"VETERANS", headline:["SECURE TODAY","PROTECT TOMORROW"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["BUILD YOUR","PROTECTION"], subhead:"WHOLE LIFE INSURANCE", benefits:["LIFETIME COVERAGE","CASH VALUE GROWS","TAX-DEFERRED GROWTH"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M06", layout:"layout-06", structuralFamily:"White/red gratitude and family", source:"BOARD_DERIVED", imageCompatible:false, imageUrl:"", imageTreatment:"none", palette:"paper", eyebrow:"VETERANS", headline:["WE THANK YOU.","NOW LET US HELP YOU","PROTECT YOUR FAMILY."], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["EXPLORE PRIVATE","COVERAGE"], subhead:"WHOLE LIFE INSURANCE", benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M07", layout:"layout-07", structuralFamily:"Image-left dark direct response", source:"BOARD_DERIVED", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/7.jpg", imageTreatment:"left portrait with hard gradient", palette:"split", eyebrow:"YOU SERVED.", headline:["NOW PROTECT","WHAT MATTERS."], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["PROTECT WHAT","MATTERS"], subhead:"WHOLE LIFE INSURANCE", benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","CASH VALUE GROWS","PROTECT YOUR FAMILY"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M08", layout:"layout-08", structuralFamily:"White military-family benefit grid", source:"BOARD_DERIVED", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/8.jpg", imageTreatment:"faint family watermark", palette:"paper", eyebrow:"MILITARY FAMILIES", headline:["DESERVE FINANCIAL","PROTECTION"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["REVIEW YOUR","OPTIONS"], subhead:"WHOLE LIFE INSURANCE", benefits:["PROTECT YOUR FAMILY","LIFETIME COVERAGE","BUILD CASH VALUE"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M09", layout:"layout-09", structuralFamily:"Navy amount and benefit card", source:"BOARD_DERIVED", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/9.jpg", imageTreatment:"subtle right-side photo", palette:"navy", eyebrow:"VETERANS", headline:["LIFE INSURANCE"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["OPTIONS FOR","YOUR FAMILY"], subhead:"PEACE OF MIND FOR YOU. SECURITY FOR THEM.", benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M10", layout:"layout-10", structuralFamily:"White bordered legacy card", source:"BOARD_DERIVED", imageCompatible:false, imageUrl:"", imageTreatment:"none", palette:"paper", eyebrow:"VETERANS", headline:["WHOLE LIFE INSURANCE"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["BUILT FOR YOU.","BACKED BY US."], subhead:"BUILT FOR YOU. BACKED BY US.", benefits:["LIFETIME COVERAGE","CASH VALUE GROWS","PROTECT YOUR FAMILY"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M11", layout:"layout-11", structuralFamily:"Dark honor and purpose checklist", source:"BOARD_DERIVED", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/11.jpg", imageTreatment:"dark honor portrait", palette:"navy", eyebrow:"SERVE WITH HONOR.", headline:["PROTECT WITH PURPOSE."], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["COVERAGE WITH","PURPOSE"], subhead:"WHOLE LIFE INSURANCE", benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M12", layout:"layout-12", structuralFamily:"White future-security benefit card", source:"BOARD_DERIVED", imageCompatible:false, imageUrl:"", imageTreatment:"none", palette:"paper", eyebrow:"MILITARY STRONG", headline:["FUTURE SECURE"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["A SECURE","FUTURE"], subhead:"WHOLE LIFE INSURANCE", benefits:["PROTECT YOUR FAMILY","BUILD CASH VALUE","LEAVE A LEGACY"], cta:"TAP YOUR AGE:" },
  { masterId:"VET_M13", layout:"layout-13", structuralFamily:"Giant amount top", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/13.jpg", imageTreatment:"low horizon background", palette:"navy", eyebrow:"VETERAN COVERAGE", headline:["WHOLE LIFE INSURANCE"], capabilityHeroLabel:"OPTIONS UP TO", safeHero:["CHECK YOUR","ELIGIBILITY"], subhead:"PRIVATE OPTIONS FOR MILITARY FAMILIES", benefits:["NO EXAM","CASH VALUE","FAMILY PROTECTION"], cta:"CHOOSE YOUR AGE" },
  { masterId:"VET_M14", layout:"layout-14", structuralFamily:"Split hero", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/14.jpg", imageTreatment:"half-frame portrait", palette:"split", eyebrow:"FOR VETERANS", headline:["PROTECT THE PEOPLE","WHO MATTER MOST"], capabilityHeroLabel:"OPTIONS UP TO", safeHero:["YOUR PRIVATE","REVIEW"], subhead:"WHOLE LIFE COVERAGE", benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","CASH VALUE"], cta:"TAP YOUR AGE" },
  { masterId:"VET_M15", layout:"layout-15", structuralFamily:"Age-first response", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/15.jpg", imageTreatment:"top-banner photo", palette:"poster", eyebrow:"VETERANS 20–85", headline:["START WITH","YOUR AGE"], capabilityHeroLabel:"THEN SEE OPTIONS UP TO", safeHero:["SELECT YOUR","AGE BELOW"], subhead:"WHOLE LIFE INSURANCE OPTIONS", benefits:["PRIVATE REVIEW","FAMILY PROTECTION","BUILD CASH VALUE"], cta:"HOW OLD ARE YOU?" },
  { masterId:"VET_M16", layout:"layout-16", structuralFamily:"Family-problem split", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/16.jpg", imageTreatment:"family side panel", palette:"split", eyebrow:"YOU SERVED THEM.", headline:["DON'T LEAVE THEM","WITH THE BURDEN."], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["PLAN FOR","WHAT MATTERS"], subhead:"A PRIVATE WHOLE LIFE REVIEW", benefits:["FINAL EXPENSE HELP","CASH VALUE","FAMILY SECURITY"], cta:"SEE OPTIONS BY AGE" },
  { masterId:"VET_M17", layout:"layout-17", structuralFamily:"Notice and eligibility", source:"ORIGINAL_COVE", imageCompatible:false, imageUrl:"", imageTreatment:"none", palette:"paper", eyebrow:"VETERAN NOTICE", headline:["PRIVATE COVERAGE","REVIEW AVAILABLE"], capabilityHeroLabel:"TEST OPTIONS UP TO", safeHero:["CHECK INITIAL","ELIGIBILITY"], subhead:"FOR VETERANS AGES 20–85", benefits:["NO MEDICAL EXAM","PRIVATE RESPONSE","FIVE AGE GROUPS"], cta:"SELECT YOUR AGE" },
  { masterId:"VET_M18", layout:"layout-18", structuralFamily:"Giant product typography", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/18.jpg", imageTreatment:"type over faded flag", palette:"poster", eyebrow:"VETERANS", headline:["WHOLE","LIFE"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["FAMILY","PROTECTION"], subhead:"INSURANCE", benefits:["NO EXAM","NO 2-YEAR WAIT","CASH VALUE"], cta:"TAP YOUR AGE" },
  { masterId:"VET_M19", layout:"layout-19", structuralFamily:"Amount with side benefit rail", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/19.jpg", imageTreatment:"soft background under rails", palette:"navy", eyebrow:"VETERAN WHOLE LIFE", headline:["COVERAGE BUILT","AROUND YOU"], capabilityHeroLabel:"OPTIONS UP TO", safeHero:["PRIVATE","OPTIONS"], subhead:"PROTECT YOUR FAMILY", benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","CASH VALUE GROWS"], cta:"CHOOSE AN AGE" },
  { masterId:"VET_M20", layout:"layout-20", structuralFamily:"Image-side hero", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/20.jpg", imageTreatment:"right image column", palette:"split", eyebrow:"FOR THOSE WHO SERVED", headline:["LIFETIME","PROTECTION"], capabilityHeroLabel:"OPTIONS UP TO", safeHero:["SEE YOUR","OPTIONS"], subhead:"WHOLE LIFE INSURANCE", benefits:["PRIVATE REVIEW","CASH VALUE","FAMILY SECURITY"], cta:"TAP YOUR AGE" },
  { masterId:"VET_M21", layout:"layout-21", structuralFamily:"Full-bleed image overlay", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/21.jpg", imageTreatment:"full-bleed cinematic overlay", palette:"navy", eyebrow:"VETERANS", headline:["YOUR LEGACY","LIVES ON"], capabilityHeroLabel:"COVERAGE OPTIONS UP TO", safeHero:["PROTECT YOUR","LEGACY"], subhead:"WHOLE LIFE INSURANCE", benefits:["NO EXAM","CASH VALUE","PEACE OF MIND"], cta:"SELECT YOUR AGE" },
  { masterId:"VET_M22", layout:"layout-22", structuralFamily:"Patriotic poster", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/22.jpg", imageTreatment:"posterized flag background", palette:"poster", eyebrow:"HONOR. DUTY. FAMILY.", headline:["VETERAN","WHOLE LIFE"], capabilityHeroLabel:"OPTIONS UP TO", safeHero:["COVERAGE","REVIEW"], subhead:"PROTECT WHAT YOU SERVED FOR", benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","FAMILY PROTECTION"], cta:"TAP YOUR AGE" },
  { masterId:"VET_M23", layout:"layout-23", structuralFamily:"Family security card", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/23.jpg", imageTreatment:"family photo in framed panel", palette:"paper", eyebrow:"VETERAN FAMILIES", headline:["SECURITY STARTS","WITH A PLAN"], capabilityHeroLabel:"OPTIONS UP TO", safeHero:["BUILD YOUR","PLAN"], subhead:"PRIVATE WHOLE LIFE OPTIONS", benefits:["FAMILY PROTECTION","CASH VALUE","LIFETIME COVERAGE"], cta:"CHOOSE YOUR AGE" },
  { masterId:"VET_M24", layout:"layout-24", structuralFamily:"Minimal high-impact", source:"ORIGINAL_COVE", imageCompatible:true, imageUrl:"/ad-backgrounds/veteran/24.jpg", imageTreatment:"minimal dark background crop", palette:"black", eyebrow:"VETERANS", headline:["PROTECT","YOUR FAMILY."], capabilityHeroLabel:"OPTIONS UP TO", safeHero:["SEE YOUR","OPTIONS"], subhead:"WHOLE LIFE INSURANCE", benefits:["PRIVATE","SIMPLE","BY AGE"], cta:"START HERE" },
];

function asPreview(master: VeteranMasterDefinition, mode: VeteranReviewMode): VeteranMasterPreview {
  const imageMode = mode === "IMAGE_VARIANT";
  const capability = mode !== "SAFE_MODE";
  return {
    ...master,
    previewId: `${master.masterId}_${mode}`,
    mode,
    imageUrl: imageMode ? master.imageUrl : "",
    hero: capability ? ["$50,000"] : master.safeHero,
    heroKind: capability ? "amount" : "safe",
    ownerApprovalStatus: "PENDING_REVIEW",
    deployed: false,
    capabilityFixtureId: capability ? VETERAN_24_TEST_CAPABILITY_FIXTURE.fixtureId : null,
    ageOptions: VETERAN_24_AGE_OPTIONS,
  };
}

export function buildVeteran24MasterReview() {
  const masters = definitions.map((master) => ({ ...master }));
  return {
    masters,
    capabilityPreviews: masters.map((master) => asPreview(master, "TEST_CAPABILITY")),
    safePreviews: masters.map((master) => asPreview(master, "SAFE_MODE")),
    imagePreviews: masters.filter((master) => master.imageCompatible).map((master) => asPreview(master, "IMAGE_VARIANT")),
  };
}
