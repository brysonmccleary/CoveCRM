// lib/facebook/winningAdLibrary.ts
//
// WINNER-FIRST AD LIBRARY — source of truth for all supported lead types.
// final_expense | mortgage_protection | veteran | trucker | iul
//
// AI cannot invent structure. This library locks the families.
// Controlled variation engine picks deterministically from pools.
// ─────────────────────────────────────────────────────────────────────────────

export type WinnerLeadType = "final_expense" | "mortgage_protection" | "veteran" | "trucker" | "iul";
export type AudienceSegment = "standard" | "veteran" | "trucker";
export type VariantType = "emotional" | "logical" | "curiosity";
export type AdFormat = "long_copy" | "card" | "video_copy" | "benefit_stack" | "family_emotional";

export type WinningAdFamily = {
  id: string;
  leadType: WinnerLeadType;
  audienceSegment?: AudienceSegment;
  archetype: string;
  familyName: string;
  vendorStyleTag: string;
  priority: number; // 1 = top preference
  format: AdFormat;
  visualDirection: string;
  copyBlueprint: {
    headlinePool: string[];
    hookPool: string[];
    introPool?: string[];
    bodyPointPool?: string[];
    bulletPool?: string[];
    ctaPool: string[];
    disclaimerPool?: string[];
    ageButtonPools?: string[][];
    amountButtonPools?: string[][];
    approvedCoverageAmounts?: number[];
    approvedPremiumExamples?: string[];
  };
  imagePromptPool: string[];
  videoScriptPool?: string[];
  landingPageConfig: {
    pageType: string;
    headlinePool: string[];
    subheadlinePool: string[];
    buttonLabelsPool: string[][];
    benefitBulletsPool: string[][];
    ctaStripPool: string[];
    theme: {
      background: string;
      accent: string;
      styleTag: string;
    };
  };
  compliance: {
    noGovernmentImplication?: boolean;
    avoidGuaranteedClaims?: boolean;
    avoidUnsupportedMedicalClaims?: boolean;
    needsReviewIfUsingApprovalLanguage?: boolean;
    allowedClaimStyle?: string[];
    notes: string[];
  };
};

export type GeneratedWinningAd = {
  familyId: string;
  leadType: string;
  audienceSegment: AudienceSegment;
  archetype: string;
  variantType: VariantType;
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
  imagePrompt: string;
  videoScript: string;
  bulletPoints: string[];
  buttonLabels: string[];
  landingPageConfig: {
    pageType: string;
    headline: string;
    subheadline: string;
    buttonLabels: string[];
    benefitBullets: string[];
    ctaStrip: string;
    theme: { background: string; accent: string; styleTag: string };
  };
  uniquenessFingerprint: string;
  complianceNotes: string[];
  vendorStyleTag: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic seed helper
// ─────────────────────────────────────────────────────────────────────────────

function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function createDeterministicVariationSeed(
  userId: string,
  campaignName: string,
  leadType: string,
  dateBucket?: string
): number {
  const bucket = dateBucket || new Date().toISOString().slice(0, 10);
  return simpleHash(`${userId}:${campaignName}:${leadType}:${bucket}`);
}

function pickFromPool<T>(pool: T[], seed: number, offset = 0): T {
  if (!pool || pool.length === 0) throw new Error("Empty pool");
  return pool[Math.abs(seed + offset) % pool.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// THE WINNING AD LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

export const WINNING_AD_LIBRARY: WinningAdFamily[] = [

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL EXPENSE
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "fe_funeral_cost_long_copy",
    leadType: "final_expense",
    archetype: "funeral_cost_long_copy",
    familyName: "Funeral Cost Long Copy",
    vendorStyleTag: "my_affordable",
    priority: 1,
    format: "long_copy",
    visualDirection: "Older couple at kitchen table reviewing documents, warm soft lighting, dignified and trustworthy, realistic photography",
    copyBlueprint: {
      headlinePool: [
        "What Funerals Cost Today",
        "Most Families Aren't Prepared For This Cost",
        "The Average Funeral Now Costs $9,000–$15,000",
      ],
      hookPool: [
        "Typical funeral costs today can run $9,000 to $15,000 or more — and that's before the extras.",
        "When the time comes, someone has to pay for it. And it usually comes from one place: your family.",
        "Most families are not prepared for this cost. They don't think about it until it's too late.",
      ],
      introPool: [
        "Funeral and burial costs have quietly risen every year. The national average now exceeds $10,000.",
        "The funeral home. The burial plot. The casket. The flowers. The service. It adds up fast.",
        "Most people assume someone else will handle it. But without a plan, it falls on the people you love most.",
      ],
      bodyPointPool: [
        "It doesn't have to be that way. There are simple, affordable options designed to cover these costs — so your family doesn't have to.",
        "A final expense plan can help your loved ones cover costs without scrambling for money during one of the hardest times of their lives.",
        "The right plan means your family isn't left making impossible choices about money when they should be grieving.",
      ],
      bulletPool: [
        "No medical exam required",
        "Rates that never increase with age",
        "Starts from just a few dollars a week",
        "Coverage designed for ages 50–85",
      ],
      ctaPool: [
        "See Your Options →",
        "Check My Rate →",
        "Learn More →",
      ],
      approvedCoverageAmounts: [25000, 35000, 40000, 50000],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image for final expense insurance, older couple at kitchen table reviewing documents together, warm soft natural lighting, realistic photography, dignified and trustworthy mood, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image for final expense insurance, senior couple sitting in cozy living room, soft warm lighting, peaceful home environment, realistic trustworthy photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image for final expense insurance, multigenerational family in warm home setting, natural realistic lighting, caring family mood, no logos, no text overlay",
    ],
    videoScriptPool: [
      "[HOOK] Typical funeral costs today can run $9,000 to $15,000 or more. [BODY] Most families are not prepared for this. Without a plan, these costs fall on the people you love most. But it doesn't have to be that way — there are simple, affordable options with no medical exam required. [CTA] Tap below to see what options may be available for you.",
      "[HOOK] When the time comes, someone has to pay for it. [BODY] The funeral home, the burial plot, the service — it adds up fast. A final expense plan can help cover these costs so your family doesn't have to worry. No exam required, rates never increase. [CTA] See your options below.",
    ],
    landingPageConfig: {
      pageType: "final_expense_long_copy",
      headlinePool: [
        "What a Funeral Costs Today",
        "Help Cover Final Expenses",
        "Plan Ahead For Your Family",
      ],
      subheadlinePool: [
        "Simple, affordable coverage — no medical exam required",
        "See what options may be available to you",
        "Coverage designed for ages 50–85",
      ],
      buttonLabelsPool: [
        ["Ages 50–59", "Ages 60–69", "Ages 70–79", "Ages 80+"],
        ["50–60", "61–70", "71–80", "81–85"],
      ],
      benefitBulletsPool: [
        ["No medical exam required", "Rates never increase with age", "Starts from a few dollars a week"],
        ["No exam options available", "Affordable monthly options", "Simple qualification process"],
      ],
      ctaStripPool: [
        "See My Options →",
        "Check My Rate →",
        "Learn More →",
      ],
      theme: {
        background: "#0f0e0a",
        accent: "#a16207",
        styleTag: "final_expense_gold",
      },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      avoidUnsupportedMedicalClaims: true,
      notes: [
        "Do not use graphic funeral language ('corpse', 'body', 'coffin lid').",
        "Use 'final expense' or 'burial coverage' framing.",
        "Avoid saying 'guaranteed acceptance' unless product is actually GI.",
        "Use 'may qualify' and 'options may be available' phrasing.",
      ],
    },
  },

  {
    id: "fe_no_exam_age_card",
    leadType: "final_expense",
    archetype: "no_exam_age_card",
    familyName: "No Exam Age Card",
    vendorStyleTag: "my_affordable",
    priority: 1,
    format: "card",
    visualDirection: "Dark near-black background with gold accent, confident senior couple, warm studio lighting, dignified and bold",
    copyBlueprint: {
      headlinePool: [
        "No 2-Year Wait",
        "Whole Life Coverage — No Exam",
        "No Waiting Period Required",
      ],
      hookPool: [
        "Tap your age to see if you qualify.",
        "Select your age range to view available coverage.",
        "See your coverage options in seconds.",
      ],
      bulletPool: [
        "No medical exam required",
        "Whole life — coverage that never expires",
        "Rates locked in at enrollment",
        "No 2-year waiting period options available",
      ],
      ctaPool: [
        "See If I Qualify →",
        "Check My Options →",
        "Learn More →",
      ],
      ageButtonPools: [
        ["50–60", "61–70", "71–80", "81–85"],
        ["Ages 50–59", "Ages 60–69", "Ages 70–79", "Ages 80+"],
      ],
      approvedCoverageAmounts: [25000, 35000, 40000, 50000],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image for final expense insurance, near-black background with gold accent lighting, confident senior couple portrait, warm dignified dramatic lighting, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image for final expense insurance, dark premium background, older smiling couple in warm studio lighting, gold accent tones, dignified and confident, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "final_expense_age_card",
      headlinePool: [
        "No 2-Year Wait — See Your Options",
        "Final Expense Coverage — No Exam",
        "Whole Life Coverage For Seniors",
      ],
      subheadlinePool: [
        "Tap your age to see if you qualify",
        "Select your age range below",
        "No exam — see options in seconds",
      ],
      buttonLabelsPool: [
        ["50–60", "61–70", "71–80", "81–85"],
        ["Ages 50–59", "Ages 60–69", "Ages 70–79", "Ages 80+"],
      ],
      benefitBulletsPool: [
        ["No medical exam required", "No 2-year wait options available", "Rates locked in at enrollment"],
        ["Whole life coverage", "No exam options", "Affordable monthly options"],
      ],
      ctaStripPool: ["See My Options →", "Check My Rate →", "Apply Now →"],
      theme: { background: "#0f0e0a", accent: "#a16207", styleTag: "final_expense_gold_bold" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Only use 'no 2-year wait' when product supports immediate benefit.",
        "Use 'options available' framing — not universal claim.",
      ],
    },
  },

  {
    id: "fe_senior_benefit_card",
    leadType: "final_expense",
    archetype: "senior_benefit_card",
    familyName: "Senior Benefit Card",
    vendorStyleTag: "my_affordable",
    priority: 2,
    format: "benefit_stack",
    visualDirection: "Warm senior-friendly photography, older couple at home, soft natural light, trustworthy and calm",
    copyBlueprint: {
      headlinePool: [
        "Coverage Up To $50,000",
        "Final Expense Coverage For Seniors",
        "Affordable Burial Insurance",
      ],
      hookPool: [
        "Seniors — see what coverage may be available to you.",
        "Coverage options designed for ages 50 to 85.",
        "Simple, affordable final expense coverage.",
      ],
      bulletPool: [
        "No medical exam options available",
        "Rates that never increase with age",
        "Affordable monthly or weekly options",
        "Coverage from a few dollars a week",
      ],
      ctaPool: ["See My Options →", "Learn More →", "Check My Rate →"],
      approvedCoverageAmounts: [25000, 35000, 40000, 50000],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image for final expense insurance, older couple smiling at home, warm natural photography, soft trustworthy lighting, senior-friendly, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, senior woman and man in a bright home, soft natural light, warm family mood, realistic photography, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "final_expense_benefit_card",
      headlinePool: ["Final Expense Coverage", "Affordable Senior Coverage", "Coverage Up To $50,000"],
      subheadlinePool: ["See what you may qualify for", "No exam options available", "Select your age to see options"],
      buttonLabelsPool: [
        ["Ages 50–59", "Ages 60–69", "Ages 70–79", "Ages 80+"],
        ["50–60", "61–70", "71–80", "81–85"],
      ],
      benefitBulletsPool: [
        ["No medical exam options available", "Rates never increase with age", "Affordable monthly options"],
        ["No exam required", "Fixed rates", "Simple qualification"],
      ],
      ctaStripPool: ["See What I Qualify For →", "Check My Options →", "Learn More →"],
      theme: { background: "#0f0e0a", accent: "#a16207", styleTag: "final_expense_warm" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: ["Use 'options available' not 'guaranteed'. Do not promise exact pricing."],
    },
  },

  {
    id: "fe_emotional_family_burden",
    leadType: "final_expense",
    archetype: "emotional_family_burden",
    familyName: "Emotional Family Burden",
    vendorStyleTag: "my_affordable",
    priority: 2,
    format: "family_emotional",
    visualDirection: "Multigenerational family in warm home setting, emotional but not dramatic, natural realistic photography",
    copyBlueprint: {
      headlinePool: [
        "Don't Leave This Bill Behind",
        "Protect Your Family From This Cost",
        "One Simple Plan Changes Everything",
      ],
      hookPool: [
        "Most families never plan for this until it's too late.",
        "The people you love most shouldn't have to cover this cost.",
        "You worked hard your whole life. Don't leave this burden behind.",
      ],
      bulletPool: [
        "No medical exam required",
        "Affordable monthly options",
        "Simple qualification process",
        "Coverage designed for ages 50–85",
      ],
      ctaPool: ["See Your Options →", "Learn More →", "Check My Rate →"],
      approvedCoverageAmounts: [25000, 35000, 40000, 50000],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, multigenerational family in warm home, emotional but peaceful, natural realistic lighting, grandmother and grandchildren, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, adult children with elderly parent, warm home setting, soft natural light, caring family mood, realistic photography, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "final_expense_emotional",
      headlinePool: ["Don't Leave This Burden Behind", "Protect Your Family", "Give Your Family Peace of Mind"],
      subheadlinePool: ["Simple affordable final expense coverage", "No exam options available", "See what you may qualify for"],
      buttonLabelsPool: [
        ["Ages 50–59", "Ages 60–69", "Ages 70–79", "Ages 80+"],
        ["50–60", "61–70", "71–80", "81–85"],
      ],
      benefitBulletsPool: [
        ["No medical exam required", "Affordable monthly options", "Simple qualification"],
        ["No exam options", "Rates never increase", "Coverage they can count on"],
      ],
      ctaStripPool: ["See My Options →", "Learn More →", "Check My Rate →"],
      theme: { background: "#0f0e0a", accent: "#a16207", styleTag: "final_expense_emotional" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: ["Avoid shaming language. Do not over-dramatize grief. Keep emotional angle respectful."],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MORTGAGE PROTECTION
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "mp_reasons_video_copy",
    leadType: "mortgage_protection",
    archetype: "mortgage_reasons_video_copy",
    familyName: "3 Reasons Video Copy",
    vendorStyleTag: "sitka",
    priority: 1,
    format: "video_copy",
    visualDirection: "Happy couple in front of suburban home, warm coral/natural tones, trustworthy realistic photography",
    copyBlueprint: {
      headlinePool: [
        "3 Simple Reasons to Protect Your Mortgage",
        "Why Homeowners Are Getting Covered Now",
        "Protect Your Family's Home",
      ],
      hookPool: [
        "3 simple reasons to protect your mortgage:",
        "Here's what most homeowners don't realize:",
        "If something happened to you tomorrow, could your family keep the house?",
      ],
      bodyPointPool: [
        "1. Financial Security — your family stays in the home if you're gone.",
        "2. Fast & Easy — no exam options available, may qualify in minutes.",
        "3. Peace of Mind — knowing your mortgage is covered changes everything.",
      ],
      bulletPool: [
        "No exam options available",
        "May qualify in minutes",
        "Coverage designed for homeowners",
        "Affordable monthly options",
      ],
      ctaPool: ["See My Rate →", "Learn More →", "Check My Options →"],
      approvedCoverageAmounts: [100000, 200000, 250000, 300000, 400000, 500000],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image for mortgage protection insurance, happy couple in front of their suburban home, warm coral natural lighting, realistic trustworthy photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, young family with children in front of their house, warm natural lighting, neighborhood setting, realistic, no logos, no text overlay",
    ],
    videoScriptPool: [
      "[HOOK] 3 simple reasons to protect your mortgage: [BODY] 1. Financial Security — your family stays in the home if you're gone. 2. Fast and Easy — no exam options, may qualify in minutes. 3. Peace of Mind — knowing it's covered changes everything. [CTA] Tap below to see what options may be available.",
      "[HOOK] If something happened to you tomorrow, could your family keep the house? [BODY] Mortgage protection is one of the simplest ways to make sure they can. No exam options available, fast approval, affordable monthly options. [CTA] Tap below to review your options.",
    ],
    landingPageConfig: {
      pageType: "mortgage_reasons",
      headlinePool: [
        "3 Simple Reasons to Protect Your Mortgage",
        "Protect Your Family's Home",
        "Affordable Mortgage Protection",
      ],
      subheadlinePool: [
        "See what options may be available",
        "No exam — may qualify in minutes",
        "Select your mortgage amount below",
      ],
      buttonLabelsPool: [
        ["$100,000", "$200,000", "$300,000", "$400,000"],
        ["$200,000", "$300,000", "$400,000", "$500,000"],
      ],
      benefitBulletsPool: [
        ["No exam options available", "May qualify in minutes", "Covers your mortgage if the unexpected happens"],
        ["No exam required", "Fast approval", "Peace of mind for your family"],
      ],
      ctaStripPool: ["See My Rate →", "Check My Options →", "Learn More →"],
      theme: { background: "#1a0a0a", accent: "#b91c1c", styleTag: "mortgage_coral" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Do not imply government affiliation.",
        "Use 'may qualify' phrasing.",
        "Do not promise exact premium without rate engine.",
      ],
    },
  },

  {
    id: "mp_amount_button_card",
    leadType: "mortgage_protection",
    archetype: "mortgage_amount_button_card",
    familyName: "Mortgage Amount Button Card",
    vendorStyleTag: "sitka",
    priority: 1,
    format: "card",
    visualDirection: "Coral/red/white card with mortgage amount buttons, family home background, trustworthy",
    copyBlueprint: {
      headlinePool: [
        "Mortgage Protection With Living Benefits",
        "Protect Your Mortgage Today",
        "Affordable Mortgage Protection",
      ],
      hookPool: [
        "Select your mortgage amount to see your rate.",
        "What's your mortgage balance? See your options below.",
        "Affordable mortgage protection with living benefits.",
      ],
      bulletPool: [
        "Cover your mortgage if something happens",
        "No exam options may be available",
        "Living benefits included on select plans",
        "May qualify in minutes",
      ],
      ctaPool: ["See My Rate →", "Check My Options →", "Learn More →"],
      amountButtonPools: [
        ["$100,000", "$200,000", "$300,000", "$400,000"],
        ["$200,000", "$300,000", "$400,000", "$500,000"],
        ["$250,000", "$400,000", "$500,000", "$600,000"],
      ],
      approvedCoverageAmounts: [100000, 200000, 250000, 300000, 400000, 500000, 600000],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, homeowner couple at front door of their home, warm coral natural lighting, realistic photography, trustworthy family-safe, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, young family in front of suburban home, warm natural light, coral/red tones, realistic, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "mortgage_amount_card",
      headlinePool: [
        "Mortgage Protection With Living Benefits",
        "Select Your Coverage Amount",
        "Protect Your Family's Home",
      ],
      subheadlinePool: [
        "Select your mortgage amount to see your rate",
        "What's your mortgage balance?",
        "See options in seconds",
      ],
      buttonLabelsPool: [
        ["$100,000", "$200,000", "$300,000", "$400,000"],
        ["$200,000", "$300,000", "$400,000", "$500,000"],
        ["$250,000", "$400,000", "$500,000", "$600,000"],
      ],
      benefitBulletsPool: [
        ["Cover your mortgage if something happens", "Living benefits included", "No exam options may be available"],
        ["No exam required", "Fast approval", "Living benefits on select plans"],
      ],
      ctaStripPool: ["See My Rate →", "Check My Options →", "Learn More →"],
      theme: { background: "#1a0a0a", accent: "#b91c1c", styleTag: "mortgage_amount_card" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Living benefits language only where product supports it.",
        "Do not promise exact rate without quoting engine.",
        "Use 'may be available' phrasing throughout.",
      ],
    },
  },

  {
    id: "mp_rate_table_card",
    leadType: "mortgage_protection",
    archetype: "mortgage_rate_table_card",
    familyName: "Rate Table Card",
    vendorStyleTag: "quility",
    priority: 2,
    format: "card",
    visualDirection: "Clean premium card layout, coverage amounts with monthly premium examples, Quility / MPP style",
    copyBlueprint: {
      headlinePool: [
        "See Your Monthly Rate",
        "Mortgage Protection — Starting Under $50/mo",
        "Affordable Coverage For Homeowners",
      ],
      hookPool: [
        "Coverage amounts and monthly examples:",
        "Protect your family from losing your home.",
        "Up to $2M in coverage available — see your rate.",
      ],
      bulletPool: [
        "Protect your family from losing your home",
        "Up to $2M in coverage options available",
        "No exam options may be available",
        "Affordable monthly premiums",
      ],
      ctaPool: ["See My Rate →", "Check My Options →", "Learn More →"],
      amountButtonPools: [
        ["$100K", "$200K", "$300K", "$500K"],
        ["$150K", "$250K", "$400K", "$600K"],
      ],
      approvedCoverageAmounts: [100000, 200000, 250000, 300000, 400000, 500000],
      approvedPremiumExamples: ["as low as $29/mo", "starting at $39/mo", "from $49/mo"],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, clean premium card design background, homeowner family in their home, warm lighting, Quility mortgage protection style, trustworthy, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, couple reviewing mortgage documents, bright clean home setting, warm trustworthy photography, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "mortgage_rate_table",
      headlinePool: ["See Your Monthly Rate", "Mortgage Protection Rates", "Coverage Built For Homeowners"],
      subheadlinePool: [
        "Select your coverage amount",
        "See monthly premium examples",
        "No exam options may be available",
      ],
      buttonLabelsPool: [
        ["$100K", "$200K", "$300K", "$500K"],
        ["$150K", "$250K", "$400K", "$600K"],
      ],
      benefitBulletsPool: [
        ["Protect your family from losing your home", "No exam options available", "Affordable monthly premiums"],
        ["Up to $2M in coverage", "No exam required", "Fast approval"],
      ],
      ctaStripPool: ["See My Rate →", "Check My Options →", "Learn More →"],
      theme: { background: "#1a0a0a", accent: "#b91c1c", styleTag: "mortgage_rate_table" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Premium examples must be clearly labeled as 'examples' or 'starting at'.",
        "Do not promise exact rates without quoting engine.",
      ],
    },
  },

  {
    id: "mp_simple_benefit_card",
    leadType: "mortgage_protection",
    archetype: "mortgage_simple_benefit_card",
    familyName: "Simple Benefit Card",
    vendorStyleTag: "sitka",
    priority: 2,
    format: "benefit_stack",
    visualDirection: "Simple clean card, homeowner family, warm natural tones, trustworthy",
    copyBlueprint: {
      headlinePool: [
        "Protect Your Mortgage From Day One",
        "Term Policy Built For Homeowners",
        "Simple Mortgage Protection",
      ],
      hookPool: [
        "An affordable term policy designed to cover your mortgage.",
        "Simple mortgage protection — see what options may be available.",
        "Most homeowners don't think about this until it's too late.",
      ],
      bulletPool: [
        "Designed to cover your mortgage balance",
        "No exam options may be available",
        "Living benefits on select plans",
        "May qualify in minutes",
      ],
      ctaPool: ["See My Options →", "Learn More →", "Check My Rate →"],
      approvedCoverageAmounts: [100000, 200000, 250000, 300000, 400000, 500000],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, homeowner family in front of house, warm natural lighting, simple trustworthy photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, couple at home reviewing paperwork, warm interior lighting, trustworthy realistic photography, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "mortgage_simple_benefit",
      headlinePool: ["Simple Mortgage Protection", "Protect Your Mortgage", "Coverage For Homeowners"],
      subheadlinePool: [
        "See what options may be available",
        "No exam — may qualify in minutes",
        "Affordable term policy for homeowners",
      ],
      buttonLabelsPool: [
        ["$100,000", "$200,000", "$300,000", "$400,000"],
        ["$200,000", "$300,000", "$400,000", "$500,000"],
      ],
      benefitBulletsPool: [
        ["Cover your mortgage if something happens", "No exam options available", "Fast approval"],
        ["Designed for homeowners", "No exam required", "Affordable monthly options"],
      ],
      ctaStripPool: ["See My Options →", "Learn More →", "Check My Rate →"],
      theme: { background: "#1a0a0a", accent: "#b91c1c", styleTag: "mortgage_simple" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: ["Use 'may be available' phrasing. Do not promise exact savings."],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // VETERAN
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "vet_patriotic_amount_card",
    leadType: "veteran",
    archetype: "patriotic_amount_card",
    familyName: "Patriotic Amount Card",
    vendorStyleTag: "market_veteran",
    priority: 1,
    format: "card",
    visualDirection: "Patriotic red/blue/gold, veteran-aged civilian with family at home, NO military uniforms or government insignia",
    copyBlueprint: {
      headlinePool: [
        "Veterans Life Insurance",
        "Coverage Built For Veterans",
        "Veterans — See Your Options",
      ],
      hookPool: [
        "You served. Your coverage options didn't stop when you left.",
        "Built for veterans and military families.",
        "Private coverage designed for those who served.",
      ],
      bulletPool: [
        "Private market coverage — not VA",
        "No exam options may be available",
        "Locked-in rates",
        "Designed for veterans and families",
      ],
      ctaPool: ["Check My Options →", "See My Rate →", "Learn More →"],
      amountButtonPools: [
        ["$50,000", "$100,000", "$250,000", "$500,000"],
        ["$100,000", "$250,000", "$500,000", "$1,000,000"],
      ],
      approvedCoverageAmounts: [50000, 100000, 250000, 500000],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, veteran-aged man with family at home, patriotic red/blue/gold color palette, civilian home setting, no military uniforms, no government insignia, realistic photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, American flag in background, veteran-aged civilian portrait, patriotic tones, no military uniforms, realistic photography, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "veteran_amount_card",
      headlinePool: [
        "Veterans Life Insurance",
        "Coverage Built For Veterans",
        "Private Coverage For Those Who Served",
      ],
      subheadlinePool: [
        "Private coverage — not VA",
        "Select your coverage amount below",
        "See your options in seconds",
      ],
      buttonLabelsPool: [
        ["$50,000", "$100,000", "$250,000", "$500,000"],
        ["$100,000", "$250,000", "$500,000", "$1,000,000"],
      ],
      benefitBulletsPool: [
        ["Private market coverage — not VA", "No exam options may be available", "Review takes under 60 seconds"],
        ["Not a government program", "No exam required", "Fast approval"],
      ],
      ctaStripPool: ["Check My Options →", "See My Rate →", "Learn More →"],
      theme: { background: "#0a0f1a", accent: "#1d4ed8", styleTag: "veteran_patriotic" },
    },
    compliance: {
      noGovernmentImplication: true,
      needsReviewIfUsingApprovalLanguage: true,
      allowedClaimStyle: ["private-market", "benefit-style"],
      notes: [
        "NEVER imply VA, government, or military endorsement.",
        "NEVER use official seals, military ranks, or government logos.",
        "Always state 'private market coverage — not VA'.",
        "Use 'may be available' and 'review' framing.",
      ],
    },
  },

  {
    id: "vet_age_qualifier_card",
    leadType: "veteran",
    archetype: "age_qualifier_card",
    familyName: "Age Qualifier Card",
    vendorStyleTag: "market_veteran",
    priority: 1,
    format: "card",
    visualDirection: "Bold patriotic flag background, veteran identity first, age buttons prominent",
    copyBlueprint: {
      headlinePool: [
        "Did You Serve?",
        "Veterans — Tap Your Age",
        "Check Your Veteran Coverage Options",
      ],
      hookPool: [
        "Did you serve between 1955 and 1985?",
        "Did you serve between 1965 and 1995?",
        "Tap your age to view available private coverage options.",
      ],
      bulletPool: [
        "Private market coverage — not VA",
        "No exam options may be available",
        "Fast qualification — review in under 60 seconds",
      ],
      ctaPool: ["View Available Benefits →", "Check My Options →", "See What I Qualify For →"],
      ageButtonPools: [
        ["Under 50", "50–60", "61–70", "71–79"],
        ["30–49", "50–65", "66–79", "80+"],
        ["30–49", "50–60", "61–75", "76+"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, American flag background, veteran-aged civilian, bold patriotic composition, no military uniforms or government insignia, realistic photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, patriotic red/white/blue tones, veteran-aged adult portrait, civilian setting, strong patriotic mood, no military uniforms, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "veteran_age_qualifier",
      headlinePool: [
        "Veterans — Check Your Coverage Options",
        "Did You Serve? See Your Options",
        "Veterans Coverage — Tap Your Age",
      ],
      subheadlinePool: [
        "Tap your age to view available private coverage",
        "Private market coverage — not a government program",
        "View available benefits for veterans",
      ],
      buttonLabelsPool: [
        ["Under 50", "50–60", "61–70", "71–79"],
        ["30–49", "50–65", "66–79", "80+"],
      ],
      benefitBulletsPool: [
        ["Private market coverage — not VA", "No exam options may be available", "Review in under 60 seconds"],
        ["Not a government program", "Fast qualification", "For veterans and military families"],
      ],
      ctaStripPool: ["View My Options →", "Check My Benefits →", "See What I Qualify For →"],
      theme: { background: "#0a0f1a", accent: "#1d4ed8", styleTag: "veteran_qualifier" },
    },
    compliance: {
      noGovernmentImplication: true,
      needsReviewIfUsingApprovalLanguage: true,
      allowedClaimStyle: ["private-market", "benefit-style"],
      notes: [
        "Do not suggest government benefit unlock.",
        "Frame as private market review only.",
        "Avoid 'new benefit' or 'just released' language.",
      ],
    },
  },

  {
    id: "vet_benefit_unlock_long_copy",
    leadType: "veteran",
    archetype: "veteran_benefit_unlock_long_copy",
    familyName: "Benefit Unlock Long Copy",
    vendorStyleTag: "market_veteran",
    priority: 1,
    format: "long_copy",
    visualDirection: "Patriotic but civilian, veteran-aged adult, bold text-heavy layout, strong identity hook",
    copyBlueprint: {
      headlinePool: [
        "Your Service Ended. Your Advantages Didn't.",
        "Veterans-Only Coverage — Not Available to the Public",
        "Benefits You Earned. Don't Leave Them Behind.",
      ],
      hookPool: [
        "YOUR SERVICE ENDED. YOUR ADVANTAGES DIDN'T.",
        "This private coverage is not available to the general public.",
        "Most veterans don't know about this option.",
      ],
      introPool: [
        "Veterans have access to private market coverage options not widely advertised to civilians.",
        "There are private insurance options designed specifically for veterans and their families.",
        "After serving, you deserve simple, straightforward coverage that works for you.",
      ],
      bodyPointPool: [
        "This is private market coverage — it is not a VA program and it is not a government benefit.",
        "It's designed for veterans who want straightforward private coverage with simple qualification.",
        "No lengthy process. No runaround. Review your options in under 60 seconds.",
      ],
      bulletPool: [
        "Veteran-only private market coverage",
        "No exam options available",
        "Locked-in rates for life",
        "Simple qualification process",
        "Not available to the general public",
      ],
      ctaPool: ["See If I Qualify →", "View My Options →", "Check My Coverage →"],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, veteran-aged civilian man in home setting, patriotic color palette, strong proud mood, no military uniforms or government insignia, realistic photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, American flag subtly visible in background, veteran-aged adult, warm civilian home, patriotic mood without official symbols, no logos, no text overlay",
    ],
    videoScriptPool: [
      "[HOOK] Your service ended. Your advantages didn't. [BODY] There are private market coverage options designed specifically for veterans — not available to the general public. No exam options, locked-in rates, simple qualification. This is private coverage — not a VA program. [CTA] Tap below to see if you qualify.",
    ],
    landingPageConfig: {
      pageType: "veteran_long_copy",
      headlinePool: [
        "Your Service Ended. Your Advantages Didn't.",
        "Veterans-Only Private Coverage",
        "Built For Veterans — Not Available to the Public",
      ],
      subheadlinePool: [
        "Private market coverage — not a VA program",
        "See what options may be available to you",
        "Not available to civilians",
      ],
      buttonLabelsPool: [
        ["Under 50", "50–60", "61–70", "71–79"],
        ["30–49", "50–65", "66–79", "80+"],
      ],
      benefitBulletsPool: [
        ["Veteran-only private market coverage", "No exam options available", "Locked-in rates", "Simple qualification"],
        ["Private market — not VA", "No exam required", "Rates locked in", "Fast review"],
      ],
      ctaStripPool: ["See If I Qualify →", "View My Options →", "Check My Coverage →"],
      theme: { background: "#0a0f1a", accent: "#1d4ed8", styleTag: "veteran_long_copy" },
    },
    compliance: {
      noGovernmentImplication: true,
      needsReviewIfUsingApprovalLanguage: true,
      allowedClaimStyle: ["private-market"],
      notes: [
        "CRITICAL: Must always state this is private market — NOT a VA or government program.",
        "Do not use 'benefit unlock' framing that implies government entitlement.",
        "Exclusivity framing ('not available to civilians') is OK for private market — just do not imply official status.",
        "Do not use military rank, insignia, or government seals in any format.",
      ],
    },
  },

  {
    id: "vet_family_term_card",
    leadType: "veteran",
    archetype: "veteran_family_term_card",
    familyName: "Veteran Family Term Card",
    vendorStyleTag: "market_veteran",
    priority: 2,
    format: "family_emotional",
    visualDirection: "Veteran with spouse and children at home, civilian setting, warm and respectful, patriotic color palette",
    copyBlueprint: {
      headlinePool: [
        "Veterans Term Life Insurance",
        "Built For Veterans — Protect Your Family",
        "Veteran Life Coverage",
      ],
      hookPool: [
        "Built for veterans. Designed to protect your family.",
        "Veterans term life insurance — simple, straightforward, affordable.",
        "You protected your country. Now protect your family.",
      ],
      bulletPool: [
        "30-year term coverage options",
        "Built for veterans and their families",
        "May qualify in minutes",
        "Private market coverage — not VA",
      ],
      ctaPool: ["See My Rate →", "Check My Options →", "Learn More →"],
      approvedCoverageAmounts: [50000, 100000, 250000, 500000],
      approvedPremiumExamples: ["from $29/mo", "starting at $39/mo", "as low as $49/mo"],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, veteran-aged man with spouse and children at home, warm patriotic color palette, civilian setting, emotional family mood, no military uniforms, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, family portrait in warm home, patriotic red/blue accent tones, realistic photography, civilian setting, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "veteran_family_term",
      headlinePool: [
        "Veterans Term Life Insurance",
        "Protect Your Family — Built For Veterans",
        "Veteran Life Coverage",
      ],
      subheadlinePool: [
        "Private market coverage — not VA",
        "See your rate in seconds",
        "Built for veterans and their families",
      ],
      buttonLabelsPool: [
        ["$50,000", "$100,000", "$250,000", "$500,000"],
        ["$100,000", "$250,000", "$500,000"],
      ],
      benefitBulletsPool: [
        ["30-year term coverage options", "Private market — not VA", "May qualify in minutes"],
        ["Built for veterans", "No exam options", "Fast approval"],
      ],
      ctaStripPool: ["See My Rate →", "Check My Options →", "Learn More →"],
      theme: { background: "#0a0f1a", accent: "#1d4ed8", styleTag: "veteran_family_term" },
    },
    compliance: {
      noGovernmentImplication: true,
      allowedClaimStyle: ["private-market", "term-style"],
      notes: [
        "Always frame as private market term life — not a VA or government program.",
        "Premium examples must be clearly illustrative.",
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TRUCKER
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "trk_neon_card",
    leadType: "trucker",
    archetype: "neon_trucker_card",
    familyName: "Neon Trucker Card",
    vendorStyleTag: "market_trucker",
    priority: 1,
    format: "card",
    visualDirection: "Bold neon-inspired trucker card, TRUCKERS headline large, age buttons, dark background with amber/orange neon glow",
    copyBlueprint: {
      headlinePool: [
        "TRUCKERS — See Your Rate",
        "Truck Drivers — Coverage Built For You",
        "CDL Drivers — View Your Options",
      ],
      hookPool: [
        "What happens if the wheels stop turning?",
        "If you're a truck driver, this matters.",
        "Keep your income rolling — no matter what.",
      ],
      bulletPool: [
        "No exam options available",
        "Built for CDL commercial drivers",
        "Fast approval — for busy drivers",
        "Affordable options for people on the road",
      ],
      ctaPool: ["View My Rate →", "Check My Options →", "See My Rate →"],
      ageButtonPools: [
        ["35–45", "45–55", "55–65", "65+"],
        ["35–44", "45–54", "55–64", "65+"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, commercial semi truck on open American highway at night with dramatic amber neon lighting, bold and strong, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, truck driver in cab with bold dramatic neon-orange lighting, strong working-class mood, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "trucker_neon_card",
      headlinePool: [
        "TRUCKERS — See Your Rate",
        "CDL Drivers — Coverage Built For You",
        "Truck Driver Life Insurance",
      ],
      subheadlinePool: [
        "Tap your age to view your options",
        "Select your age range below",
        "Built for CDL commercial drivers",
      ],
      buttonLabelsPool: [
        ["35–45", "45–55", "55–65", "65+"],
        ["35–44", "45–54", "55–64", "65+"],
      ],
      benefitBulletsPool: [
        ["No exam options available", "Built for CDL drivers", "Fast approval"],
        ["No exam required", "Options for commercial drivers", "Review in under 60 seconds"],
      ],
      ctaStripPool: ["View My Rate →", "Check My Options →", "See My Rate →"],
      theme: { background: "#0a0a0a", accent: "#d97706", styleTag: "trucker_neon" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Do not say all other carriers deny truckers.",
        "Use 'options available' framing.",
        "Do not make absolute approval claims.",
      ],
    },
  },

  {
    id: "trk_patriotic_card",
    leadType: "trucker",
    archetype: "patriotic_trucker_card",
    familyName: "Patriotic Trucker Card",
    vendorStyleTag: "market_trucker",
    priority: 1,
    format: "card",
    visualDirection: "American flag background, truck lineup, age buttons, rugged Americana — red/white/blue, strong working-class feel",
    copyBlueprint: {
      headlinePool: [
        "American Truckers — Check Your Coverage",
        "CDL Drivers — Your Rate In Seconds",
        "Truck Driver Life Insurance",
      ],
      hookPool: [
        "Coverage built for the people who keep America moving.",
        "What happens if the wheels stop turning and the bills keep coming?",
        "Protect your family while you're on the road.",
      ],
      bulletPool: [
        "No exam options available",
        "Fast approval — built for drivers",
        "Coverage for CDL commercial drivers",
        "Income continuity and family protection",
      ],
      ctaPool: ["See My Rate →", "Check My Options →", "View My Rate →"],
      ageButtonPools: [
        ["35–44", "45–54", "55–64", "65+"],
        ["35–45", "45–55", "55–65", "65+"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, American flag in background with a line of semi trucks, rugged Americana, patriotic red/white/blue, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, truck driver standing near semi on open highway at sunrise, rugged patriotic American feel, red/white/blue tones, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "trucker_patriotic",
      headlinePool: [
        "American Truckers — Check Your Coverage",
        "CDL Drivers — See Your Rate",
        "Coverage For The People Who Keep America Moving",
      ],
      subheadlinePool: [
        "Tap your age to see your options",
        "Built for CDL commercial drivers",
        "Select your age range below",
      ],
      buttonLabelsPool: [
        ["35–44", "45–54", "55–64", "65+"],
        ["35–45", "45–55", "55–65", "65+"],
      ],
      benefitBulletsPool: [
        ["No exam options available", "Built for CDL drivers", "Protect your family on the road"],
        ["No exam required", "Fast approval", "Options for commercial drivers"],
      ],
      ctaStripPool: ["See My Rate →", "Check My Options →", "View My Rate →"],
      theme: { background: "#0a0a0a", accent: "#d97706", styleTag: "trucker_patriotic" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Do not imply that standard carriers universally deny truckers.",
        "Use 'options available' phrasing.",
      ],
    },
  },

  {
    id: "trk_scenic_benefit",
    leadType: "trucker",
    archetype: "scenic_benefit_trucker",
    familyName: "Scenic Benefit Trucker",
    vendorStyleTag: "market_trucker",
    priority: 2,
    format: "benefit_stack",
    visualDirection: "Scenic highway/mountain/road background, practical tone, 2-3 benefit bullets, learn more CTA",
    copyBlueprint: {
      headlinePool: [
        "Coverage Built For Drivers",
        "Simple Insurance For CDL Holders",
        "Truckers — Learn More",
      ],
      hookPool: [
        "Coverage built for people on the road.",
        "Simple, affordable options for CDL drivers.",
        "Protect your family while you're hauling.",
      ],
      bulletPool: [
        "No exam options available",
        "Fast approval — for busy people",
        "Built for CDL commercial drivers",
        "Designed for people with demanding schedules",
      ],
      ctaPool: ["Learn More →", "See My Options →", "Check My Rate →"],
      ageButtonPools: [
        ["35–45", "45–55", "55–65", "65+"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, scenic mountain highway with semi truck in distance, warm golden hour lighting, open road Americana, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, open highway with truck at sunset, warm amber tones, vast American landscape, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "trucker_scenic_benefit",
      headlinePool: ["Coverage Built For Drivers", "Simple CDL Driver Coverage", "Truckers — See Your Options"],
      subheadlinePool: [
        "Select your age to see options",
        "Simple options for busy people",
        "Built for CDL commercial drivers",
      ],
      buttonLabelsPool: [
        ["35–45", "45–55", "55–65", "65+"],
        ["35–44", "45–54", "55–64", "65+"],
      ],
      benefitBulletsPool: [
        ["No exam options available", "Fast approval", "Built for CDL drivers"],
        ["No exam required", "Options for busy drivers", "Simple qualification"],
      ],
      ctaStripPool: ["Learn More →", "See My Options →", "Check My Rate →"],
      theme: { background: "#0a0a0a", accent: "#d97706", styleTag: "trucker_scenic" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: ["Use 'options available' framing. Do not promise exact rates."],
    },
  },

  {
    id: "trk_problem_solution",
    leadType: "trucker",
    archetype: "driver_specific_problem_solution",
    familyName: "Driver Problem/Solution",
    vendorStyleTag: "market_trucker",
    priority: 2,
    format: "long_copy",
    visualDirection: "Copy-led, practical working-class tone, no-nonsense language for CDL drivers",
    copyBlueprint: {
      headlinePool: [
        "If You're a Truck Driver, This Matters",
        "Most Policies Aren't Built For Drivers",
        "CDL-Friendly Coverage",
      ],
      hookPool: [
        "If you're a truck driver, this matters.",
        "Many standard policies aren't designed for CDL drivers.",
        "There's a simpler option — built for people on the road.",
      ],
      bodyPointPool: [
        "Many policies have restrictions that can be tough for commercial drivers.",
        "There are options specifically designed for CDL holders — straightforward, no runaround.",
        "No exam options available. Fast approval. Built for people with demanding schedules.",
      ],
      bulletPool: [
        "No exam required",
        "Fast approval",
        "Built for CDL holders",
        "Designed for people on the road",
      ],
      ctaPool: ["See My Options →", "Learn More →", "Check My Rate →"],
      ageButtonPools: [
        ["35–45", "45–55", "55–65", "65+"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, truck driver in cab looking thoughtful, realistic working-class photography, warm but practical tone, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, CDL driver reviewing paperwork at truck stop, realistic and practical, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "trucker_problem_solution",
      headlinePool: [
        "If You're a Truck Driver, This Matters",
        "Coverage Built For CDL Holders",
        "Simple Coverage For Drivers",
      ],
      subheadlinePool: [
        "See what options may be available",
        "No exam — fast approval",
        "Built for CDL commercial drivers",
      ],
      buttonLabelsPool: [
        ["35–45", "45–55", "55–65", "65+"],
        ["35–44", "45–54", "55–64", "65+"],
      ],
      benefitBulletsPool: [
        ["No exam required", "Fast approval", "Built for CDL holders", "For people on the road"],
        ["No exam", "Fast qualification", "CDL-friendly", "Simple options"],
      ],
      ctaStripPool: ["See My Options →", "Learn More →", "Check My Rate →"],
      theme: { background: "#0a0a0a", accent: "#d97706", styleTag: "trucker_copy" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Do not say other carriers universally reject CDL drivers.",
        "Use 'options available' framing.",
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // IUL
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "iul_tax_efficient_retirement",
    leadType: "iul",
    audienceSegment: "standard",
    archetype: "tax_efficient_retirement_education",
    familyName: "Tax-Efficient Retirement Education",
    vendorStyleTag: "iul_education",
    priority: 1,
    format: "benefit_stack",
    visualDirection: "Professional couple reviewing retirement plan at home office table, premium blue/gold/white palette, clean educational mood",
    copyBlueprint: {
      headlinePool: [
        "Explore Tax-Efficient Retirement Options",
        "Life Insurance With Cash Value Education",
        "A Different Way To Plan For Retirement",
      ],
      hookPool: [
        "If you're saving for the future, it may be worth learning how cash value life insurance works.",
        "Indexed universal life can combine family protection with cash value growth potential.",
        "Some families use IUL as part of a broader retirement and legacy strategy.",
      ],
      bulletPool: [
        "Permanent life insurance protection",
        "Cash value growth potential tied to an index",
        "Downside protection features, subject to policy terms",
        "Educational review with a licensed professional",
      ],
      ctaPool: ["Learn About IUL →", "Review My Options →", "Start My Review →"],
      amountButtonPools: [
        ["Protection", "Cash Value", "Retirement", "Legacy"],
        ["Family", "Retirement", "Tax Strategy", "Learn More"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image for indexed universal life insurance education, professional couple reviewing retirement documents at modern home office table, premium blue gold and white palette, clean realistic photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, middle-aged couple meeting with a financial professional in a bright office, calm educational mood, premium blue and gold tones, realistic photography, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "iul_tax_efficient_retirement",
      headlinePool: [
        "Explore IUL Options",
        "Learn How IUL May Fit Your Plan",
        "Cash Value Life Insurance Education",
      ],
      subheadlinePool: [
        "Educational review only — no guarantees or projections",
        "See if indexed universal life may fit your goals",
        "A licensed professional can explain options for your state",
      ],
      buttonLabelsPool: [
        ["Protection", "Cash Value", "Retirement", "Legacy"],
        ["Learn IUL", "Compare Options", "Family Protection", "Planning Review"],
      ],
      benefitBulletsPool: [
        ["Protection plus cash value potential", "Index-linked crediting subject to caps and limits", "Licensed educational review"],
        ["Family protection", "Tax-advantaged potential", "Downside protection features subject to policy terms"],
      ],
      ctaStripPool: ["Start My IUL Review →", "Learn About IUL →", "Review My Options →"],
      theme: { background: "#f8fbff", accent: "#1d4ed8", styleTag: "iul_blue_gold" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      avoidUnsupportedMedicalClaims: true,
      notes: [
        "Educational only. Do not provide tax, legal, or investment advice.",
        "Do not promise tax-free income, guaranteed returns, or market-like gains.",
        "Mention caps, participation rates, fees, and policy terms when discussing growth.",
      ],
    },
  },

  {
    id: "iul_cash_value_education",
    leadType: "iul",
    audienceSegment: "standard",
    archetype: "cash_value_education",
    familyName: "Cash Value Education",
    vendorStyleTag: "iul_education",
    priority: 1,
    format: "card",
    visualDirection: "Clean educational card feel, family at kitchen table reviewing future planning, premium blue and white palette",
    copyBlueprint: {
      headlinePool: [
        "Cash Value Life Insurance",
        "Learn How IUL Works",
        "Protection + Cash Value Potential",
      ],
      hookPool: [
        "IUL is not a stock market account — it's life insurance with cash value potential.",
        "Curious how cash value life insurance works?",
        "Learn the pros, limits, and tradeoffs before making a decision.",
      ],
      bulletPool: [
        "Family protection first",
        "Cash value potential over time",
        "Index-linked crediting with limits",
        "Licensed review, no obligation",
      ],
      ctaPool: ["Learn More →", "Review My Options →", "Start My Review →"],
      amountButtonPools: [
        ["Protection", "Cash Value", "Legacy", "Retirement"],
        ["Beginner", "Compare", "Learn", "Review"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image for cash value life insurance education, family at kitchen table reviewing simple planning documents, bright clean home setting, premium blue and white palette, realistic photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, parent couple planning future finances at home with laptop and documents, calm trustworthy educational mood, realistic photography, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "iul_cash_value_education",
      headlinePool: ["Learn How IUL Works", "Cash Value Life Insurance Review", "Protection + Cash Value Potential"],
      subheadlinePool: [
        "Understand the benefits, costs, and tradeoffs",
        "Educational review with a licensed professional",
        "No hype, no guarantees — just a clear review",
      ],
      buttonLabelsPool: [
        ["Protection", "Cash Value", "Legacy", "Retirement"],
        ["Learn Basics", "Compare Options", "Ask Questions", "Review Fit"],
      ],
      benefitBulletsPool: [
        ["Life insurance protection", "Cash value potential", "Policy terms and costs explained"],
        ["Educational review", "No obligation", "State-specific options"],
      ],
      ctaStripPool: ["Start My Review →", "Learn More →", "Review My Options →"],
      theme: { background: "#f8fbff", accent: "#1d4ed8", styleTag: "iul_education" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Do not call IUL an investment account.",
        "Avoid 'risk-free' language.",
        "Explain that loans, withdrawals, fees, caps, and policy lapse risk matter.",
      ],
    },
  },

  {
    id: "iul_family_legacy",
    leadType: "iul",
    audienceSegment: "standard",
    archetype: "family_legacy_planning",
    familyName: "Family Legacy Planning",
    vendorStyleTag: "iul_legacy",
    priority: 2,
    format: "family_emotional",
    visualDirection: "Multigenerational family in bright home, premium but warm, legacy and protection feeling without luxury exaggeration",
    copyBlueprint: {
      headlinePool: [
        "Protect Your Family And Plan Ahead",
        "Family Protection With Cash Value Potential",
        "Legacy Planning Starts With Education",
      ],
      hookPool: [
        "The right life insurance plan can protect your family today and help you plan for tomorrow.",
        "IUL may be worth learning about if legacy and long-term planning matter to you.",
        "Protection comes first — cash value potential is the part many families want to understand.",
      ],
      bulletPool: [
        "Permanent protection",
        "Cash value potential",
        "Legacy planning conversations",
        "Licensed educational review",
      ],
      ctaPool: ["Review My Options →", "Learn About IUL →", "Start My Review →"],
      amountButtonPools: [
        ["Family", "Legacy", "Retirement", "Protection"],
        ["Protect", "Build", "Review", "Learn"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, multigenerational family together in bright home, warm premium natural lighting, family legacy and protection mood, realistic photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, parents with children in a clean modern living room, warm family planning mood, premium blue and gold subtle accents, realistic photography, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "iul_family_legacy",
      headlinePool: ["Protect Your Family And Plan Ahead", "Family Legacy Planning Review", "IUL Education For Families"],
      subheadlinePool: [
        "Learn how protection and cash value potential can work together",
        "A licensed professional can review options for your state",
        "Educational review only — no guaranteed outcomes",
      ],
      buttonLabelsPool: [
        ["Family", "Legacy", "Retirement", "Protection"],
        ["Protect Family", "Plan Ahead", "Learn IUL", "Review Options"],
      ],
      benefitBulletsPool: [
        ["Family protection", "Cash value potential", "Legacy planning education"],
        ["Permanent coverage options", "Licensed review", "No obligation"],
      ],
      ctaStripPool: ["Review My Options →", "Start My Review →", "Learn About IUL →"],
      theme: { background: "#f8fbff", accent: "#1d4ed8", styleTag: "iul_legacy" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Do not promise wealth transfer results.",
        "Avoid estate/tax advice beyond general educational language.",
        "Use 'may fit' and 'review options' language.",
      ],
    },
  },

  {
    id: "iul_veteran_legacy",
    leadType: "iul",
    audienceSegment: "veteran",
    archetype: "veteran_iul_legacy",
    familyName: "Veteran IUL Legacy",
    vendorStyleTag: "iul_veteran",
    priority: 1,
    format: "benefit_stack",
    visualDirection: "Veteran-aged civilian with family at home, subtle patriotic blue/red accents, premium educational feel, no uniforms or insignia",
    copyBlueprint: {
      headlinePool: [
        "Veterans — Learn About IUL",
        "Private IUL Education For Veterans",
        "Legacy Planning For Those Who Served",
      ],
      hookPool: [
        "Veterans can review private-market IUL options with a licensed professional.",
        "This is private coverage education — not VA and not a government program.",
        "If family legacy and future planning matter to you, IUL may be worth understanding.",
      ],
      bulletPool: [
        "Private market coverage — not VA",
        "Family protection",
        "Cash value potential, subject to policy terms",
        "Educational review with a licensed professional",
      ],
      ctaPool: ["Review My Options →", "Learn About IUL →", "Start My Review →"],
      amountButtonPools: [
        ["Protection", "Cash Value", "Legacy", "Review"],
        ["Veteran", "Family", "Planning", "Learn"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image for veteran indexed universal life education, veteran-aged civilian with spouse at home reviewing planning documents, subtle patriotic blue and red accents, no military uniforms, no government insignia, realistic photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, veteran-aged civilian family in warm home setting, subtle American flag colors in decor, premium educational planning mood, no uniforms, no official insignia, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "iul_veteran_legacy",
      headlinePool: ["Veterans — Learn About IUL", "Private IUL Education For Veterans", "Legacy Planning For Veterans"],
      subheadlinePool: [
        "Private market coverage education — not VA",
        "Review protection and cash value potential",
        "Educational review with a licensed professional",
      ],
      buttonLabelsPool: [
        ["Protection", "Cash Value", "Legacy", "Review"],
        ["Veteran", "Family", "Planning", "Learn"],
      ],
      benefitBulletsPool: [
        ["Private market — not VA", "Family protection", "Cash value potential subject to policy terms"],
        ["No government endorsement", "Licensed review", "Educational only"],
      ],
      ctaStripPool: ["Start My Review →", "Learn About IUL →", "Review My Options →"],
      theme: { background: "#0a0f1a", accent: "#1d4ed8", styleTag: "iul_veteran" },
    },
    compliance: {
      noGovernmentImplication: true,
      avoidGuaranteedClaims: true,
      notes: [
        "Must state private market and not VA/government.",
        "No military seals, uniforms, or official insignia.",
        "No guaranteed retirement or tax-free income claims.",
      ],
    },
  },

  {
    id: "iul_trucker_cash_value",
    leadType: "iul",
    audienceSegment: "trucker",
    archetype: "trucker_iul_cash_value",
    familyName: "Trucker IUL Cash Value",
    vendorStyleTag: "iul_trucker",
    priority: 1,
    format: "benefit_stack",
    visualDirection: "Professional truck driver at home or near truck reviewing future planning, rugged but premium, blue/amber palette",
    copyBlueprint: {
      headlinePool: [
        "Truckers — Learn About IUL",
        "Cash Value Life Insurance For Drivers",
        "Future Planning For CDL Drivers",
      ],
      hookPool: [
        "Drivers spend years on the road. Your future plan should work just as hard.",
        "CDL drivers can review protection and cash value life insurance options.",
        "If you drive for a living, it may be worth learning how IUL works.",
      ],
      bulletPool: [
        "Family protection",
        "Cash value potential over time",
        "Educational review for busy drivers",
        "Policy terms, costs, and limits explained",
      ],
      ctaPool: ["Learn About IUL →", "Review My Options →", "Start My Review →"],
      ageButtonPools: [
        ["35–44", "45–54", "55–64", "65+"],
        ["35–45", "45–55", "55–65", "65+"],
      ],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image for trucker indexed universal life education, professional truck driver at home reviewing future planning documents with family nearby, rugged but premium blue and amber palette, realistic photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, CDL driver standing near semi truck at golden hour while reviewing planning paperwork, responsible future planning mood, premium blue amber tones, no logos, no text overlay",
    ],
    landingPageConfig: {
      pageType: "iul_trucker_cash_value",
      headlinePool: ["Truckers — Learn About IUL", "Cash Value Life Insurance For Drivers", "Future Planning For CDL Drivers"],
      subheadlinePool: [
        "Review protection and cash value potential",
        "Educational review built for busy drivers",
        "Understand policy terms, costs, and limits",
      ],
      buttonLabelsPool: [
        ["35–44", "45–54", "55–64", "65+"],
        ["Protection", "Cash Value", "Family", "Review"],
      ],
      benefitBulletsPool: [
        ["Family protection", "Cash value potential", "Educational review for drivers"],
        ["Licensed review", "No obligation", "Policy terms explained"],
      ],
      ctaStripPool: ["Start My Review →", "Learn About IUL →", "Review My Options →"],
      theme: { background: "#0a0a0a", accent: "#d97706", styleTag: "iul_trucker" },
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: [
        "Do not imply CDL drivers are universally denied elsewhere.",
        "Avoid guaranteed cash value or retirement income claims.",
        "Keep language educational and policy-term dependent.",
      ],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAudienceSegment(segment?: string): AudienceSegment {
  return segment === "veteran" || segment === "trucker" ? segment : "standard";
}

export function getWinningFamiliesByLeadType(
  leadType: WinnerLeadType,
  audienceSegment: AudienceSegment = "standard"
): WinningAdFamily[] {
  const normalizedSegment = normalizeAudienceSegment(audienceSegment);
  return WINNING_AD_LIBRARY
    .filter((f) => f.leadType === leadType && normalizeAudienceSegment(f.audienceSegment) === normalizedSegment)
    .sort((a, b) => a.priority - b.priority);
}

function selectFamily(families: WinningAdFamily[], seed: number): WinningAdFamily {
  // Priority-1 families get ~70% weight. Priority-2 get ~30%.
  const p1 = families.filter((f) => f.priority === 1);
  const p2 = families.filter((f) => f.priority === 2);
  if (!p1.length) return families[seed % families.length];
  // seed % 10 < 7 → pick from p1; >= 7 → pick from p2 (if exists)
  const pool = seed % 10 < 7 ? p1 : p2.length ? p2 : p1;
  return pool[seed % pool.length];
}

function buildPrimaryText(
  family: WinningAdFamily,
  seed: number,
  variantOffset: number
): string {
  const bp = family.copyBlueprint;
  const hook = pickFromPool(bp.hookPool, seed, variantOffset);

  if (family.format === "long_copy") {
    const intro = bp.introPool ? pickFromPool(bp.introPool, seed, variantOffset + 1) : "";
    const body = bp.bodyPointPool ? pickFromPool(bp.bodyPointPool, seed, variantOffset + 2) : "";
    const bullets = bp.bulletPool
      ? bp.bulletPool.map((b) => `✓ ${b}`).join("\n")
      : "";
    const cta = pickFromPool(bp.ctaPool, seed, variantOffset);
    return [hook, intro, body, bullets, cta].filter(Boolean).join("\n\n");
  }

  if (family.format === "video_copy") {
    const bodyPoints = bp.bodyPointPool ? bp.bodyPointPool.join("\n") : "";
    const cta = pickFromPool(bp.ctaPool, seed, variantOffset);
    return [hook, "", bodyPoints, "", cta].filter(Boolean).join("\n");
  }

  // card | benefit_stack | family_emotional
  const bullets = bp.bulletPool
    ? bp.bulletPool.map((b) => `✓ ${b}`).join("\n")
    : "";
  const cta = pickFromPool(bp.ctaPool, seed, variantOffset);
  return [hook, bullets, cta].filter(Boolean).join("\n\n");
}

function buildButtonLabels(family: WinningAdFamily, seed: number): string[] {
  const bp = family.copyBlueprint;
  if (bp.ageButtonPools && bp.ageButtonPools.length > 0) {
    return pickFromPool(bp.ageButtonPools, seed);
  }
  if (bp.amountButtonPools && bp.amountButtonPools.length > 0) {
    return pickFromPool(bp.amountButtonPools, seed);
  }
  return [];
}

function buildBullets(family: WinningAdFamily, seed: number, variantOffset: number): string[] {
  const bp = family.copyBlueprint;
  if (!bp.bulletPool || bp.bulletPool.length === 0) return [];
  // shuffle order deterministically by rotating based on seed + offset
  const rotateBy = (seed + variantOffset) % bp.bulletPool.length;
  return [
    ...bp.bulletPool.slice(rotateBy),
    ...bp.bulletPool.slice(0, rotateBy),
  ];
}

const VARIANT_OFFSETS: Record<VariantType, number> = {
  emotional: 0,
  logical: 7,
  curiosity: 13,
};

function buildVariant(
  family: WinningAdFamily,
  variantType: VariantType,
  baseSeed: number
): GeneratedWinningAd {
  const offset = VARIANT_OFFSETS[variantType];
  const seed = baseSeed + offset;

  const headline = pickFromPool(family.copyBlueprint.headlinePool, seed, offset);
  const primaryText = buildPrimaryText(family, seed, offset);
  const cta = pickFromPool(family.copyBlueprint.ctaPool, seed, offset);
  const imagePrompt = pickFromPool(family.imagePromptPool, seed, offset);
  const videoScript =
    family.videoScriptPool && family.videoScriptPool.length > 0
      ? pickFromPool(family.videoScriptPool, seed, offset)
      : `[HOOK] ${pickFromPool(family.copyBlueprint.hookPool, seed, offset)} [BODY] ${primaryText.split("\n\n")[1] || ""} [CTA] ${cta}`;
  const bulletPoints = buildBullets(family, seed, offset);
  const buttonLabels = buildButtonLabels(family, seed + offset);

  // Landing page config resolution
  const lp = family.landingPageConfig;
  const lpHeadline = pickFromPool(lp.headlinePool, seed, offset);
  const lpSubheadline = pickFromPool(lp.subheadlinePool, seed, offset);
  const lpButtonLabels = pickFromPool(lp.buttonLabelsPool, seed + offset);
  const lpBenefitBullets = pickFromPool(lp.benefitBulletsPool, seed, offset);
  const lpCtaStrip = pickFromPool(lp.ctaStripPool, seed, offset);

  const landingPageConfig = {
    pageType: lp.pageType,
    headline: lpHeadline,
    subheadline: lpSubheadline,
    buttonLabels: lpButtonLabels,
    benefitBullets: lpBenefitBullets,
    ctaStrip: lpCtaStrip,
    theme: { ...lp.theme },
  };

  const description = headline;

  const fingerprint = ensureUniquenessFingerprint({
    familyId: family.id,
    variantType,
    headline,
    cta,
    buttonLabels,
    baseSeed,
  });

  return {
    familyId: family.id,
    leadType: family.leadType,
    audienceSegment: normalizeAudienceSegment(family.audienceSegment),
    archetype: family.archetype,
    variantType,
    headline,
    primaryText,
    description,
    cta,
    imagePrompt,
    videoScript,
    bulletPoints,
    buttonLabels,
    landingPageConfig,
    uniquenessFingerprint: fingerprint,
    complianceNotes: family.compliance.notes,
    vendorStyleTag: family.vendorStyleTag,
  };
}

export function ensureUniquenessFingerprint(parts: {
  familyId: string;
  variantType: string;
  headline: string;
  cta: string;
  buttonLabels: string[];
  baseSeed: number;
}): string {
  const str = [
    parts.familyId,
    parts.variantType,
    parts.headline,
    parts.cta,
    parts.buttonLabels.join("|"),
    String(parts.baseSeed),
  ].join(":");
  return `wl_${simpleHash(str)}_${parts.familyId.slice(0, 12)}`;
}

export function generateWinningVariants(input: {
  leadType: WinnerLeadType;
  audienceSegment?: AudienceSegment;
  userId: string;
  campaignName: string;
  location?: string;
  familyIdOverride?: string;
}): { emotional: GeneratedWinningAd; logical: GeneratedWinningAd; curiosity: GeneratedWinningAd } {
  const { leadType, userId, campaignName, location = "", familyIdOverride } = input;
  const audienceSegment = normalizeAudienceSegment(input.audienceSegment);
  const families = getWinningFamiliesByLeadType(leadType, audienceSegment);

  if (families.length === 0) {
    throw new Error(`No winning families found for leadType: ${leadType}, audienceSegment: ${audienceSegment}`);
  }

  const baseSeed = createDeterministicVariationSeed(userId, campaignName + location, `${leadType}:${audienceSegment}`);

  let family: WinningAdFamily;
  if (familyIdOverride) {
    family = families.find((f) => f.id === familyIdOverride) ?? selectFamily(families, baseSeed);
  } else {
    family = selectFamily(families, baseSeed);
  }

  return {
    emotional: buildVariant(family, "emotional", baseSeed),
    logical: buildVariant(family, "logical", baseSeed),
    curiosity: buildVariant(family, "curiosity", baseSeed),
  };
}

// Auto-select the recommended variant by lead type
const RECOMMENDED_VARIANT: Record<WinnerLeadType, VariantType> = {
  final_expense: "emotional",
  iul: "logical",
  mortgage_protection: "logical",
  veteran: "curiosity",
  trucker: "emotional",
};

export function selectRecommendedVariant(
  leadType: WinnerLeadType,
  variants: { emotional: GeneratedWinningAd; logical: GeneratedWinningAd; curiosity: GeneratedWinningAd }
): GeneratedWinningAd {
  const type = RECOMMENDED_VARIANT[leadType] ?? "emotional";
  return variants[type];
}

export function buildWinningFunnelConfig(ad: GeneratedWinningAd): GeneratedWinningAd["landingPageConfig"] {
  return { ...ad.landingPageConfig };
}

export const WINNER_SUPPORTED_LEAD_TYPES: WinnerLeadType[] = [
  "final_expense",
  "iul",
  "mortgage_protection",
  "veteran",
  "trucker",
];

export function isWinnerSupportedLeadType(leadType: string): leadType is WinnerLeadType {
  return WINNER_SUPPORTED_LEAD_TYPES.includes(leadType as WinnerLeadType);
}

export function getWinningFamilyById(familyId: string): WinningAdFamily | null {
  const id = String(familyId || "").trim();
  return WINNING_AD_LIBRARY.find((family) => family.id === id) || null;
}

export function validateWinningVariantMetadata(input: {
  leadType: string;
  winningFamilyId: string;
  variationType: string;
  uniquenessFingerprint: string;
  vendorStyleTag: string;
}) {
  if (!isWinnerSupportedLeadType(input.leadType)) {
    throw new Error("Winner-library lead type required");
  }

  const family = getWinningFamilyById(input.winningFamilyId);
  if (!family || family.leadType !== input.leadType) {
    throw new Error("Winning ad family does not match lead type");
  }

  if (!["emotional", "logical", "curiosity"].includes(input.variationType)) {
    throw new Error("Valid winning ad variation required");
  }

  const fingerprint = String(input.uniquenessFingerprint || "").trim();
  if (!fingerprint || !fingerprint.startsWith("wl_") || !fingerprint.endsWith(family.id.slice(0, 12))) {
    throw new Error("Winning ad fingerprint required");
  }

  if (String(input.vendorStyleTag || "").trim() !== family.vendorStyleTag) {
    throw new Error("Winning ad vendor style mismatch");
  }

  return family;
}
