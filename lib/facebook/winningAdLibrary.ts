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

  {
    id: "vet_branch_selector",
    leadType: "veteran",
    archetype: "branch_selector",
    familyName: "Branch Selector",
    vendorStyleTag: "market_veteran_branch",
    priority: 1,
    format: "card",
    visualDirection: "Bold patriotic branch-selector direct-response layout, civilian veteran imagery, branch-focused copy, no official insignia or seals",
    copyBlueprint: {
      headlinePool: [
        "Army Veteran? Check Your Coverage Options",
        "Navy Veteran? See What You Qualify For",
        "Marines Veteran? Review Your Benefits",
        "Air Force Veteran? Private Coverage Review",
      ],
      hookPool: [
        "Your branch of service affects your coverage options. Review private plans designed for veterans like you — no medical exam required for most.",
        "Veterans from every branch deserve the right coverage. See what private plans are available in your state with no exam required.",
      ],
      bulletPool: [
        "Branch-focused private coverage review",
        "No exam options may be available",
        "Coverage for veterans and military families",
        "Licensed review in your state",
      ],
      ctaPool: ["LEARN_MORE", "Review My Options →", "Check Coverage →"],
      ageButtonPools: [
        ["Army", "Navy", "Marines", "Air Force"],
        ["Veteran", "Spouse", "Family", "Review"],
      ],
      approvedCoverageAmounts: [50000, 100000, 250000, 500000],
    },
    imagePromptPool: [
      "Direct-response veteran branch selector ad creative background, patriotic navy red cream graphic layout, civilian veteran silhouette, blank reserved headline area for app-rendered text, blank reserved CTA/button area for app-rendered UI, no readable text inside image, no logos, NO official insignia, NO military uniforms",
      "Bold veteran insurance poster background, American flag texture, clean branch-selection graphic composition, veteran-aged civilian male, blank reserved overlay areas, no readable text inside image, no seals, no official logos",
    ],
    landingPageConfig: {
      pageType: "veteran_branch_selector",
      headlinePool: [
        "Veterans — Select Your Branch",
        "Coverage Options For Those Who Served",
        "Private Veteran Coverage Review",
      ],
      subheadlinePool: [
        "Review private coverage options in your state",
        "No exam options may be available",
        "Coverage for veterans and military families",
      ],
      buttonLabelsPool: [
        ["Army", "Navy", "Marines", "Air Force"],
        ["Veteran", "Spouse", "Family", "Review"],
      ],
      benefitBulletsPool: [
        ["Private coverage review", "No exam options may be available", "Licensed state review"],
        ["Coverage for those who served", "Fast review", "Family options available"],
      ],
      ctaStripPool: ["LEARN_MORE", "Review My Options →", "Check Coverage →"],
      theme: { background: "#0a0f1a", accent: "#c0392b", styleTag: "veteran_branch_selector" },
    },
    compliance: {
      noGovernmentImplication: true,
      avoidGuaranteedClaims: true,
      notes: [
        "Do not use official branch marks, seals, uniforms, ranks, or government logos.",
        "Keep branch references as audience selectors only.",
        "Use private coverage review language.",
      ],
    },
  },

  {
    id: "vet_spouse_security",
    leadType: "veteran",
    archetype: "spouse_security",
    familyName: "Spouse Security",
    vendorStyleTag: "market_veteran_family",
    priority: 2,
    format: "benefit_stack",
    visualDirection: "Veteran family-security direct-response layout, patriotic but clean, spouse and family protection message without generic family stock photography",
    copyBlueprint: {
      headlinePool: [
        "Protect Your Family After Your Service",
        "Your Spouse Deserves Coverage Too",
        "Don't Leave Your Family Unprotected",
        "Veteran Family Protection — See Options",
      ],
      hookPool: [
        "You protected your country. Now protect the people who waited for you. Private coverage options for veterans and their families — no exam required.",
        "Your service meant sacrifice for your whole family. Make sure they're covered with private veteran life insurance options available in your state.",
      ],
      bulletPool: [
        "Coverage options for veteran families",
        "Spouse and family protection review",
        "No exam options may be available",
        "Locked-in rate options may be available",
      ],
      ctaPool: ["LEARN_MORE", "Review Family Options →", "Check My Options →"],
      amountButtonPools: [
        ["$50,000", "$100,000", "$250,000", "$500,000"],
        ["Veteran", "Spouse", "Family", "Review"],
      ],
      approvedCoverageAmounts: [50000, 100000, 250000, 500000],
    },
    imagePromptPool: [
      "Direct-response veteran family protection ad creative background, patriotic navy cream gold graphic layout, subtle home protection motif, veteran-aged civilian silhouette, blank reserved headline and CTA areas for app-rendered UI, no readable text inside image, NO kids, NO family stock-photo scene, no uniforms or official insignia",
      "Veteran spouse security insurance ad background, premium patriotic poster composition, clean benefit panels and flag texture, blank reserved overlay areas, no readable text inside image, no logos, no government seals",
    ],
    landingPageConfig: {
      pageType: "veteran_spouse_security",
      headlinePool: [
        "Veteran Family Protection",
        "Protect The People You Love",
        "Coverage Options For Veteran Families",
      ],
      subheadlinePool: [
        "Private coverage options for veterans and families",
        "Review options available in your state",
        "No exam options may be available",
      ],
      buttonLabelsPool: [
        ["$50,000", "$100,000", "$250,000", "$500,000"],
        ["Veteran", "Spouse", "Family", "Review"],
      ],
      benefitBulletsPool: [
        ["Family protection", "No exam options may be available", "Licensed review"],
        ["Private coverage review", "Spouse options", "Fast review"],
      ],
      ctaStripPool: ["LEARN_MORE", "Review Family Options →", "Check My Options →"],
      theme: { background: "#0a0f1a", accent: "#d4a017", styleTag: "veteran_spouse_security" },
    },
    compliance: {
      noGovernmentImplication: true,
      avoidGuaranteedClaims: true,
      notes: [
        "Do not imply government, VA, or military endorsement.",
        "Avoid generic family stock-photo scenes and random children.",
        "Use private coverage options and licensed review language.",
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

  ...buildAdditionalWinningAdFamilies(),
];

function buildAdditionalWinningAdFamilies(): WinningAdFamily[] {
  const subheadsFrom = (hooks: string[], fallback: string) => hooks.length ? hooks.slice(0, 3) : [fallback];
  const ctasFor = (leadType: WinnerLeadType, archetype: string): string[] => {
    if (leadType === "final_expense") {
      if (archetype.includes("funeral_cost")) return ["See Funeral Cost Options →", "Estimate My Coverage →", "Compare Final Expense →"];
      if (archetype.includes("senior_notice")) return ["Check Senior Options →", "Select My Age →", "See What Fits →"];
      if (archetype.includes("burial")) return ["Plan Burial Costs →", "Compare Burial Coverage →", "Start Cost Review →"];
      if (archetype.includes("price_table")) return ["Compare Amounts →", "View Coverage Table →", "Check Monthly Options →"];
      if (archetype.includes("family_burden")) return ["Help Protect Family →", "Plan Ahead Today →", "Review Family Options →"];
      return ["Check Final Expense →", "See Age-Based Options →", "Start Coverage Check →"];
    }
    if (leadType === "mortgage_protection") {
      if (archetype.includes("price_table")) return ["Compare Mortgage Amounts →", "View Home Table →", "Check My Balance →"];
      if (archetype.includes("homeowner_notice")) return ["Open Homeowner Review →", "Check My Home Options →", "Select Mortgage Balance →"];
      if (archetype.includes("income_stopped")) return ["Stress-Test My Mortgage →", "Plan For Income Loss →", "Check Protection Options →"];
      if (archetype.includes("living_benefits")) return ["Review Living Benefits →", "See Policy Features →", "Compare Flexible Options →"];
      if (archetype.includes("with_without")) return ["Compare Both Paths →", "See The Difference →", "Review Coverage Gap →"];
      if (archetype.includes("family_home")) return ["Protect The Family Home →", "Review Home Options →", "Check My Balance →"];
      return ["Review Mortgage Options →", "Check My Home →", "Compare Coverage →"];
    }
    if (leadType === "veteran") {
      if (archetype.includes("benefit_grid")) return ["Open Veteran Notice →", "Select My Age →", "View Benefit Cards →"];
      if (archetype.includes("whole_life")) return ["Check Whole Life Options →", "Select Age Range →", "View Coverage Amounts →"];
      if (archetype.includes("coverage_up_to")) return ["Check Amount Options →", "See Coverage Range →", "Start Amount Review →"];
      if (archetype.includes("legacy")) return ["Protect My Legacy →", "Review Family Plan →", "See Legacy Options →"];
      return ["View Veteran Options →", "Select My Age →", "Start Family Review →"];
    }
    if (leadType === "trucker") {
      if (archetype.includes("rate_table")) return ["Compare Driver Rates →", "Open Rate Table →", "Select My Age →"];
      if (archetype.includes("highway")) return ["View Road Options →", "Check Driver Coverage →", "Start CDL Review →"];
      if (archetype.includes("truck_stop")) return ["Review Between Loads →", "Check Road Coverage →", "Start Driver Review →"];
      return ["View Driver Options →", "Select My Age →", "Start Road Review →"];
    }
    if (archetype.includes("market_loss")) return ["Learn Downside Features →", "Review IUL Terms →", "Compare Protection Features →"];
    if (archetype.includes("cash_access")) return ["Learn Access Rules →", "Review Cash Value Terms →", "Start IUL Education →"];
    if (archetype.includes("triangle")) return ["Explore The IUL Triangle →", "Learn IUL Basics →", "Review Policy Fit →"];
    if (archetype.includes("retirement")) return ["Review Retirement Fit →", "Learn Policy Tradeoffs →", "Start IUL Education →"];
    return ["Learn About IUL →", "Review Policy Terms →", "Start IUL Education →"];
  };

  const fe = (id: string, familyName: string, archetype: string, styleTag: string, visualDirection: string, headlines: string[], hooks: string[], bullets: string[], buttons: string[][], theme: { background: string; accent: string; styleTag: string }, priority = 2): WinningAdFamily => ({
    id,
    leadType: "final_expense",
    archetype,
    familyName,
    vendorStyleTag: styleTag,
    priority,
    format: "card",
    visualDirection,
    copyBlueprint: {
      headlinePool: headlines,
      hookPool: hooks,
      bulletPool: bullets,
      ctaPool: ctasFor("final_expense", archetype),
      ageButtonPools: buttons,
    },
    imagePromptPool: [
      `${visualDirection}, CSS-rendered mobile direct-response final expense creative, blank reserved areas for app-rendered text and buttons, no readable image text, no logos, private coverage positioning`,
    ],
    landingPageConfig: {
      pageType: archetype,
      headlinePool: headlines,
      subheadlinePool: subheadsFrom(hooks, visualDirection),
      buttonLabelsPool: buttons,
      benefitBulletsPool: [bullets.slice(0, 3)],
      ctaStripPool: ctasFor("final_expense", archetype),
      theme,
    },
    compliance: {
      avoidGuaranteedClaims: true,
      avoidUnsupportedMedicalClaims: true,
      notes: ["Avoid unsupported approval language.", "Keep burial cost language private-market and state-neutral.", "Keep final expense language respectful."],
    },
  });

  const mp = (id: string, familyName: string, archetype: string, audienceSegment: AudienceSegment | undefined, styleTag: string, visualDirection: string, headlines: string[], hooks: string[], bullets: string[], buttons: string[][], theme: { background: string; accent: string; styleTag: string }, priority = 2): WinningAdFamily => ({
    id,
    leadType: "mortgage_protection",
    audienceSegment,
    archetype,
    familyName,
    vendorStyleTag: styleTag,
    priority,
    format: "card",
    visualDirection,
    copyBlueprint: {
      headlinePool: headlines,
      hookPool: hooks,
      bulletPool: bullets,
      ctaPool: ctasFor("mortgage_protection", archetype),
      amountButtonPools: buttons,
    },
    imagePromptPool: [
      `${visualDirection}, CSS-rendered mortgage protection ad creative, home protection card layout, blank reserved areas for app-rendered text and CTA buttons, no readable image text, no logos`,
    ],
    landingPageConfig: {
      pageType: archetype,
      headlinePool: headlines,
      subheadlinePool: subheadsFrom(hooks, visualDirection),
      buttonLabelsPool: buttons,
      benefitBulletsPool: [bullets.slice(0, 3)],
      ctaStripPool: ctasFor("mortgage_protection", archetype),
      theme,
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: ["Use private coverage framing.", "Avoid guaranteed qualification claims.", "Keep living benefits language policy-term dependent."],
    },
  });

  const vt = (id: string, familyName: string, archetype: string, styleTag: string, visualDirection: string, headlines: string[], hooks: string[], bullets: string[], buttons: string[][], theme: { background: string; accent: string; styleTag: string }, priority = 2): WinningAdFamily => ({
    id,
    leadType: "veteran",
    archetype,
    familyName,
    vendorStyleTag: styleTag,
    priority,
    format: "card",
    visualDirection,
    copyBlueprint: {
      headlinePool: headlines,
      hookPool: hooks,
      bulletPool: bullets,
      ctaPool: ctasFor("veteran", archetype),
      ageButtonPools: buttons,
      approvedCoverageAmounts: [40000, 50000, 75000, 100000],
    },
    imagePromptPool: [
      `${visualDirection}, CSS-rendered private veteran coverage ad creative, patriotic red navy gold palette, no seals, no uniforms, no official insignia, blank reserved text and CTA areas`,
    ],
    landingPageConfig: {
      pageType: archetype,
      headlinePool: headlines,
      subheadlinePool: subheadsFrom(hooks, visualDirection),
      buttonLabelsPool: buttons,
      benefitBulletsPool: [bullets.slice(0, 3)],
      ctaStripPool: ctasFor("veteran", archetype),
      theme,
    },
    compliance: {
      noGovernmentImplication: true,
      avoidGuaranteedClaims: true,
      notes: ["Prefer private coverage framing.", "Do not use official seals, uniforms, or insignia.", "Keep veteran copy focused on family protection and available options."],
    },
  });

  const tr = (id: string, familyName: string, archetype: string, styleTag: string, visualDirection: string, headlines: string[], hooks: string[], bullets: string[], buttons: string[][], theme: { background: string; accent: string; styleTag: string }, priority = 2): WinningAdFamily => ({
    id,
    leadType: "trucker",
    archetype,
    familyName,
    vendorStyleTag: styleTag,
    priority,
    format: "card",
    visualDirection,
    copyBlueprint: {
      headlinePool: headlines,
      hookPool: hooks,
      bulletPool: bullets,
      ctaPool: ctasFor("trucker", archetype),
      ageButtonPools: buttons,
    },
    imagePromptPool: [
      `${visualDirection}, CSS-rendered truck driver direct-response creative, highway or truck stop layout, blank reserved text and CTA areas, no readable image text, no logos`,
    ],
    landingPageConfig: {
      pageType: archetype,
      headlinePool: headlines,
      subheadlinePool: subheadsFrom(hooks, visualDirection),
      buttonLabelsPool: buttons,
      benefitBulletsPool: [bullets.slice(0, 3)],
      ctaStripPool: ctasFor("trucker", archetype),
      theme,
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: ["Do not imply CDL drivers are universally denied elsewhere.", "Use options may be available language.", "Avoid guaranteed rate or approval claims."],
    },
  });

  const iul = (id: string, familyName: string, archetype: string, audienceSegment: AudienceSegment | undefined, styleTag: string, visualDirection: string, headlines: string[], hooks: string[], bullets: string[], buttons: string[][], theme: { background: string; accent: string; styleTag: string }, priority = 2): WinningAdFamily => ({
    id,
    leadType: "iul",
    audienceSegment,
    archetype,
    familyName,
    vendorStyleTag: styleTag,
    priority,
    format: "benefit_stack",
    visualDirection,
    copyBlueprint: {
      headlinePool: headlines,
      hookPool: hooks,
      bulletPool: bullets,
      ctaPool: ctasFor("iul", archetype),
      disclaimerPool: [
        "IUL is life insurance, not an investment. Growth, loans, withdrawals, fees, caps, participation rates, and policy performance depend on contract terms.",
        "No tax, legal, investment, or guaranteed income advice is provided. Review policy illustrations and costs with a licensed professional.",
      ],
      amountButtonPools: buttons,
    },
    imagePromptPool: [
      `${visualDirection}, CSS-rendered IUL education ad creative, clean financial planning layout, blank reserved text and CTA areas, no readable image text, no logos`,
    ],
    landingPageConfig: {
      pageType: archetype,
      headlinePool: headlines,
      subheadlinePool: [
        ...subheadsFrom(hooks, visualDirection),
        "Educational review only - no guaranteed returns, income, or tax outcomes.",
        "Policy terms, caps, fees, loans, withdrawals, and lapse risk must be reviewed.",
      ],
      buttonLabelsPool: buttons,
      benefitBulletsPool: [bullets.slice(0, 3)],
      ctaStripPool: ctasFor("iul", archetype),
      theme,
    },
    compliance: {
      avoidGuaranteedClaims: true,
      notes: ["Do not call IUL an investment account.", "No guaranteed income, return, or tax outcome claims.", "Mention caps, fees, loans, withdrawals, and policy terms when discussing cash value."],
    },
  });

  const ageSenior = [["50-59", "60-69", "70-79", "80+"], ["45-54", "55-64", "65-74", "75-85"]];
  const ageAdult = [["35-44", "45-54", "55-64", "65+"], ["30-44", "45-54", "55-64", "65+"]];
  const mortgageAmounts = [["$150k", "$300k", "$500k", "$750k+"], ["Under $150k", "$150k-$300k", "$300k-$500k", "$500k+"]];
  const iulButtons = [["Protection", "Growth Potential", "Access", "Legacy"], ["Retirement", "Family", "Cash Value", "Review"]];

  return [
    fe("fe_funeral_cost_reality_card", "Funeral Cost Reality Card", "funeral_cost_reality_card", "final_expense_reality", "Clean funeral cost reality layout with respectful price table and cream/gold panels", ["Funeral Costs Can Add Up Fast", "Help Prepare For Final Expenses"], ["A private final expense plan may help loved ones handle funeral and burial costs.", "Review simple coverage options designed for final expenses."], ["No medical exam options", "Monthly options may be available", "Designed for final expenses"], ageSenior, { background: "#f8f5f0", accent: "#a16207", styleTag: "fe_cost_table" }),
    fe("fe_senior_notice_clean", "Senior Notice Clean Card", "senior_notice_clean_card", "final_expense_notice", "Senior notice layout, clean white card, blue/gold accents, age selector", ["Senior Coverage Notice", "Ages 50-85: Review Options"], ["Seniors can compare age-based final expense coverage options in a clean notice-style flow.", "Coverage options may be available without a medical exam."], ["Age-based coverage check", "No-exam options may be available", "State-specific plan review"], ageSenior, { background: "#ffffff", accent: "#1d4ed8", styleTag: "fe_senior_notice" }),
    fe("fe_no_exam_white_card", "No Exam White Card", "no_exam_white_card", "final_expense_clean", "Mostly white no-exam card with bold black headline, gold CTA, compact benefit rows", ["No Medical Exam Options", "Final Expense Coverage Review"], ["If you want simple coverage, review options that may not require a medical exam.", "Compare private final expense options in your state."], ["No exam options", "Rates reviewed before applying", "Simple phone follow-up"], ageSenior, { background: "#ffffff", accent: "#111827", styleTag: "fe_no_exam_white" }),
    fe("fe_private_burial_fund", "Private Burial Fund Style", "private_burial_fund_style", "final_expense_private_fund", "Private burial planning style, cream paper, structured benefit blocks", ["Private Burial Cost Options", "Help Set Aside Coverage For Burial Costs"], ["Private final expense coverage may help with burial and related costs.", "Review burial cost planning options available in your state."], ["Burial cost planning", "Service and plot cost help", "Family payout focus"], ageSenior, { background: "#f5f0e8", accent: "#8b4513", styleTag: "fe_private_burial" }),
    fe("fe_coverage_price_table", "Coverage Price Table", "coverage_price_table", "final_expense_table", "Coverage amount price-table inspired card with tidy rows and high-trust blue accents", ["Compare Final Expense Options", "Review Coverage Amounts"], ["Compare coverage amount options before choosing a plan.", "A licensed professional can review available options and costs."], ["Coverage amount review", "Monthly options explained", "No-obligation call"], [["$5k", "$10k", "$15k", "$25k"], ["$10k", "$15k", "$20k", "$30k"]], { background: "#eef6ff", accent: "#2563eb", styleTag: "fe_price_table" }),
    fe("fe_family_burden_respectful", "Respectful Family Burden", "family_burden_respectful", "final_expense_family", "Respectful family burden layout, warm home palette, clear CTA and dignified language", ["Help Protect Loved Ones From Final Costs", "Plan Ahead For The People You Love"], ["Final expense coverage can help reduce financial stress for loved ones.", "Planning ahead may help your family focus on each other instead of bills."], ["Help cover final costs", "Simple review", "Respectful planning"], ageSenior, { background: "#fff7ed", accent: "#c2410c", styleTag: "fe_family_warmth" }),
    fe("fe_lock_rate_direct_response", "Lock Rate Direct Response", "lock_rate_direct_response", "final_expense_lock_rate", "Dark gold direct-response card with lock-rate language and age selector", ["Review Rates Before They Change", "Check Final Expense Options Today"], ["It may be worth reviewing final expense options while coverage may be affordable.", "Compare options before age or health changes."], ["Current age band check", "Rate class conversation", "Coverage before changes"], ageSenior, { background: "#111827", accent: "#d4a017", styleTag: "fe_lock_rate" }),
    fe("fe_simple_phone_review", "Simple Phone Review", "simple_phone_review", "final_expense_phone_review", "Mobile-native message card style for final expense phone review", ["A Simple Final Expense Review", "See Options In A Short Call"], ["A licensed professional can walk through options in a simple phone review.", "No pressure, just a clear look at what may be available."], ["Short phone review", "No obligation", "State-specific options"], ageSenior, { background: "#f8fafc", accent: "#0f172a", styleTag: "fe_phone_review" }),

    mp("mp_clean_navy_price_table", "Clean Navy Price Table", "clean_navy_price_table", "standard", "mortgage_price_table", "Clean navy and blue mortgage amount table with homeowner CTA", ["Mortgage Protection Options", "Compare Home Protection Amounts"], ["If the unexpected happened, mortgage protection may help your family stay in the home.", "Compare private coverage options by mortgage amount."], ["Mortgage balance review", "Family protection", "Living benefits may be available"], mortgageAmounts, { background: "#eaf4ff", accent: "#1d4ed8", styleTag: "mp_navy_table" }, 1),
    mp("mp_homeowner_notice_layout", "Homeowner Notice Layout", "homeowner_notice_layout", "standard", "mortgage_notice", "Homeowner notice card with blue header, white table, and amount buttons", ["Homeowner Coverage Notice", "Protect Your Mortgage Balance"], ["Homeowners can check mortgage-balance protection options in a notice-style table.", "Select a balance range to see how coverage may be structured."], ["Mortgage balance ranges", "Homeowner notice format", "Amount-based comparison"], mortgageAmounts, { background: "#ffffff", accent: "#0f3b70", styleTag: "mp_homeowner_notice" }),
    mp("mp_family_home_warmth", "Family Home Warmth", "family_home_warmth", "standard", "mortgage_family_home", "Warm family/home mortgage layout with soft cream background and benefit cards", ["Help Keep The Home In The Family", "Protection For The Place They Call Home"], ["Mortgage protection may help your family keep the home if income suddenly changes.", "Review options designed around your mortgage balance and family priorities."], ["Keep the home base", "Family payment support", "Balance-based planning"], mortgageAmounts, { background: "#fff7ed", accent: "#c2410c", styleTag: "mp_family_warmth" }),
    mp("mp_income_stopped_tomorrow", "Income Stopped Tomorrow", "income_stopped_tomorrow", "standard", "mortgage_income_alert", "Income stopped tomorrow alert layout with strong contrast and decision buttons", ["If Income Stopped Tomorrow", "Could Your Family Keep The Home?"], ["A private mortgage protection policy may help cover the balance or payments, depending on terms.", "Review options before the unexpected happens."], ["Mortgage balance review", "Payment protection options", "Policy terms explained"], mortgageAmounts, { background: "#111827", accent: "#ef4444", styleTag: "mp_income_alert" }),
    mp("mp_living_benefits_alert", "Living Benefits Alert", "living_benefits_alert", "standard", "mortgage_living_benefits", "Living benefits alert card with blue alert panel and compact checklist", ["Living Benefits May Be Available", "Mortgage Protection With Added Flexibility"], ["Some policies may include living benefits, subject to policy terms and eligibility.", "Review mortgage protection options beyond basic death benefit coverage."], ["Living benefits may be available", "Policy-term dependent", "Licensed explanation"], mortgageAmounts, { background: "#eff6ff", accent: "#2563eb", styleTag: "mp_living_benefits" }),
    mp("mp_with_without_coverage", "With Without Coverage", "with_without_coverage", "standard", "mortgage_comparison", "Side-by-side with coverage and without coverage comparison card", ["With Coverage vs Without Coverage", "Compare Mortgage Protection Choices"], ["Compare what may happen with or without private mortgage protection in place.", "A licensed professional can review options for your home."], ["Side-by-side comparison", "Mortgage amount options", "No-obligation review"], mortgageAmounts, { background: "#f8fafc", accent: "#16a34a", styleTag: "mp_comparison" }),
    mp("mp_veteran_family_home", "Veteran Family Home", "veteran_family_home", "veteran", "mortgage_veteran", "Veteran family and home mortgage protection layout with patriotic accents", ["Veteran Home Protection Review", "Mortgage Protection For Veterans"], ["Veterans can review private mortgage protection options for their family home.", "Review mortgage amount options built around veteran family protection."], ["Veteran homeowner review", "Family home protection", "Mortgage amount options"], mortgageAmounts, { background: "#f5f0e8", accent: "#8b1a1a", styleTag: "mp_veteran_home" }, 1),
    mp("mp_veteran_living_benefits", "Veteran Living Benefits", "veteran_living_benefits", "veteran", "mortgage_veteran_living", "Veteran mortgage layout with living benefits bullets and navy/red panels", ["Veterans: Mortgage Protection Options", "Help Protect Your Family Home"], ["Private policies may include living benefits, subject to terms and eligibility.", "Veteran homeowners can compare mortgage balance options available in their state."], ["Living benefits may be available", "Policy terms apply", "Veteran homeowner focus"], mortgageAmounts, { background: "#0f172a", accent: "#d4a017", styleTag: "mp_veteran_living" }),
    mp("mp_trucker_home_on_road", "Trucker Home On Road", "trucker_home_on_road", "trucker", "mortgage_trucker", "Trucker mortgage protection layout with highway/home split and amount cards", ["Truckers: Protect The Home Base", "Mortgage Protection For Life On The Road"], ["When you are on the road, mortgage protection may help protect the home base.", "CDL drivers can review private mortgage protection options."], ["Home base protection", "Mortgage amount review", "Driver-focused review"], mortgageAmounts, { background: "#07131f", accent: "#f59e0b", styleTag: "mp_trucker_home" }, 1),
    mp("mp_trucker_income_gap", "Trucker Income Gap", "trucker_income_gap", "trucker", "mortgage_trucker_income", "Trucker income gap alert with dark highway palette and coverage cards", ["If The Miles Stopped", "Could The Mortgage Still Be Covered?"], ["Private mortgage protection may help families prepare for unexpected income gaps.", "Review options designed around your mortgage balance and driver income risk."], ["Income gap planning", "Home payment backup", "Driver schedule friendly"], mortgageAmounts, { background: "#1c1c1c", accent: "#ff6b35", styleTag: "mp_trucker_income" }),

    vt("vet_benefit_grid_notice", "Veteran Benefit Grid Notice", "veteran_benefit_grid_notice", "veteran_grid", "Cream paper veteran benefit grid with red/navy/gold border, $40,000 hero number, four benefit cards, and age buttons", ["Veterans 50+ Notice", "$40,000 Coverage Options"], ["Veterans and families can review private coverage options that may help protect what matters.", "Review private life insurance options with a licensed professional."], ["Protect Home", "Support Loved Ones", "Prepare Ahead", "Protect Legacy"], ageSenior, { background: "#f5f0e8", accent: "#8b1a1a", styleTag: "vet_benefit_grid" }, 1),
    vt("vet_whole_life_bold_white", "Veteran Whole Life Bold White", "veteran_whole_life_bold_white", "veteran_white_bold", "Mostly white veteran whole life card, huge navy headline, red/orange age buttons", ["Veterans Whole Life Options", "No 2 Year Waiting Period Options"], ["Veterans may qualify for private whole life coverage options up to $100,000.", "Review coverage options with no two-year waiting period on select policies, subject to eligibility."], ["Up to $100,000 options", "No 2-year wait on select plans", "Age-based whole life check"], ageSenior, { background: "#ffffff", accent: "#ea580c", styleTag: "vet_whole_life_white" }, 1),
    vt("vet_coverage_up_to_100k", "Veteran Coverage Up To 100k", "veteran_coverage_up_to_100k", "veteran_amount_card", "Bold white/navy veteran amount card with coverage up to $100,000 language", ["Coverage Up To $100,000", "Veterans: Review Coverage Options"], ["Private coverage options may be available for veterans and spouses.", "A licensed professional can review amounts and eligibility."], ["Up to $100,000 options", "Age-based review", "Private coverage"], ageSenior, { background: "#f8fafc", accent: "#1d4ed8", styleTag: "vet_100k" }),
    vt("vet_legacy_protection_cards", "Veteran Legacy Protection Cards", "veteran_legacy_cards", "veteran_legacy", "Patriotic card stack for protect home, loved ones, legacy, and planning ahead", ["Protect Your Legacy", "Coverage For Those Who Served"], ["Private life insurance can help veterans plan ahead for family needs.", "Review options that may help protect home, loved ones, and legacy."], ["Protect Home", "Loved Ones", "Plan Ahead", "Legacy"], ageSenior, { background: "#0f172a", accent: "#d4a017", styleTag: "vet_legacy_cards" }),
    vt("vet_spouse_family_private", "Veteran Spouse Family Private", "veteran_spouse_family_private", "veteran_family_private", "Warm family-focused veteran private coverage layout with cream and navy panels", ["Veteran Family Coverage Review", "Private Options For Veterans And Spouses"], ["Veterans and spouses can review private coverage options for family protection.", "A licensed professional can explain what may be available."], ["Veteran", "Spouse", "Family", "Review"], ageSenior, { background: "#fff7ed", accent: "#0f3b70", styleTag: "vet_family_private" }),
    vt("vet_fast_private_review", "Veteran Fast Private Review", "veteran_fast_private_review", "veteran_fast_review", "Fast coverage review mobile-native veteran card with red CTA and navy panels", ["Fast Veteran Coverage Review", "See What Options May Be Available"], ["A short coverage review can show options for your age and state.", "Licensed coverage review for veterans and families."], ["50-59", "60-69", "70-79", "80+"], ageSenior, { background: "#eaf4ff", accent: "#b91c1c", styleTag: "vet_fast_review" }),
    vt("vet_notice_paper_border", "Veteran Notice Paper Border", "veteran_notice_paper_border", "veteran_notice_paper", "Cream paper notice with red navy gold patriotic border and clean coverage review framing", ["Veterans 50+ Coverage Notice", "Veteran Coverage Options"], ["Coverage review for veterans and families.", "Review options that may be available in your state."], ["Coverage for veterans", "Family protection focus", "Age 50+ notice"], ageSenior, { background: "#f5f0e8", accent: "#8b1a1a", styleTag: "vet_notice_paper" }),

    tr("trk_blue_highway_clean", "Blue Highway Clean", "blue_highway_clean", "trucker_blue_highway", "Blue highway clean trucker coverage card with crisp white panels and age buttons", ["Truck Driver Coverage Options", "CDL Drivers: Review Options"], ["Drivers can review private coverage options built around life on the road.", "A licensed professional can review options for CDL drivers."], ["CDL-friendly review", "Family protection", "No-obligation options"], ageAdult, { background: "#eaf4ff", accent: "#1d4ed8", styleTag: "trk_blue_highway" }, 1),
    tr("trk_sunset_highway_gold", "Sunset Highway Gold", "sunset_highway_gold", "trucker_sunset_gold", "Sunset highway gold trucker direct-response layout with warm CTA", ["Coverage For The Road Ahead", "Truckers: View Coverage Options"], ["When you drive for a living, it helps to know what private options may be available.", "Review simple coverage options for CDL drivers."], ["Road-ready review", "Family protection", "Options may be available"], ageAdult, { background: "#2c1810", accent: "#f59e0b", styleTag: "trk_sunset_gold" }),
    tr("trk_dark_purple_sky", "Dark Purple Orange Sky", "dark_purple_orange_sky", "trucker_purple_orange", "Dark purple and orange sky trucker layout with high-contrast option buttons", ["Truckers: Check Your Options", "Private Coverage For CDL Drivers"], ["A private coverage review can help drivers compare options by age and state.", "See what may be available for your family protection goals."], ["Age-based options", "Licensed review", "No obligation"], ageAdult, { background: "#1a1a2e", accent: "#ff6b35", styleTag: "trk_purple_sky" }),
    tr("trk_patriotic_rate_table", "Patriotic Trucker Rate Table", "patriotic_trucker_rate_table", "trucker_rate_table", "Patriotic trucker rate table with red navy white cards and view options CTA", ["CDL Driver Rate Review", "Truckers: Compare Coverage Options"], ["Compare private coverage options in a simple driver-focused review.", "Review age-based options with a licensed professional."], ["Rate review", "Private coverage", "Driver-focused"], ageAdult, { background: "#f8fafc", accent: "#b91c1c", styleTag: "trk_rate_table" }),
    tr("trk_truck_stop_lifestyle", "Truck Stop Lifestyle", "truck_stop_lifestyle", "trucker_truck_stop", "Truck stop and highway lifestyle-inspired CSS card with rugged panels", ["Coverage Between Loads", "Protect The Family While You Drive"], ["Between loads and long hauls, your family protection still matters.", "CDL drivers can review private options on a simple call."], ["Built for drivers", "Family protection", "Simple review"], ageAdult, { background: "#111827", accent: "#f97316", styleTag: "trk_truck_stop" }),
    tr("trk_view_options_age_card", "View Options Age Card", "view_options_age_card", "trucker_age_selector", "Clean trucker age selector with oversized view options CTA", ["Tap Your Age To View Options", "Truckers: Select Your Age"], ["Select your age range to start a private coverage review.", "Review options that may be available for CDL drivers."], ["Age range review", "Private options", "Licensed follow-up"], ageAdult, { background: "#ffffff", accent: "#0f3b70", styleTag: "trk_age_options" }),
    tr("trk_family_home_base", "Trucker Family Home Base", "family_home_base", "trucker_home_base", "Home base protection layout for truckers with blue/orange split panels", ["Protect The Home Base", "Coverage For Drivers And Families"], ["Your home base matters while you are out on the road.", "Review coverage options designed around driver schedules and family goals."], ["Home base focus", "Family protection", "Driver review"], ageAdult, { background: "#f8fafc", accent: "#ea580c", styleTag: "trk_home_base" }),
    tr("trk_black_gold_premium", "Black Gold Premium Trucker", "black_gold_premium_trucker", "trucker_black_gold", "Black and gold premium trucker layout with bold CTA and benefit blocks", ["Premium Coverage Review For Drivers", "Truckers: Review Private Options"], ["A licensed professional can review protection options for drivers and families.", "Compare private options without pressure."], ["Premium review", "Family protection", "Options explained"], ageAdult, { background: "#0a0a0a", accent: "#c9a84c", styleTag: "trk_black_gold" }),

    iul("iul_clean_triangle_diagram", "Clean Triangle Diagram", "clean_triangle_diagram", "standard", "iul_ethos_clean", "Clean white ETHOS-style triangle diagram showing protection, growth potential, and access", ["IUL: Protection + Growth Potential", "Learn How IUL Can Work"], ["Indexed universal life can combine life insurance protection with cash value growth potential.", "Learn the moving parts before deciding if IUL may fit your goals."], ["Protection", "Growth Potential", "Flexible Access", "Legacy"], iulButtons, { background: "#ffffff", accent: "#2563eb", styleTag: "iul_triangle" }, 1),
    iul("iul_market_loss_protection", "Market Loss Protection Education", "market_loss_protection_education", "standard", "iul_market_protection", "Clean diagram card for market loss protection subject to policy terms", ["Market Loss Protection Features", "IUL Downside Protection Education"], ["IUL policies may include downside protection features, subject to caps, fees, and policy terms.", "Learn how index-linked crediting works before choosing a policy."], ["No direct market investment", "Caps and limits apply", "Policy terms explained"], iulButtons, { background: "#eef6ff", accent: "#1d4ed8", styleTag: "iul_market_protection" }),
    iul("iul_flexible_cash_access", "Flexible Cash Access Education", "flexible_cash_access_education", "standard", "iul_cash_access", "Clean white cash access card with simple three-part diagram and disclaimer area", ["Flexible Cash Access Education", "Cash Value Life Insurance Review"], ["Cash value may be accessed through loans or withdrawals, subject to policy terms and risks.", "A licensed professional can explain costs, limits, and tradeoffs."], ["Loans/withdrawals", "Policy terms apply", "Licensed review"], iulButtons, { background: "#f8fafc", accent: "#16a34a", styleTag: "iul_cash_access" }),
    iul("iul_black_gold_retirement", "Black Gold Retirement", "black_gold_retirement", "standard", "iul_black_gold", "Black and gold premium IUL retirement education layout", ["Retirement Planning With IUL Education", "Learn About Cash Value Life Insurance"], ["IUL may be part of a broader retirement strategy for some families.", "Review benefits, limits, costs, and policy terms with a licensed professional."], ["Retirement", "Cash Value", "Protection", "Review"], iulButtons, { background: "#0a0a0a", accent: "#c9a84c", styleTag: "iul_black_gold" }),
    iul("iul_wealth_growth_potential", "Wealth Growth Potential", "wealth_growth_potential", "standard", "iul_growth_potential", "Clean wealth growth potential card with upward CSS diagram and blue/green accents", ["Wealth Growth Potential", "Protection With Cash Value Potential"], ["IUL offers cash value growth potential tied to an index, subject to caps and policy terms.", "Learn how protection and cash value may work together."], ["Growth potential", "Downside features", "Terms explained"], iulButtons, { background: "#ffffff", accent: "#0f766e", styleTag: "iul_growth" }),
    iul("iul_veteran_triangle_legacy", "Veteran Triangle Legacy", "veteran_triangle_legacy", "veteran", "iul_veteran_triangle", "Veteran IUL triangle diagram with patriotic accent and coverage review framing", ["Veterans: IUL Education", "IUL Review For Veterans"], ["Veterans can review private IUL education with a licensed professional.", "Learn protection, cash value potential, and policy terms for veteran family planning."], ["Protection", "Cash Value", "Legacy", "Review"], iulButtons, { background: "#f5f0e8", accent: "#8b1a1a", styleTag: "iul_vet_triangle" }, 1),
    iul("iul_veteran_black_gold", "Veteran Black Gold IUL", "veteran_black_gold_iul", "veteran", "iul_veteran_gold", "Premium black/gold veteran IUL education card with private coverage framing", ["Veteran Legacy Planning Education", "Private IUL Options For Veterans"], ["IUL may help some veterans think through protection and legacy planning, subject to policy terms.", "Review private options with a licensed professional."], ["Legacy", "Protection", "Cash Value", "Learn"], iulButtons, { background: "#0a0a0a", accent: "#d4a017", styleTag: "iul_vet_gold" }),
    iul("iul_trucker_blue_highway", "Trucker Blue Highway IUL", "trucker_blue_highway_iul", "trucker", "iul_trucker_blue", "Blue highway clean IUL card for CDL drivers with option buttons", ["Truckers: Learn About IUL", "Cash Value Education For Drivers"], ["Drivers can review protection and cash value life insurance education on their schedule.", "Learn how IUL works, including costs, caps, and policy terms."], ["Protection", "Cash Value", "Retirement", "Review"], iulButtons, { background: "#eaf4ff", accent: "#1d4ed8", styleTag: "iul_trucker_blue" }, 1),
    iul("iul_trucker_sunset_gold", "Trucker Sunset Gold IUL", "trucker_sunset_gold_iul", "trucker", "iul_trucker_sunset", "Sunset highway gold IUL card for truckers with view options CTA", ["Future Planning For CDL Drivers", "Truckers: Review IUL Options"], ["If you drive for a living, it may be worth learning how IUL works.", "Review protection, cash value potential, and policy terms with a licensed professional."], ["Driver review", "Cash value", "Family protection", "Learn"], iulButtons, { background: "#2c1810", accent: "#f59e0b", styleTag: "iul_trucker_sunset" }),
    iul("iul_trucker_premium_black_gold", "Trucker Premium Black Gold IUL", "trucker_premium_black_gold_iul", "trucker", "iul_trucker_gold", "Black/gold premium IUL retirement education layout for truckers", ["Premium IUL Education For Drivers", "Truckers: Retirement Strategy Review"], ["IUL may fit some long-term protection and planning goals, subject to policy terms.", "A licensed professional can explain caps, costs, loans, and policy risks."], ["Retirement", "Protection", "Cash Value", "Terms"], iulButtons, { background: "#0a0a0a", accent: "#c9a84c", styleTag: "iul_trucker_gold" }),
    iul("iul_trucker_dark_purple_sky", "Trucker Dark Purple Sky IUL", "trucker_dark_purple_sky_iul", "trucker", "iul_trucker_purple", "Dark purple/orange sky IUL education card for truckers", ["IUL Options For The Road Ahead", "Cash Value Education For CDL Drivers"], ["Truckers can learn how protection and cash value potential may work together.", "Review policy terms and tradeoffs before deciding."], ["Road ahead", "Family", "Cash value", "Review"], iulButtons, { background: "#1a1a2e", accent: "#ff6b35", styleTag: "iul_trucker_purple" }),
  ];
}

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
