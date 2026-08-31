export type VeteranReferenceMode = "TEST_CAPABILITY" | "SAFE_MODE" | "IMAGE_VARIANT";

export type VeteranReferenceMaster = {
  masterId: string;
  referenceTile: number;
  structuralFamily: string;
  palette: "dark" | "light" | "black" | "image-dark";
  imageCompatible: boolean;
  imageUrl: string;
  imageTreatment: string;
  imageFocalPosition?: string;
  audience: string[];
  headline: string[];
  product: string;
  supportingLine: string;
  heroLabel: string;
  safeHero: string[];
  benefits: string[];
  benefitBar: string;
  cta: string;
  layout: string;
  masterSet: "REFERENCE_LOCKED_MASTER";
};

export type VeteranReferencePreview = VeteranReferenceMaster & {
  previewId: string;
  mode: VeteranReferenceMode;
  hero: string[];
  heroKind: "amount" | "safe";
  ageOptions: string[];
  ownerApprovalStatus: "PENDING_REVIEW";
  deployed: false;
  capabilityFixtureId: string | null;
};

export const VETERAN_REFERENCE_CAPABILITY_FIXTURE = {
  fixtureId: "VET-REF-LOCKED-20-85-40K-100K",
  productionClaimData: false,
  issueAgeMin: 20,
  issueAgeMax: 85,
  supportedPreviewAmounts: [40_000, 50_000, 100_000],
  minimumDisplayedDollarHero: 40_000,
  medicalExamRequirement: "not_required",
  waitingPeriodRules: ["no_2_year_wait"],
  cashValueCapability: true,
  disclosure: "ISOLATED TEST CAPABILITY PREVIEW / NOT PRODUCTION CLAIM DATA",
} as const;

export const VETERAN_REFERENCE_AGE_OPTIONS = ["20–50", "51–60", "61–70", "71–80", "81+"];

const masters: VeteranReferenceMaster[] = [
  { masterId:"VET_REF_01",referenceTile:1,structuralFamily:"Reference Tile 01 — navy amount-first",palette:"dark",imageCompatible:true,imageUrl:"/ad-backgrounds/veteran/25.jpg",imageTreatment:"faint full background under navy veil",audience:["VETERANS"],headline:["WHOLE LIFE","INSURANCE"],product:"",supportingLine:"",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["CHECK YOUR","ELIGIBILITY"],benefits:["NO MEDICAL EXAM","CASH VALUE GROWS","PROTECT YOUR FAMILY"],benefitBar:"NO 2-YEAR WAIT",cta:"TAP YOUR AGE",layout:"ref-01",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_02",referenceTile:2,structuralFamily:"Reference Tile 02 — cream military checklist",palette:"light",imageCompatible:false,imageUrl:"",imageTreatment:"none",audience:["MILITARY"],headline:["WHOLE LIFE"],product:"",supportingLine:"PROTECT YOUR FAMILY. LEAVE A LEGACY.",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["SEE YOUR","COVERAGE OPTIONS"],benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-02",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_03",referenceTile:3,structuralFamily:"Reference Tile 03 — family problem-first",palette:"dark",imageCompatible:true,imageUrl:"/ad-backgrounds/veteran/27.jpg",imageTreatment:"dark full background behind problem panel",audience:["VETERANS"],headline:["DON'T LEAVE YOUR FAMILY","WITH THE BILL"],product:"WHOLE LIFE INSURANCE CAN HELP",supportingLine:"",heroLabel:"FUNERAL COSTS CAN ADD UP — OPTIONS UP TO",safeHero:["PLAN AHEAD","FOR YOUR FAMILY"],benefits:["LOCK IN YOUR RATE","CASH VALUE GROWS","PEACE OF MIND"],benefitBar:"",cta:"SEE YOUR OPTIONS  ›",layout:"ref-03",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_04",referenceTile:4,structuralFamily:"Reference Tile 04 — private coverage poster",palette:"light",imageCompatible:false,imageUrl:"",imageTreatment:"none",audience:["VETERANS"],headline:["PRIVATE COVERAGE","THAT PROTECTS"],product:"",supportingLine:"★  ★  ★",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["PRIVATE COVERAGE","REVIEW"],benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-04",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_05",referenceTile:5,structuralFamily:"Reference Tile 05 — black gold benefit-first",palette:"black",imageCompatible:true,imageUrl:"/ad-backgrounds/veteran/29.jpg",imageTreatment:"black-gold background blend",audience:["VETERANS"],headline:["SECURE TODAY","PROTECT TOMORROW"],product:"WHOLE LIFE INSURANCE",supportingLine:"",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["BUILD YOUR","PROTECTION"],benefits:["LIFETIME COVERAGE","CASH VALUE GROWS","TAX-DEFERRED GROWTH"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-05",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_06",referenceTile:6,structuralFamily:"Reference Tile 06 — gratitude family",palette:"light",imageCompatible:false,imageUrl:"",imageTreatment:"none",audience:["VETERANS"],headline:["WE THANK YOU.","NOW LET US HELP YOU","PROTECT YOUR FAMILY."],product:"",supportingLine:"",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["EXPLORE PRIVATE","COVERAGE"],benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-06",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_07",referenceTile:7,structuralFamily:"Reference Tile 07 — integrated veteran portrait",palette:"image-dark",imageCompatible:true,imageUrl:"/ad-backgrounds/veteran/31.jpg",imageTreatment:"large left portrait with rightward navy gradient",audience:["YOU SERVED."],headline:["NOW PROTECT","WHAT MATTERS."],product:"WHOLE LIFE INSURANCE",supportingLine:"",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["CHECK YOUR","ELIGIBILITY"],benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","CASH VALUE GROWS","PROTECT YOUR FAMILY"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-07",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_08",referenceTile:8,structuralFamily:"Reference Tile 08 — military family benefit grid",palette:"light",imageCompatible:true,imageUrl:"/ad-backgrounds/veteran/32.jpg",imageTreatment:"faint full family background",audience:["MILITARY FAMILIES"],headline:["DESERVE FINANCIAL","PROTECTION"],product:"WHOLE LIFE INSURANCE",supportingLine:"",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["SEE YOUR","COVERAGE OPTIONS"],benefits:["PROTECT YOUR FAMILY","LIFETIME COVERAGE","BUILD CASH VALUE"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-08",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_09",referenceTile:9,structuralFamily:"Reference Tile 09 — navy security card",palette:"dark",imageCompatible:true,imageUrl:"/ad-backgrounds/veteran/33.jpg",imageTreatment:"faint centered patriotic background",audience:["VETERANS"],headline:["LIFE INSURANCE"],product:"",supportingLine:"PEACE OF MIND FOR YOU. SECURITY FOR THEM.",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["SEE YOUR","OPTIONS"],benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-09",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_10",referenceTile:10,structuralFamily:"Reference Tile 10 — bordered legacy poster",palette:"light",imageCompatible:false,imageUrl:"",imageTreatment:"none",audience:["VETERANS"],headline:["WHOLE LIFE INSURANCE"],product:"",supportingLine:"BUILT FOR YOU. BACKED BY US.",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["PRIVATE COVERAGE","OPTIONS"],benefits:["LIFETIME COVERAGE","CASH VALUE GROWS","PROTECT YOUR FAMILY"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-10",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_11",referenceTile:11,structuralFamily:"Reference Tile 11 — honor purpose checklist",palette:"dark",imageCompatible:true,imageUrl:"/ad-backgrounds/veteran/35.jpg",imageTreatment:"dark patriotic background under checklist",audience:["SERVE WITH HONOR."],headline:["PROTECT WITH PURPOSE."],product:"WHOLE LIFE INSURANCE",supportingLine:"",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["COVERAGE WITH","PURPOSE"],benefits:["NO MEDICAL EXAM","NO 2-YEAR WAIT","ACCEPTANCE UP TO AGE 85"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-11",masterSet:"REFERENCE_LOCKED_MASTER" },
  { masterId:"VET_REF_12",referenceTile:12,structuralFamily:"Reference Tile 12 — future security card",palette:"light",imageCompatible:true,imageUrl:"/ad-backgrounds/veteran/36.jpg",imageTreatment:"faint full patriotic background",audience:["MILITARY STRONG"],headline:["FUTURE SECURE"],product:"WHOLE LIFE INSURANCE",supportingLine:"",heroLabel:"COVERAGE OPTIONS UP TO",safeHero:["A SECURE","FUTURE"],benefits:["PROTECT YOUR FAMILY","BUILD CASH VALUE","LEAVE A LEGACY"],benefitBar:"",cta:"TAP YOUR AGE",layout:"ref-12",masterSet:"REFERENCE_LOCKED_MASTER" },
];

function preview(master: VeteranReferenceMaster, mode: VeteranReferenceMode): VeteranReferencePreview {
  const capability = mode !== "SAFE_MODE";
  return {
    ...master,
    previewId:`${master.masterId}_${mode}`,
    mode,
    imageUrl:mode === "IMAGE_VARIANT" || master.palette === "image-dark" ? master.imageUrl : "",
    hero:capability ? ["$50,000"] : master.safeHero,
    heroKind:capability ? "amount" : "safe",
    ageOptions:VETERAN_REFERENCE_AGE_OPTIONS,
    ownerApprovalStatus:"PENDING_REVIEW",
    deployed:false,
    capabilityFixtureId:capability ? VETERAN_REFERENCE_CAPABILITY_FIXTURE.fixtureId : null,
  };
}

export function buildVeteranReferenceLocked12() {
  const referenceMasters = masters.map((master) => ({...master}));
  return {
    referenceMasters,
    capabilityPreviews:referenceMasters.map((master)=>preview(master,"TEST_CAPABILITY")),
    safePreviews:referenceMasters.map((master)=>preview(master,"SAFE_MODE")),
    imagePreviews:referenceMasters.filter((master)=>master.imageCompatible).map((master)=>preview(master,"IMAGE_VARIANT")),
  };
}
