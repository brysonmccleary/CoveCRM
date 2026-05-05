// lib/facebook/creativeStyleRules.ts
//
// ═══════════════════════════════════════════════════════════════════════════════
// PERMANENT WINNING AD ARCHETYPE SOURCE OF TRUTH
// ═══════════════════════════════════════════════════════════════════════════════
//
// This file is the canonical blueprint for all Facebook insurance lead ad
// creative structure in CoveCRM. It encodes the "Winning Meta Lead Ad Structure
// System" — the exact archetype order, visual direction, overlay layout, button
// style, and copy intent for every supported lead type.
//
// RULES FOR EDITING:
//  - Do NOT add random new archetypes. Stay inside the blueprint.
//  - Do NOT reorder archetypes within a lead type. The order is permanent.
//  - Each lead type has exactly 3 archetypes: Primary → Variant 2 → Variant 3.
//  - Overlay text must stay short and mobile-readable.
//  - Max 4 buttons per archetype. Max 3 benefit bullets.
//  - This file feeds generate-ad.ts (AI prompt) and all UI overlays.
//  - Changing this changes every generated ad. Treat it as production code.
//
// ARCHETYPE ORDER BY LEAD TYPE (from the winning blueprint document):
//  mortgage_protection: coverage_button_card → family_lifestyle → testimonial_or_emotional
//  final_expense:       age_button_card → benefit_card → emotional_or_testimonial
//  veteran:             patriotic_amount_card → age_button_flag_card → family_military_card
//  iul:                 amount_card → premium_professional → strategic_benefit_card
//  trucker:             highway_age_button_card → patriotic_trucker_card → rugged_offer_card
// ═══════════════════════════════════════════════════════════════════════════════

export type LeadType = "mortgage_protection" | "final_expense" | "veteran" | "iul" | "trucker";

export type CreativeArchetype =
  | "coverage_button_card"        // mortgage: amount-selector primary
  | "family_lifestyle"            // mortgage: soft lifestyle
  | "testimonial_or_emotional"    // mortgage: emotional story
  | "age_button_card"             // final expense: age-band primary
  | "benefit_card"                // final expense: benefit list
  | "emotional_or_testimonial"    // final expense: emotional
  | "patriotic_amount_card"       // veteran: patriotic + amount buttons
  | "age_button_flag_card"        // veteran: flag + age bands
  | "family_military_card"        // veteran: family/civilian warm
  | "amount_card"                 // iul: amount-selector primary
  | "premium_professional"        // iul: executive/professional
  | "strategic_benefit_card"      // iul: strategy + age bands
  | "highway_age_button_card"     // trucker: highway + age bands PRIMARY
  | "patriotic_trucker_card"      // trucker: patriotic/Americana
  | "rugged_offer_card";          // trucker: rugged family offer

export interface CreativeStyleRule {
  archetype: CreativeArchetype;
  overlayTemplate: string;
  colorDirection: string;
  subjectDirection: string;
  buttonStyle: "age_bands" | "coverage_amounts" | "none";
  ctaStyle: string;
  offerStyle: string;
  ageButtons?: string[];
  coverageButtons?: string[];
  overlayData: {
    headline: string;
    subheadline: string;
    buttonLabels: string[];
    ctaStrip: string;
    benefitBullets: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PERMANENT RULES — one entry per approved archetype, in blueprint order.
// Primary archetype is always [0]. Variants are [1] and [2].
// ─────────────────────────────────────────────────────────────────────────────
const RULES: Record<LeadType, CreativeStyleRule[]> = {

  // ── MORTGAGE PROTECTION ──────────────────────────────────────────────────
  // Primary:   coverage_button_card   (amount-selector, red/white/neutral)
  // Variant 2: family_lifestyle       (soft educational, warm neutral)
  // Variant 3: testimonial_or_emotional (emotional story, warm tones)
  mortgage_protection: [
    {
      archetype: "coverage_button_card",
      overlayTemplate: "coverage_buttons",
      colorDirection: "warm coral/red/white on family-home background",
      subjectDirection: "happy couple in front of their home, natural lighting, suburban neighborhood",
      buttonStyle: "coverage_amounts",
      ctaStyle: "See My Rate",
      offerStyle: "coverage_amount_selector",
      coverageButtons: ["$100,000", "$300,000", "$600,000"],
      overlayData: {
        headline: "Protect Your Mortgage",
        subheadline: "Select your coverage amount",
        buttonLabels: ["$100,000", "$300,000", "$600,000"],
        ctaStrip: "See My Rate \u2192",
        benefitBullets: [
          "No exam options available",
          "Covers mortgage if something happens",
          "May qualify in minutes",
        ],
      },
    },
    {
      archetype: "family_lifestyle",
      overlayTemplate: "lifestyle_offer",
      colorDirection: "warm neutral/white, family-safe",
      subjectDirection: "young family inside their living room, warm natural lighting",
      buttonStyle: "none",
      ctaStyle: "Learn More",
      offerStyle: "soft_educational",
      overlayData: {
        headline: "Keep Your Family Protected",
        subheadline: "Quick mortgage protection review",
        buttonLabels: [],
        ctaStrip: "Learn More \u2192",
        benefitBullets: [
          "Protection if the unexpected happens",
          "Options for homeowners",
          "Review in under 60 seconds",
        ],
      },
    },
    {
      archetype: "testimonial_or_emotional",
      overlayTemplate: "emotional_card",
      colorDirection: "soft warm tones, trustworthy",
      subjectDirection: "family moment — parents with children, home setting, warm lighting",
      buttonStyle: "none",
      ctaStyle: "See Your Options",
      offerStyle: "emotional_story",
      overlayData: {
        headline: "Protect What You've Built",
        subheadline: "Your home. Your family. Your future.",
        buttonLabels: [],
        ctaStrip: "See Your Options \u2192",
        benefitBullets: [],
      },
    },
  ],

  // ── FINAL EXPENSE ────────────────────────────────────────────────────────
  // Primary:   age_button_card         (age-band selector, black/gold/white)
  // Variant 2: benefit_card            (benefit list, dark premium)
  // Variant 3: emotional_or_testimonial (soft emotional, muted gold)
  final_expense: [
    {
      archetype: "age_button_card",
      overlayTemplate: "age_buttons",
      colorDirection: "near-black with gold accent — warm and dignified",
      subjectDirection: "multigenerational family in cozy home, warm realistic lighting",
      buttonStyle: "age_bands",
      ctaStyle: "Learn More",
      offerStyle: "age_band_selector",
      ageButtons: ["50\u201359", "60\u201369", "70\u201379", "80+"],
      overlayData: {
        headline: "Plan Ahead For Your Family",
        subheadline: "Select your age to see options",
        buttonLabels: ["50\u201359", "60\u201369", "70\u201379", "80+"],
        ctaStrip: "Learn More \u2192",
        benefitBullets: [],
      },
    },
    {
      archetype: "benefit_card",
      overlayTemplate: "benefit_list_card",
      colorDirection: "black/gold/white — dark premium feel",
      subjectDirection: "older couple smiling at home, warm natural photography",
      buttonStyle: "age_bands",
      ctaStyle: "See What You Qualify For",
      offerStyle: "benefit_list",
      ageButtons: ["Ages 45\u201354", "Ages 55\u201364", "Ages 65\u201375", "Ages 76\u201385"],
      overlayData: {
        headline: "Final Expense Coverage",
        subheadline: "Help cover end-of-life costs",
        buttonLabels: ["Ages 45\u201354", "Ages 55\u201364", "Ages 65\u201375", "Ages 76\u201385"],
        ctaStrip: "See What You May Qualify For \u2192",
        benefitBullets: [
          "No exam options available",
          "Affordable monthly options",
          "Simple qualification",
        ],
      },
    },
    {
      archetype: "emotional_or_testimonial",
      overlayTemplate: "emotional_card",
      colorDirection: "soft dark / muted gold — dignified and warm",
      subjectDirection: "senior couple holding hands, peaceful and trustworthy setting",
      buttonStyle: "none",
      ctaStyle: "Learn More",
      offerStyle: "soft_emotional",
      overlayData: {
        headline: "Give Your Family Peace of Mind",
        subheadline: "Simple, affordable final expense coverage",
        buttonLabels: [],
        ctaStrip: "Learn More \u2192",
        benefitBullets: [
          "Simple qualification",
          "Affordable monthly options",
          "Coverage your family can count on",
        ],
      },
    },
  ],

  // ── VETERAN ──────────────────────────────────────────────────────────────
  // Primary:   patriotic_amount_card   (patriotic + amount buttons)
  // Variant 2: age_button_flag_card    (flag + age-band eligibility)
  // Variant 3: family_military_card    (veteran family, civilian warm)
  //
  // COMPLIANCE: No official insignia, no military uniforms, no government
  // seals. Always PRIVATE coverage — never imply VA or government program.
  veteran: [
    {
      archetype: "patriotic_amount_card",
      overlayTemplate: "patriotic_benefit_card",
      colorDirection: "red/blue/gold patriotic — no official insignia",
      subjectDirection: "veteran-aged adult with family at home, patriotic color palette, civilian setting — no military uniforms",
      buttonStyle: "coverage_amounts",
      ctaStyle: "Check Your Options",
      offerStyle: "coverage_check",
      coverageButtons: ["$10,000", "$25,000", "$50,000", "$100,000"],
      overlayData: {
        headline: "Veterans Life Insurance",
        subheadline: "Private coverage for veterans \u2014 not VA",
        buttonLabels: ["$10,000", "$25,000", "$50,000", "$100,000"],
        ctaStrip: "Check Your Options \u2192",
        benefitBullets: [
          "Private coverage \u2014 not VA",
          "No exam options may be available",
          "Review takes under 60 seconds",
        ],
      },
    },
    {
      archetype: "age_button_flag_card",
      overlayTemplate: "age_buttons_patriotic",
      colorDirection: "bold red/white/blue — strong but not military",
      subjectDirection: "American flag background or subtle patriotic elements, veteran-aged civilian portrait — no uniforms",
      buttonStyle: "age_bands",
      ctaStyle: "Apply Now",
      offerStyle: "age_band_eligibility",
      ageButtons: ["30\u201349", "50\u201365", "66\u201379", "80+"],
      overlayData: {
        headline: "Check Your Coverage Options",
        subheadline: "Built for veterans and military families",
        buttonLabels: ["30\u201349", "50\u201365", "66\u201379", "80+"],
        ctaStrip: "Apply Now \u2192",
        benefitBullets: [],
      },
    },
    {
      archetype: "family_military_card",
      overlayTemplate: "family_military_lifestyle",
      colorDirection: "warm patriotic — red/blue with family warmth",
      subjectDirection: "veteran with spouse and children at home, civilian setting, warm and respectful",
      buttonStyle: "none",
      ctaStyle: "Learn More",
      offerStyle: "family_protection",
      overlayData: {
        headline: "You Served. Protect What Matters.",
        subheadline: "Fast private coverage review for veterans",
        buttonLabels: [],
        ctaStrip: "Learn More \u2192",
        benefitBullets: [
          "Private market coverage",
          "Simple qualification",
          "For veterans and their families",
        ],
      },
    },
  ],

  // ── IUL ──────────────────────────────────────────────────────────────────
  // Primary:   amount_card             (amount selector, blue/gold premium)
  // Variant 2: premium_professional    (executive educational, deep blue/gold)
  // Variant 3: strategic_benefit_card  (strategy + age bands)
  iul: [
    {
      archetype: "amount_card",
      overlayTemplate: "amount_selector_card",
      colorDirection: "blue/gold professional — clean premium financial feel",
      subjectDirection: "professional couple reviewing finances at modern table, premium home setting",
      buttonStyle: "coverage_amounts",
      ctaStyle: "View Amount",
      offerStyle: "amount_selector",
      coverageButtons: ["$250,000", "$500,000", "$1,000,000", "$2,000,000+"],
      overlayData: {
        headline: "Indexed Universal Life",
        subheadline: "Protection + long-term financial strategy",
        buttonLabels: ["$250,000", "$500,000", "$1,000,000", "$2,000,000+"],
        ctaStrip: "View Amount \u2192",
        benefitBullets: [
          "Tax-advantaged accumulation potential",
          "Permanent life coverage",
          "Flexible premium options",
        ],
      },
    },
    {
      archetype: "premium_professional",
      overlayTemplate: "professional_benefit_card",
      colorDirection: "deep blue / champagne gold — executive look",
      subjectDirection: "affluent professional or business owner in clean modern office or home office",
      buttonStyle: "none",
      ctaStyle: "Learn How It Works",
      offerStyle: "educational_premium",
      overlayData: {
        headline: "Learn How IUL Works",
        subheadline: "See if it fits your long-term goals",
        buttonLabels: [],
        ctaStrip: "Learn How It Works \u2192",
        benefitBullets: [
          "Life coverage + accumulation potential",
          "Used by high earners for legacy planning",
          "Educational review \u2014 no obligation",
        ],
      },
    },
    {
      archetype: "strategic_benefit_card",
      overlayTemplate: "strategy_card",
      colorDirection: "clean blue/white/gold — trustworthy financial planning",
      subjectDirection: "business owner at desk with family photo in background, professional and warm",
      buttonStyle: "age_bands",
      ctaStyle: "Explore Options",
      offerStyle: "strategic_planning",
      ageButtons: ["35\u201344", "45\u201354", "55\u201364"],
      overlayData: {
        headline: "IUL \u2014 Is It Right For You?",
        subheadline: "Protection, accumulation, and legacy planning",
        buttonLabels: ["35\u201344", "45\u201354", "55\u201364"],
        ctaStrip: "Explore Your Options \u2192",
        benefitBullets: [],
      },
    },
  ],

  // ── TRUCKER ──────────────────────────────────────────────────────────────
  // Primary:   highway_age_button_card  (highway + age bands, Americana)
  // Variant 2: patriotic_trucker_card   (patriotic/Americana, rugged)
  // Variant 3: rugged_offer_card        (rugged family offer, dark navy/red)
  trucker: [
    {
      archetype: "highway_age_button_card",
      overlayTemplate: "age_buttons_highway",
      colorDirection: "sunset highway — warm amber/red Americana feel",
      subjectDirection: "commercial semi truck on open American highway at golden hour, wide shot",
      buttonStyle: "age_bands",
      ctaStyle: "View Amount",
      offerStyle: "age_selector",
      ageButtons: ["35\u201345", "45\u201355", "55\u201365", "65+"],
      overlayData: {
        headline: "CDL Drivers \u2014 See Your Rate",
        subheadline: "Select your age to view options",
        buttonLabels: ["35\u201345", "45\u201355", "55\u201365", "65+"],
        ctaStrip: "View Amount \u2192",
        benefitBullets: [],
      },
    },
    {
      archetype: "patriotic_trucker_card",
      overlayTemplate: "patriotic_trucker",
      colorDirection: "red/blue/Americana — rugged but clean, highway/truck stop feel",
      subjectDirection: "truck driver standing near semi truck on open highway at sunrise, rugged and strong",
      buttonStyle: "age_bands",
      ctaStyle: "See My Options",
      offerStyle: "trucker_coverage",
      ageButtons: ["35\u201344", "45\u201354", "55\u201364", "65+"],
      overlayData: {
        headline: "Truckers Life Insurance",
        subheadline: "Coverage built for CDL drivers",
        buttonLabels: ["35\u201344", "45\u201354", "55\u201364", "65+"],
        ctaStrip: "See My Options \u2192",
        benefitBullets: [
          "Options for CDL commercial drivers",
          "No exam options may be available",
          "Review in under 60 seconds",
        ],
      },
    },
    {
      archetype: "rugged_offer_card",
      overlayTemplate: "rugged_benefit_card",
      colorDirection: "dark navy/red — rugged and trustworthy American worker feel",
      subjectDirection: "truck driver with family, realistic and warm, American countryside or highway background",
      buttonStyle: "none",
      ctaStyle: "Learn More",
      offerStyle: "simple_offer",
      overlayData: {
        headline: "See Your Options Fast",
        subheadline: "Built for busy drivers on the road",
        buttonLabels: [],
        ctaStrip: "Learn More \u2192",
        benefitBullets: [
          "Simple options for people on the go",
          "Review takes under 60 seconds",
          "No obligation",
        ],
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — used by generate-ad.ts and any overlay rendering components
// ─────────────────────────────────────────────────────────────────────────────

/** Returns all 3 archetype rules for a lead type in blueprint order. */
export function getCreativeRules(leadType: LeadType): CreativeStyleRule[] {
  return RULES[leadType] || RULES.mortgage_protection;
}

/** Returns the PRIMARY (index 0) archetype for a lead type. */
export function getPrimaryCreativeRule(leadType: LeadType): CreativeStyleRule {
  return getCreativeRules(leadType)[0];
}
