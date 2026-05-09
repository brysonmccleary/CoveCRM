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
  disabled?: boolean;
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

function clampVariantCount(value: any): number {
  return Math.min(4, Math.max(1, Number(value) || 3));
}

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
    visualDirection: "Premium final expense direct-response layout, dark gold poster composition, structured typography zones, age or benefit card panels, no lifestyle photography",
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
      "Direct-response final expense Facebook ad creative background, premium dark black and gold poster layout, blank reserved headline area for app-rendered text, clean graphic background with space for overlay, senior-focused graphic treatment, no readable text inside image, no logos, NOT lifestyle photography, NO family-photo scene",
      "Direct-response final expense insurance background, dark gold graphic layout, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, dignified premium layout, no readable text inside image, no logos, NO soft home stock-photo scene",
      "Premium final expense ad creative, near-black background with gold accents, bold benefit stack, clean CTA panel, senior-focused but graphic-ad style, no logos, NO family-group photography",
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
    visualDirection: "Dark near-black background with gold accent, senior-focused direct-response card, bold typography zones, dignified and graphic",
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
      "Direct-response final expense insurance ad creative background, near-black background with gold accent panels, blank reserved headline area for app-rendered text, clean graphic background with space for overlay, no readable text inside image, no logos, NOT lifestyle photography",
      "Premium dark gold final expense ad background, structured poster composition, clean graphic background with space for overlay, blank reserved CTA/button area for app-rendered UI, senior-focused graphic design, no readable text inside image, no logos, NOT cozy couple stock photo",
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
    visualDirection: "Senior-friendly final expense direct-response layout, dark gold benefit stack, large coverage amount panel, no lifestyle photography",
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
      "Direct-response final expense Facebook ad creative background, senior-focused clean graphic layout, dark gold and cream reserved overlay areas, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NOT smiling home stock photography",
      "Final expense benefit-stack ad creative background, premium black and gold graphic layout, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NOT bright home lifestyle photography",
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
    disabled: true,
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
    visualDirection: "Home-focused mortgage protection direct-response layout, house and key visual, mortgage amount button zones, clean CTA panel, no generic lifestyle stock photography",
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
      "Direct-response mortgage protection Facebook ad creative background, home-focused poster composition, house hero visual, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NOT lifestyle stock photography",
      "Mortgage protection ad creative background, clean graphic layout with home silhouette, key and mortgage balance visual, bold red white navy palette, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NO generic family stock-photo scene",
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
    visualDirection: "Coral/red/white direct-response card with mortgage amount buttons, home-focused background, trustworthy graphic layout",
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
      "Direct-response mortgage protection ad creative background, red and white clean home exterior graphic, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NOT homeowner couple stock photography",
      "Mortgage protection Facebook ad background, structured poster layout, house hero image, blank reserved CTA/button area for app-rendered UI, clean graphic background with space for overlay, no readable text inside image, no logos, NO generic family lifestyle photo",
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
      "Direct-response mortgage protection ad creative background, clean premium graphic design, house/key icon-style visual, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NOT homeowner family photography",
      "Mortgage protection ad creative background, clean home-focused background, red white navy palette, blank reserved overlay areas for app-rendered text and UI, no readable text inside image, no logos, NOT paperwork table stock photography",
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
    visualDirection: "Simple clean mortgage protection direct-response card, home and mortgage balance visual, benefit stack, trustworthy graphic layout",
    copyBlueprint: {
      headlinePool: [
        "Protect Your Mortgage From Day One",
        "Mortgage Protection Built For Homeowners",
        "Simple Mortgage Protection",
      ],
      hookPool: [
        "Mortgage protection options designed to help cover your mortgage balance.",
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
      "Direct-response mortgage protection ad creative background, simple clean graphic layout, house hero visual, mortgage balance visual, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NOT family in front of house stock photography",
      "Mortgage protection graphic ad background, structured home/key composition, high contrast clean layout, blank reserved overlay areas for app-rendered text and UI, no readable text inside image, no logos, NO paperwork-table scene",
    ],
    landingPageConfig: {
      pageType: "mortgage_simple_benefit",
      headlinePool: ["Simple Mortgage Protection", "Protect Your Mortgage", "Coverage For Homeowners"],
      subheadlinePool: [
        "See what options may be available",
        "No exam — may qualify in minutes",
        "Mortgage protection options for homeowners",
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
    visualDirection: "Bold patriotic direct-response layout, veteran-aged civilian male, American flag texture, navy/gold/cream/red typography zones, NO family portraits, NO kids, NO military uniforms or government insignia",
    copyBlueprint: {
      headlinePool: [
        "Veterans Life Insurance",
        "Coverage Built For Veterans",
        "Veterans — See Your Options",
      ],
      hookPool: [
        "•BUILT FOR VETERANS• Coverage options for those who served.",
        "Veterans, secure your family's future with affordable life insurance coverage.",
        "You protected your country. Now protect your family.",
        "YOUR SERVICE ENDED. YOUR ADVANTAGES DIDN'T.",
      ],
      bulletPool: [
        "Private coverage options",
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
      "Direct-response veteran insurance Facebook ad creative background, bold patriotic poster composition, veteran-aged civilian man age 55-70, American flag texture background, navy gold cream red graphic areas, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, NO kids, NO family portrait, NO military uniforms, NO official insignia, NO government seals, no logos, NOT lifestyle photography",
      "Direct-response veteran insurance ad background, distressed American flag background, navy and gold graphic composition, veteran-aged civilian male silhouette, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NO home-family scene, NO kids, NO official insignia",
    ],
    landingPageConfig: {
      pageType: "veteran_amount_card",
      headlinePool: [
        "Veterans Life Insurance",
        "Coverage Built For Veterans",
        "Private Coverage For Those Who Served",
      ],
      subheadlinePool: [
        "Coverage options for those who served",
        "Select your coverage amount below",
        "See your options in seconds",
      ],
      buttonLabelsPool: [
        ["$50,000", "$100,000", "$250,000", "$500,000"],
        ["$100,000", "$250,000", "$500,000", "$1,000,000"],
      ],
      benefitBulletsPool: [
        ["Coverage options for those who served", "No exam options may be available", "Review takes under 60 seconds"],
        ["Private coverage review", "No exam options may be available", "Fast review"],
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
        "Use veteran-focused private coverage language without official branding.",
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
        "MILITARY · WHOLE LIFE INSURANCE",
        "Veterans Life Insurance — No 2 Year Wait",
        "Veterans: Tap Your Age To See If You Qualify",
        "VETERANS LIFE INSURANCE",
        "Did You Serve? Check Your Coverage Options",
      ],
      hookPool: [
        "🎖️ WHAT BRANCH DID YOU SERVE... No 2 Year Wait · Whole Life Insurance · Immediate Coverage Up To: $50,000 · Tap Your Age To See If You Qualify",
        "YOUR SERVICE ENDED. YOUR OPTIONS DIDN'T.\nYou hung up the uniform, but you can still review private coverage options designed for veterans.",
        "ARMY · NAVY · AIR FORCE · MARINES · COAST GUARD — Get covered. No 2-year wait. Whole life insurance. Immediate coverage up to $50,000.",
        "Veterans between 50–85 may qualify for whole life coverage with no 2-year waiting period and no medical exam required.",
        "Did you serve between 1960–2022? Tap your age to view available private coverage options.",
      ],
      bulletPool: [
        "No 2-year waiting period",
        "Whole life — immediate coverage up to $50,000",
        "No medical exam required",
        "Coverage options for those who served",
        "Affordable monthly payments",
        "Locked-in rates for life",
        "Army · Navy · Air Force · Marines · Coast Guard",
      ],
      ctaPool: [
        "Tap Your Age To See If You Qualify →",
        "Click Your Age For Instant Quote →",
        "View Available Options →",
        "Apply Now →",
        "See If I Qualify →",
      ],
      ageButtonPools: [
        ["Under 50", "50–60", "61–70", "71–79"],
        ["30–49", "50–65", "66–79", "80+"],
        ["30–49", "50–60", "61–75", "76+"],
      ],
    },
    imagePromptPool: [
      "Direct-response veteran insurance Facebook ad creative background, cream beige background with blank reserved headline area for app-rendered text, patriotic star divider, blank reserved CTA/button area for app-rendered UI, veteran-aged civilian male, no readable text inside image, no logos, NO kids, NO family portrait, NO military uniforms, NO official insignia",
      "Direct-response veteran insurance ad background, distressed American flag texture background, gold and white reserved overlay areas, patriotic red white blue poster layout, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NO home-family scene, NO official insignia",
      "Direct-response veteran ad background, American flag texture, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, veteran-aged civilian man silhouette, no readable text inside image, no logos, NO kids, NOT lifestyle photography",
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
        "Private coverage options for veterans and military families",
        "View available private coverage options",
      ],
      buttonLabelsPool: [
        ["Under 50", "50–60", "61–70", "71–79"],
        ["30–49", "50–65", "66–79", "80+"],
      ],
      benefitBulletsPool: [
        ["Coverage options for those who served", "No exam options may be available", "Review in under 60 seconds"],
        ["Private coverage review", "Fast review", "For veterans and military families"],
      ],
      ctaStripPool: ["View My Options →", "Check My Options →", "See What I Qualify For →"],
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
    disabled: true,
    format: "long_copy",
    visualDirection: "Patriotic but civilian, veteran-aged adult, bold text-heavy layout, strong identity hook",
    copyBlueprint: {
      headlinePool: [
        "Your Service Ended. Your Advantages Didn't.",
        "Coverage Built For Veterans",
        "Benefits You Earned. Don't Leave Them Behind.",
      ],
      hookPool: [
        "YOUR SERVICE ENDED. YOUR ADVANTAGES DIDN'T. 💪\nYou hung up the uniform, but you didn't hang up what you earned. Military service unlocks benefits civilians will never access — and most veterans don't even know they exist.",
        "EVERY BRANCH BUILT WARRIORS. EVERY WARRIOR DESERVES COVERAGE.\nARMY · NAVY · AIR FORCE · MARINES · COAST GUARD",
        "Your mission was protecting others. This coverage's mission is protecting you.",
      ],
      introPool: [
        "Veterans can review private coverage options designed for those who served.",
        "There are private insurance options designed specifically for veterans and their families.",
        "After serving, you deserve simple, straightforward coverage that works for you.",
      ],
      bodyPointPool: [
        "Private coverage options may be available through a licensed agent.",
        "It's designed for veterans who want straightforward private coverage with simple qualification.",
        "No lengthy process. No runaround. Review your options in under 60 seconds.",
      ],
      bulletPool: [
        "Coverage built for veterans",
        "No exam options available",
        "Locked-in rates for life",
        "Simple qualification process",
        "Coverage for those who served",
      ],
      ctaPool: ["See If I Qualify →", "View My Options →", "Check My Coverage →"],
    },
    imagePromptPool: [
      "Vertical 1:1 Facebook ad image, veteran-aged civilian man age 55-70, strong proud expression, American flag softly visible in background, warm patriotic tones, civilian clothes, NO military uniforms, NO official insignia, realistic photography, no logos, no text overlay",
      "Vertical 1:1 Facebook ad image, bold patriotic American flag background, veteran-aged adult civilian, strong identity composition, red/white/blue tones, NO military uniforms, NO government seals, realistic photography, no logos, no text overlay",
    ],
    videoScriptPool: [
      "[HOOK] Your service ended. Your advantages didn't. [BODY] There are private coverage options designed specifically for veterans and their families. No exam options, locked-in rates, simple qualification. Review your options with a licensed agent. [CTA] Tap below to see if you qualify.",
    ],
    landingPageConfig: {
      pageType: "veteran_long_copy",
      headlinePool: [
        "Your Service Ended. Your Advantages Didn't.",
        "Coverage Built For Veterans",
        "Built For Veterans and Military Families",
      ],
      subheadlinePool: [
        "Coverage options for veterans and military families",
        "See what options may be available to you",
        "Coverage for those who served",
      ],
      buttonLabelsPool: [
        ["Under 50", "50–60", "61–70", "71–79"],
        ["30–49", "50–65", "66–79", "80+"],
      ],
      benefitBulletsPool: [
        ["Coverage built for veterans", "No exam options available", "Locked-in rates", "Simple qualification"],
        ["Coverage for those who served", "No exam required", "Rates locked in", "Fast review"],
      ],
      ctaStripPool: ["See If I Qualify →", "View My Options →", "Check My Coverage →"],
      theme: { background: "#0a0f1a", accent: "#1d4ed8", styleTag: "veteran_long_copy" },
    },
    compliance: {
      noGovernmentImplication: true,
      needsReviewIfUsingApprovalLanguage: true,
      allowedClaimStyle: ["private-market"],
      notes: [
        "Keep language veteran-focused without implying official endorsement.",
        "Do not use 'benefit unlock' framing that implies government entitlement.",
        "Use clean veteran-focused positioning without entitlement or official-status framing.",
        "Do not use military rank, insignia, or government seals in any format.",
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
        "TRUCKERS IUL",
        "Truck Drivers — Life Insurance Built For You",
        "CDL Drivers — View Your Amount",
        "Truckers: Get Up To $1,000,000 Life Insurance",
      ],
      hookPool: [
        "TRUCKERS IUL — What happens if the wheels stop turning — how will your income keep rolling?",
        "🚛🟢 Attention Professional Truckers: Get up to $1,000,000 in life insurance with no medical exam.",
        "Life insurance with cash value potential built for drivers planning ahead.",
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
      "Direct-response trucker insurance ad creative background, three large commercial semi trucks on dark American highway at night, dramatic neon amber and cyan lighting, blank reserved headline area for app-rendered text, no readable text inside image, no logos, no text on trucks",
      "Direct-response trucker insurance ad creative background, professional semi truck on open highway, dark dramatic sky, amber neon glow lighting, strong powerful composition, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos",
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
        "🚛🇺🇸 Attention Truckers: Get $500,000–$1,000,000 in Life Insurance with No Medical Exam",
        "TRUCKERS IUL — What happens if the wheels stop turning — how will your income keep rolling?",
        "American flag. American truckers. American-made coverage.",
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
      "Direct-response trucker insurance ad creative background, red white and blue semi trucks driving in formation on American highway, American flag in background, dramatic patriotic sky, blank reserved headline area for app-rendered text, no readable text inside image, no logos",
      "Direct-response trucker insurance ad creative background, semi truck on American highway with large patriotic flag in background, rugged Americana, red white blue palette, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos",
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
      "Direct-response trucker insurance ad creative background, professional semi truck on scenic mountain highway, amber tones, vast American open road landscape, blank reserved headline area for app-rendered text, no readable text inside image, no logos",
      "Direct-response trucker insurance ad creative background, commercial semi truck on Route 66 style American highway, rugged Americana feel, open road, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos",
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
      "Direct-response trucker insurance ad creative background, professional CDL driver near semi truck, rugged poster composition, blank reserved headline area for app-rendered text, clean graphic background with space for overlay, no readable text inside image, no logos, NOT lifestyle photography",
      "Direct-response trucker insurance ad background, semi truck on American highway, wide open road hero visual, high-contrast graphic layout, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NOT stock-photo style",
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
      "Premium direct-response IUL education ad creative background, professional planning visual in a clean office setting, blue gold and white palette, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos",
      "Premium direct-response IUL education ad creative background, bright office setting with financial planning visual, blue and gold tones, clean graphic background with space for overlay, no readable text inside image, no logos",
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
      "Premium direct-response cash value life insurance education ad creative background, clean planning visual, bright blue and white palette, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos",
      "Premium direct-response IUL planning ad creative background, clean educational mood, blue and white graphic layout with space for overlay, no readable text inside image, no logos",
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
      "Premium direct-response family legacy education ad creative background, clean blue and gold graphic layout, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos",
      "Premium direct-response protection and legacy planning ad creative background, clean modern graphic layout, blue and gold subtle accents, space for overlay, no readable text inside image, no logos",
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
    visualDirection: "Veteran-aged civilian with patriotic direct-response education layout, subtle blue/red accents, premium benefit panels, no uniforms or insignia, no home-family scenes",
    copyBlueprint: {
      headlinePool: [
        "Veterans — Learn About IUL",
        "Private IUL Education For Veterans",
        "Legacy Planning For Those Who Served",
      ],
      hookPool: [
        "Veterans can review private-market IUL options with a licensed professional.",
        "Private IUL education and coverage options may be available through a licensed professional.",
        "If family legacy and future planning matter to you, IUL may be worth understanding.",
      ],
      bulletPool: [
        "Private coverage options",
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
      "Direct-response veteran IUL education ad creative background, veteran-aged civilian male, subtle patriotic blue and red graphic panels, blank reserved headline area for app-rendered text, no readable text inside image, no military uniforms, no official insignia, no logos",
      "Direct-response veteran IUL ad creative background, patriotic premium education layout, clean graphic background with space for overlay, veteran-aged civilian silhouette, no readable text inside image, no uniforms, no official insignia, no logos",
    ],
    landingPageConfig: {
      pageType: "iul_veteran_legacy",
      headlinePool: ["Veterans — Learn About IUL", "Private IUL Education For Veterans", "Legacy Planning For Veterans"],
      subheadlinePool: [
        "IUL education for veterans and military families",
        "Review protection and cash value potential",
        "Educational review with a licensed professional",
      ],
      buttonLabelsPool: [
        ["Protection", "Cash Value", "Legacy", "Review"],
        ["Veteran", "Family", "Planning", "Learn"],
      ],
      benefitBulletsPool: [
        ["Coverage for those who served", "Family protection", "Cash value potential subject to policy terms"],
        ["Veteran-focused education", "Licensed review", "Educational only"],
      ],
      ctaStripPool: ["Start My Review →", "Learn About IUL →", "Review My Options →"],
      theme: { background: "#0a0f1a", accent: "#1d4ed8", styleTag: "iul_veteran" },
    },
    compliance: {
      noGovernmentImplication: true,
      avoidGuaranteedClaims: true,
      notes: [
        "Must state private market and veteran-focused private coverage.",
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
    visualDirection: "Professional truck driver near truck or highway, rugged premium direct-response layout, blue/amber benefit panels, no family-at-home photography",
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
      "Direct-response trucker IUL education ad creative background, professional CDL driver near semi truck, rugged blue and amber graphic layout, blank reserved headline area for app-rendered text, no readable text inside image, no logos, NOT family-at-home photography",
      "Direct-response CDL driver financial planning ad background, semi truck hero visual, blue amber poster composition, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NOT paperwork table stock photography",
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
    .filter((f) => !f.disabled && f.leadType === leadType && normalizeAudienceSegment(f.audienceSegment) === normalizedSegment)
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
    return applyCopyVariation([hook, intro, body, bullets, cta].filter(Boolean).join("\n\n"), seed, family.leadType);
  }

  if (family.format === "video_copy") {
    const bodyPoints = bp.bodyPointPool ? bp.bodyPointPool.join("\n") : "";
    const cta = pickFromPool(bp.ctaPool, seed, variantOffset);
    return applyCopyVariation([hook, "", bodyPoints, "", cta].filter(Boolean).join("\n"), seed, family.leadType);
  }

  // card | benefit_stack | family_emotional
  const bullets = bp.bulletPool
    ? bp.bulletPool.map((b) => `✓ ${b}`).join("\n")
    : "";
  const cta = pickFromPool(bp.ctaPool, seed, variantOffset);
  return applyCopyVariation([hook, bullets, cta].filter(Boolean).join("\n\n"), seed, family.leadType);
}

function applyCopyVariation(text: string, seed: number, leadType: WinnerLeadType): string {
  void leadType;
  const replacements = [
    { from: /Tap/gi, to: "Select" },
    { from: /See/gi, to: "View" },
    { from: /Check/gi, to: "Find Out" },
    { from: /coverage/gi, to: "plans" },
    { from: /qualify/gi, to: "be eligible" },
  ];

  let modified = text;
  const count = (seed % 3) + 1;

  for (let i = 0; i < count; i++) {
    const replacement = replacements[(seed + i) % replacements.length];
    modified = modified.replace(replacement.from, replacement.to);
  }

  return modified;
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
  const imagePrompt = buildRichImagePrompt(
    family,
    pickFromPool(family.imagePromptPool, seed, offset),
    buildButtonLabels(family, seed + offset)
  );
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

function buildRichImagePrompt(
  family: WinningAdFamily,
  basePrompt: string,
  buttonLabels: string[]
): string {
  const directResponseBase = String(basePrompt || "")
    .replace(/no text overlay/gi, "no readable text inside image")
    .replace(/realistic photography/gi, "graphic direct-response ad composition")
    .replace(/warm natural lighting/gi, "high-contrast direct-response lighting")
    .replace(/warm realistic photography/gi, "high-contrast direct-response poster composition")
    .replace(/family at home/gi, "poster-style coverage layout")
    .replace(/young family/gi, "home-focused visual")
    .replace(/couple at home/gi, "home-focused visual")
    .replace(/couple reviewing mortgage paperwork/gi, "mortgage balance card layout")
    .replace(/multigenerational family/gi, "senior-focused benefit card")
    .replace(/structured typography zones/gi, "blank reserved headline area for app-rendered text")
    .replace(/age or coverage selection buttons/gi, "blank reserved CTA/button area for app-rendered UI")
    .replace(/fake clickable (?:option )?buttons?/gi, "blank reserved CTA/button area for app-rendered UI")
    .replace(/amount card layout/gi, "clean graphic background with space for overlay")
    .replace(/amount-card layout/gi, "clean graphic background with space for overlay")
    .replace(/benefit-card composition/gi, "clean graphic background with space for overlay")
    .replace(/strong headline area/gi, "blank reserved headline area for app-rendered text")
    .replace(/bold headline zone/gi, "blank reserved headline area for app-rendered text")
    .replace(/clean CTA layout/gi, "blank reserved CTA/button area for app-rendered UI");

  const leadTypeStyleMap: Record<WinnerLeadType, string> = {
    veteran:
      "direct-response veteran insurance ad creative background, poster-style composition, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, patriotic navy red gold cream palette, distressed American flag texture, veteran-aged civilian male, no readable text inside image, NO kids, NO family portraits, NO lifestyle photography, NO cinematic stock-photo style, NO official seals or insignia",
    trucker:
      "direct-response trucker insurance ad creative background, poster-style composition, large semi truck hero image, highway or neon truck layout, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, high contrast, NOT stock-photo style, NO family-at-home scene, no logos or insignia",
    mortgage_protection:
      "direct-response mortgage protection ad creative background, structured home-focused composition, house key or mortgage balance visual, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, NOT lifestyle stock photography, no logos",
    final_expense:
      "premium final expense ad creative background, dark gold direct-response layout, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, NOT lifestyle photography, NO soft home stock-photo style, no logos",
    iul:
      "premium educational direct-response ad creative background, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, NOT candid family photography, no logos",
  };

  const buttonPhrase =
    buttonLabels.length > 0
      ? `Leave a blank reserved CTA/button area where the app will render UI labels such as: ${buttonLabels.slice(0, 4).join(", ")}. Do not render readable button text inside the image.`
      : "Leave a blank reserved CTA/button area for app-rendered UI. Do not render readable button text inside the image.";

  const lightingPool = [
    "high-contrast lighting",
    "dramatic poster contrast",
    "bright clean daylight",
    "premium graphic-ad lighting",
  ];
  const compositionPool = [
    "tight mobile-first crop",
    "stacked card composition",
    "center-weighted poster composition with CTA space",
    "top-heavy blank headline area with lower reserved CTA area",
  ];
  const palettePool = [
    "bold saturated palette",
    "clean high-trust palette",
    "reference-style direct-response palette",
    "crisp contrast with strong accent colors",
  ];
  const layoutPool = [
    "benefit stack layout",
    "quiz-card layout",
    "selection grid layout",
    "amount-row card layout",
  ];
  const subjectPoolByLeadType: Record<WinnerLeadType, string[]> = {
    veteran: [
      "veteran-aged man",
      "veteran-aged civilian male silhouette",
      "distressed American flag background",
      "coverage amount card",
      "patriotic age selector layout",
    ],
    trucker: [
      "CDL driver",
      "truck driver near semi",
      "semi truck on highway",
      "neon truck lineup",
      "open road truck hero",
    ],
    mortgage_protection: [
      "house exterior",
      "front door and key",
      "mortgage balance card",
      "coverage amount selector",
      "home silhouette",
    ],
    final_expense: [
      "senior-focused benefit card",
      "coverage amount panel",
      "dark gold age selector",
      "premium final expense layout",
      "dignified senior silhouette",
    ],
    iul: [
      "professional couple",
      "parent reviewing finances",
      "family planning at kitchen table",
      "business owner",
      "couple reviewing retirement strategy",
    ],
  };

  const seed = simpleHash(`${family.id}:${basePrompt}:${buttonLabels.join("|")}`);
  const lighting = pickFromPool(lightingPool, seed, 31);
  const composition = pickFromPool(compositionPool, seed, 37);
  const palette = pickFromPool(palettePool, seed, 41);
  const layout = pickFromPool(layoutPool, seed, 43);
  const subjectPool = subjectPoolByLeadType[family.leadType];
  const subject = pickFromPool(subjectPool, seed, 53);

  return `${directResponseBase}, subject focus: ${subject}, ${leadTypeStyleMap[family.leadType]}, ${lighting}, ${composition}, ${palette}, ${layout}. ${buttonPhrase}`;
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

export function generateWinningVariantList(input: {
  leadType: WinnerLeadType;
  audienceSegment?: AudienceSegment;
  userId: string;
  campaignName: string;
  location?: string;
  familyIdOverride?: string;
  variantCount?: number;
}): GeneratedWinningAd[] {
  const { leadType, userId, campaignName, location = "", familyIdOverride } = input;
  const audienceSegment = normalizeAudienceSegment(input.audienceSegment);
  const families = getWinningFamiliesByLeadType(leadType, audienceSegment);

  if (families.length === 0) {
    throw new Error(`No winning families found for leadType: ${leadType}, audienceSegment: ${audienceSegment}`);
  }

  const requestedCount = clampVariantCount(input.variantCount);
  const baseSeed = createDeterministicVariationSeed(userId, campaignName + location, `${leadType}:${audienceSegment}`);
  const recommendedType = RECOMMENDED_VARIANT[leadType] ?? "emotional";
  const variantOrder: VariantType[] = [
    recommendedType,
    "emotional",
    "logical",
    "curiosity",
  ].filter((type, index, arr) => arr.indexOf(type) === index) as VariantType[];

  while (variantOrder.length < requestedCount) {
    variantOrder.push(
      [recommendedType, "emotional", "logical", "curiosity"][variantOrder.length % 4] as VariantType
    );
  }

  let familyPool = families;
  if (familyIdOverride) {
    const overrideFamily = families.find((f) => f.id === familyIdOverride);
    familyPool = overrideFamily ? [overrideFamily] : families;
  } else {
    const rotation = baseSeed % families.length;
    familyPool = [...families.slice(rotation), ...families.slice(0, rotation)];
  }

  return Array.from({ length: requestedCount }).map((_, index) => {
    const family = familyPool[index % familyPool.length];
    const variantType = variantOrder[index];
    return buildVariant(family, variantType, baseSeed + index * 997);
  });
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
  return WINNING_AD_LIBRARY.find((family) => !family.disabled && family.id === id) || null;
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
