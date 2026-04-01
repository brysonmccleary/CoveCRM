import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import OpenAI from "openai";
import { getCreativeRules, getPrimaryCreativeRule } from "@/lib/facebook/creativeStyleRules";
import type { LeadType as CreativeLeadType } from "@/lib/facebook/creativeStyleRules";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

type LeadType =
  | "mortgage_protection"
  | "final_expense"
  | "veteran"
  | "iul"
  | "trucker";

// Deterministic Facebook Instant Form questions per lead type
const LEAD_FORM_QUESTIONS: Record<LeadType, string[]> = {
  mortgage_protection: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "Mortgage Balance (approximate)",
    "Birth Year",
    "Are you a smoker? (Yes / No)",
  ],
  final_expense: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "Age Range (45–54 / 55–64 / 65–75 / 76–85)",
    "State",
    "Coverage Amount Wanted ($5,000 – $25,000 / $25,000+)",
  ],
  veteran: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "Are you a Veteran, Spouse, or Dependent?",
    "Age Range (30–49 / 50–65 / 66–79 / 80+)",
    "State",
  ],
  iul: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "Current Coverage Amount (if any)",
    "Household Income Range",
    "State",
  ],
  trucker: [
    "Full Name",
    "Phone Number",
    "Email Address",
    "CDL Driver? (Yes / No)",
    "Age Range (35–44 / 45–54 / 55–64 / 65+)",
    "State",
  ],
};

const THANK_YOU_TEXT: Record<LeadType, string> = {
  mortgage_protection: "Thank you! One of our licensed agents will reach out shortly to review your mortgage protection options. No obligation — just a quick conversation.",
  final_expense: "Thank you! A licensed agent will contact you soon to go over coverage options. This is a no-obligation review.",
  veteran: "Thank you for your interest. A licensed agent will reach out to review private coverage options available to you and your family.",
  iul: "Thank you! A licensed advisor will be in touch to walk you through how IUL may fit your financial goals.",
  trucker: "Thank you! A licensed agent will reach out shortly to review coverage options designed for CDL drivers.",
};

type Template = {
  angle: string;
  hook: string;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  imagePrompt: string;
  videoScript: string;
  targeting: {
    ageRange: string;
    interests: string[];
    notes: string;
  };
  complianceNotes: string[];
};

const TEMPLATES: Record<LeadType, Template[]> = {
  mortgage_protection: [
    {
      angle: "protect_home",
      hook: "Homeowners — quick question.",
      primaryText:
        "If something unexpected happened, would your family be able to keep the house? There are coverage options that can help protect the mortgage and give your family more stability. It only takes a minute to see what may be available.",
      headline: "Protect Your Home",
      description: "See what options may be available",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, homeowner couple in front of their house, natural lighting, realistic, trustworthy, family-safe, suburban home, no logos, no text overlay",
      videoScript:
        "[HOOK] Homeowners — quick question. [BODY] If something unexpected happened, would your family be able to keep the house? There are coverage options that may help protect the mortgage and keep your family in the home. [CTA] Tap below to see what options may be available in your area.",
      targeting: {
        ageRange: "30-60",
        interests: ["Homeownership", "Mortgage loans", "Home improvement"],
        notes: "Best for homeowners and recent homebuyers. Pair with quiz or lead form.",
      },
      complianceNotes: [
        "Do not imply government affiliation.",
        "Avoid direct death language like 'when you die'.",
        "Use 'may qualify' and 'options may be available' phrasing.",
      ],
    },
    {
      angle: "family_security",
      hook: "Most families never think about this until it’s too late.",
      primaryText:
        "You worked hard for your home. The right coverage can add an extra layer of protection for your family and help reduce financial stress if the unexpected happens. Review your options in under 60 seconds.",
      headline: "Keep Your Family Protected",
      description: "Quick mortgage protection review",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, young family inside a living room, warm realistic lighting, home setting, trustworthy, emotional but not dramatic, no logos, no text overlay",
      videoScript:
        "[HOOK] Most families never think about this until it’s too late. [BODY] You worked hard for your home, and there may be coverage options that help protect your family from added financial stress if the unexpected happens. [CTA] Tap below to review your options.",
      targeting: {
        ageRange: "28-58",
        interests: ["Homeowners insurance", "Real estate", "Family activities"],
        notes: "Emotional angle. Good for family-centered audiences.",
      },
      complianceNotes: [
        "Avoid fear-heavy wording that sounds exploitative.",
        "Do not promise exact savings or guaranteed approval.",
      ],
    },
  ],
  final_expense: [
    {
      angle: "final_expenses",
      hook: "Seniors — this is worth a look.",
      primaryText:
        "Final expense coverage can help reduce the burden of end-of-life costs for the people you love. Some options may not require an exam, and reviewing your options only takes a minute.",
      headline: "Help Cover Final Expenses",
      description: "See what you may qualify for",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, older couple smiling at home, natural realistic photography, warm trustworthy tone, no logos, no text overlay",
      videoScript:
        "[HOOK] Seniors — this is worth a look. [BODY] Final expense coverage can help reduce the burden of end-of-life costs for your loved ones, and some options may not require an exam. [CTA] Tap below to review what may be available.",
      targeting: {
        ageRange: "50-85",
        interests: ["Retirement", "AARP", "Medicare"],
        notes: "Keep language soft and family-oriented.",
      },
      complianceNotes: [
        "Use 'final expenses' instead of graphic funeral language when possible.",
        "Do not use misleading 'guaranteed' claims unless legally supported.",
      ],
    },
    {
      angle: "family_burden",
      hook: "Many families are not prepared for this cost.",
      primaryText:
        "Final expense coverage is one way families plan ahead and reduce out-of-pocket stress later on. Some plans offer simple qualification and affordable monthly options.",
      headline: "Plan Ahead For Your Family",
      description: "Quick coverage review",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, multigenerational family in a cozy home, realistic and natural, trustworthy tone, no logos, no text overlay",
      videoScript:
        "[HOOK] Many families are not prepared for this cost. [BODY] Final expense coverage can help reduce future out-of-pocket stress and give your family more peace of mind. [CTA] Tap below to explore your options.",
      targeting: {
        ageRange: "55-80",
        interests: ["Senior living", "Retirement planning", "Life insurance"],
        notes: "Strong emotional/family planning angle.",
      },
      complianceNotes: [
        "Avoid shaming language.",
        "Avoid promising exact pricing unless verified.",
      ],
    },
  ],
  veteran: [
    {
      angle: "benefits_check",
      hook: "Veterans — quick question.",
      primaryText:
        "Many veterans review private coverage options to better protect their families and understand what benefits may be available to them. Some options may not require an exam. It only takes a minute to check.",
      headline: "Check Your Coverage Options",
      description: "Built for veterans and families",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, veteran-aged adult with family at home, patriotic color palette without flags dominating, realistic, trustworthy, no official insignia, no logos, no text overlay",
      videoScript:
        "[HOOK] Veterans — quick question. [BODY] Many veterans are reviewing private coverage options to better protect their families and understand what may be available to them. Some options may not require an exam. [CTA] Tap below to check your options.",
      targeting: {
        ageRange: "45-75",
        interests: ["Veterans", "American Legion", "VFW"],
        notes: "Identity angle. Keep it respectful and private-market focused.",
      },
      complianceNotes: [
        "Do not imply VA, government, or military endorsement.",
        "Avoid official program language like 'new government benefit'.",
        "Use private coverage / review language.",
      ],
    },
    {
      angle: "earned_this",
      hook: "You served. Now protect what matters most.",
      primaryText:
        "Veterans often want simple, private coverage options that help protect their loved ones and offer peace of mind. Review what may be available to you in under 60 seconds.",
      headline: "Protection For Veterans",
      description: "Fast private coverage review",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, mature veteran with spouse or family, realistic home environment, respectful and strong tone, no military logos, no text overlay",
      videoScript:
        "[HOOK] You served. Now protect what matters most. [BODY] Veterans often want simple private coverage options that help protect their loved ones and provide peace of mind. [CTA] Tap below to review what may be available.",
      targeting: {
        ageRange: "50-78",
        interests: ["Military families", "Veterans affairs topics", "Patriotism"],
        notes: "Good for emotional and identity-driven messaging.",
      },
      complianceNotes: [
        "Do not suggest public benefits approval.",
        "Avoid misleading claims about pre-existing conditions unless verified.",
      ],
    },
  ],
  iul: [
    {
      angle: "tax_free_retirement",
      hook: "High earners are paying attention to this strategy.",
      primaryText:
        "Some families use indexed universal life as part of a long-term financial strategy for protection, accumulation, and legacy planning. If you want to explore options that may fit your goals, start with a quick review.",
      headline: "Explore IUL Options",
      description: "Protection + long-term planning",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, professional couple reviewing finances at a table, modern home setting, realistic, premium feel, no logos, no text overlay",
      videoScript:
        "[HOOK] High earners are paying attention to this strategy. [BODY] Indexed universal life can be part of a long-term protection and financial planning approach for the right person. [CTA] Tap below to explore whether it may fit your goals.",
      targeting: {
        ageRange: "35-60",
        interests: ["Investing", "Financial planning", "Retirement planning"],
        notes: "Position as educational, not hype.",
      },
      complianceNotes: [
        "Avoid investment guarantees.",
        "Do not imply risk-free returns.",
        "Use educational framing.",
      ],
    },
    {
      angle: "legacy_planning",
      hook: "Looking for more than basic coverage?",
      primaryText:
        "Some professionals use IUL to combine life coverage with long-term planning goals. If you want to learn how it works and whether it may be worth a closer look, start with a quick review.",
      headline: "Learn How IUL Works",
      description: "See if it fits your goals",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, affluent professional or business owner in a clean office/home office, realistic premium style, no logos, no text overlay",
      videoScript:
        "[HOOK] Looking for more than basic coverage? [BODY] Some professionals use IUL as part of a broader long-term planning strategy. [CTA] Tap below to learn how it works and whether it may fit your goals.",
      targeting: {
        ageRange: "32-58",
        interests: ["Business owner", "Wealth management", "Tax planning"],
        notes: "Higher income targeting recommended.",
      },
      complianceNotes: [
        "Avoid exaggerated tax claims.",
        "Keep language educational and suitability-based.",
      ],
    },
  ],
  trucker: [
    {
      angle: "road_protection",
      hook: "Truck drivers — your family depends on you.",
      primaryText:
        "Life on the road comes with real responsibility. There are coverage options designed to help protect your family and create more peace of mind, even for people with demanding jobs.",
      headline: "Coverage For Truck Drivers",
      description: "Quick review for CDL drivers",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, truck driver standing near semi truck with family photo or family scene implied, realistic, rugged but warm, no logos, no text overlay",
      videoScript:
        "[HOOK] Truck drivers — your family depends on you. [BODY] Life on the road comes with real responsibility, and there are coverage options that may help protect your family and provide peace of mind. [CTA] Tap below to review what may be available.",
      targeting: {
        ageRange: "28-60",
        interests: ["CDL", "Trucking", "Logistics"],
        notes: "Use straightforward language and practical tone.",
      },
      complianceNotes: [
        "Avoid saying other carriers deny all truckers.",
        "Do not make absolute approval claims.",
      ],
    },
    {
      angle: "hard_to_place",
      hook: "Not every policy is built for life on the road.",
      primaryText:
        "Truck drivers often want simpler coverage options that fit their work and schedule. A quick review can help you see what may be available without wasting time.",
      headline: "See Your Options Fast",
      description: "Built for busy drivers",
      cta: "LEARN_MORE",
      imagePrompt:
        "Vertical 9:16 ad image, commercial truck on open highway at sunrise, realistic, strong and trustworthy tone, no logos, no text overlay",
      videoScript:
        "[HOOK] Not every policy is built for life on the road. [BODY] Truck drivers often want simpler coverage options that fit their work and schedule. [CTA] Tap below to see what may be available.",
      targeting: {
        ageRange: "30-58",
        interests: ["Owner operator", "Freight", "Commercial driving"],
        notes: "Good for pain-point + speed angle.",
      },
      complianceNotes: [
        "Avoid implying universal denial by other carriers.",
        "Use 'may be available' wording.",
      ],
    },
  ],
};

function pickTemplate(leadType: LeadType): Template {
  const arr = TEMPLATES[leadType] || TEMPLATES.mortgage_protection;
  const index = Math.floor(Math.random() * arr.length);
  return arr[index];
}

async function improveWithAI(params: {
  leadType: string;
  template: Template;
  location?: string;
  gender?: string;
  ageMin?: number;
  ageMax?: number;
}): Promise<{
  primaryText: string;
  headline: string;
  description: string;
  hook: string;
  imagePrompt: string;
  videoScript: string;
} | null> {
  if (!openai) return null;

  const { leadType, template, location, gender, ageMin, ageMax } = params;

  const prompt = `You are writing a high-converting but compliant Facebook insurance lead ad.

Lead type: ${leadType}
Target location: ${location || "United States"}
Gender targeting: ${gender || "all"}
Age range: ${ageMin || "default"}-${ageMax || "default"}

Base angle: ${template.angle}
Base hook: ${template.hook}
Base primary text: ${template.primaryText}
Base headline: ${template.headline}
Base description: ${template.description}

Requirements:
- Keep it compliant for Meta insurance ads
- No government or VA endorsement implication
- No guaranteed claims
- No direct death language like "when you die"
- Use "may qualify", "options may be available", "quick review", "private coverage" style wording
- Make it sound human, not robotic
- Keep primary text under 450 characters
- Keep headline under 40 characters
- Keep description under 60 characters
- Return only JSON with:
{
  "hook": "...",
  "primaryText": "...",
  "headline": "...",
  "description": "...",
  "imagePrompt": "...",
  "videoScript": "..."
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You write compliant, high-converting Facebook insurance ads and return strict JSON only.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 700,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn("[generate-ad] AI enhancement failed:", (err as any)?.message || err);
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === "GET") {
      const template = pickTemplate("mortgage_protection");
      return res.status(200).json({
        primaryText: template.primaryText,
        headline: template.headline,
        description: template.description,
        targeting: template.targeting.notes,
        budgetSuggestion: 25,
        hook: template.hook,
        angle: template.angle,
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      leadType = "mortgage_protection",
      location = "",
      dailyBudget = 25,
      gender = "all",
      ageMin = 30,
      ageMax = 65,
    } = req.body as {
      leadType?: LeadType;
      location?: string;
      dailyBudget?: number;
      gender?: string;
      ageMin?: number;
      ageMax?: number;
    };

    const safeLeadType = (Object.keys(TEMPLATES).includes(String(leadType))
      ? leadType
      : "mortgage_protection") as LeadType;

    const creativeLeadType = safeLeadType as CreativeLeadType;
    const allCreativeRules = getCreativeRules(creativeLeadType);
    const primaryCreativeRule = getPrimaryCreativeRule(creativeLeadType);

    const template = pickTemplate(safeLeadType);

    const aiVersion = await improveWithAI({
      leadType: safeLeadType,
      template,
      location,
      gender,
      ageMin,
      ageMax,
    });

    const primaryText = aiVersion?.primaryText || template.primaryText;
    const headline = aiVersion?.headline || template.headline;
    const description = aiVersion?.description || template.description;
    const hook = aiVersion?.hook || template.hook;
    const imagePrompt = aiVersion?.imagePrompt || template.imagePrompt;
    const videoScript = aiVersion?.videoScript || template.videoScript;

    let imageUrl: string | null = null;
    let imageError: string | null = null;

    if (openai) {
      try {
        const img = await openai.images.generate({
          model: "gpt-image-1",
          prompt: imagePrompt,
          size: "1024x1024",
        });
        imageUrl = img.data?.[0]?.url || null;
      } catch (err: any) {
        imageError = err?.message || "Image generation failed";
        console.warn("[generate-ad] image generation failed:", imageError);
      }
    }

    const cleanLocation = String(location || "").trim();
    const campaignNameBase = safeLeadType
      .split("_")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");

    const campaignName = cleanLocation
      ? `${campaignNameBase} - ${cleanLocation}`
      : `${campaignNameBase} Campaign`;

    // Build per-variant copy by mapping template entries to creative rules.
    // Templates have 2 entries per lead type; rules have 3 — fall back to [0] for rule[2].
    const allTemplates = TEMPLATES[safeLeadType] || TEMPLATES.mortgage_protection;

    const draft = {
      leadType: safeLeadType,
      campaignName,
      dailyBudgetCents: Math.round((Number(dailyBudget) || 25) * 100),
      primaryText,
      headline,
      description,
      cta: template.cta,
      hook,
      angle: template.angle,
      imagePrompt,
      imageUrl: imageUrl ?? null,
      videoScript,
      targeting: {
        gender,
        ageMin: Number(ageMin) || 30,
        ageMax: Number(ageMax) || 65,
        location: cleanLocation,
        recommendedAgeRange: template.targeting.ageRange,
        interests: template.targeting.interests,
        notes: template.targeting.notes,
      },
      funnelType:
        safeLeadType === "veteran"
          ? "eligibility_quiz"
          : safeLeadType === "mortgage_protection"
          ? "quote_quiz"
          : "lead_form",
      complianceNotes: template.complianceNotes,
      selectedLeadFormId: null,
      leadFormQuestions: LEAD_FORM_QUESTIONS[safeLeadType] || LEAD_FORM_QUESTIONS.mortgage_protection,
      thankYouPageText: THANK_YOU_TEXT[safeLeadType] || THANK_YOU_TEXT.mortgage_protection,
      generatedBy: openai ? "template_plus_ai" : "template_only",
      copySource: (aiVersion ? "ai_generated" : "template_fallback") as "ai_generated" | "template_fallback",
      imageError: imageError ?? null,
      // Creative archetype data from creativeStyleRules
      creativeArchetype: primaryCreativeRule.archetype,
      overlayTemplate: primaryCreativeRule.overlayTemplate,
      overlayData: primaryCreativeRule.overlayData,
      // 3 structured variants — each has its own copy, image prompt, and overlay metadata
      variants: allCreativeRules.map((rule, i) => {
        const variantTemplate = allTemplates[i] ?? allTemplates[0];
        // Variant 0 uses AI-enhanced copy; variants 1+ use their template copy
        const vHeadline = i === 0 ? headline : variantTemplate.headline;
        const vPrimaryText = i === 0 ? primaryText : variantTemplate.primaryText;
        const vDescription = i === 0 ? description : variantTemplate.description;
        const vImagePrompt = `Vertical 9:16 ad image, ${rule.subjectDirection}, ${rule.colorDirection}, no logos, no text overlay`;
        return {
          id: `variant_${i}`,
          creativeArchetype: rule.archetype,
          headline: vHeadline,
          primaryText: vPrimaryText,
          description: vDescription,
          cta: variantTemplate.cta,
          imagePrompt: vImagePrompt,
          // Only the primary variant gets the generated image; others return null
          imageUrl: i === 0 ? (imageUrl ?? null) : null,
          overlayTemplate: rule.overlayTemplate,
          overlayData: rule.overlayData,
          colorDirection: rule.colorDirection,
          subjectDirection: rule.subjectDirection,
          buttonStyle: rule.buttonStyle,
          ctaStyle: rule.ctaStyle,
          offerStyle: rule.offerStyle,
          ageButtons: rule.ageButtons ?? null,
          coverageButtons: rule.coverageButtons ?? null,
        };
      }),
    };

    return res.status(200).json({
      ok: true,
      draft,
    });
  } catch (err: any) {
    console.error("[generate-ad] error:", err?.message);
    return res.status(500).json({ error: "Generate ad error" });
  }
}
