// pages/api/facebook/scan-ads.ts
// POST { leadType } — returns pre-built Ad Library search URLs + seed winning patterns
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBAdIntelligence from "@/models/FBAdIntelligence";

// Pre-built Facebook Ad Library search URLs per lead type
const AD_LIBRARY_URLS: Record<string, string> = {
  final_expense:
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=final+expense+insurance&search_type=keyword_unordered",
  veteran:
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=veteran+life+insurance&search_type=keyword_unordered",
  mortgage_protection:
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=mortgage+protection+insurance&search_type=keyword_unordered",
  iul:
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=indexed+universal+life+insurance&search_type=keyword_unordered",
  trucker:
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=trucker+life+insurance&search_type=keyword_unordered",
};

// Seed winning patterns per lead type
const SEED_PATTERNS: Record<
  string,
  { headline: string; primaryText: string; ctaButton: string; targetingNotes: string; notes: string; performanceRating: number }[]
> = {
  final_expense: [
    {
      headline: "Are you between 50-85?",
      primaryText:
        "Are you between 50-85 and worried about leaving your family with funeral costs? This simple plan covers your final expenses starting at $20/month. No medical exam. No waiting period.",
      ctaButton: "Get My Free Quote",
      targetingNotes: "Age 50-85, homeowners, income $25k-$75k",
      notes: "Image style: Senior couple smiling at home. Offer type: Benefits check, NOT price quote upfront. Funnel: Lead form (no landing page needed).",
      performanceRating: 5,
    },
    {
      headline: "Seniors: Don't leave this behind",
      primaryText:
        "Your family shouldn't have to pay for your funeral. Final expense insurance covers everything — burial, casket, flowers — so your loved ones don't have to worry about a thing.",
      ctaButton: "See If I Qualify",
      targetingNotes: "Age 55-80, interests: AARP, retirement, Medicare",
      notes: "Image style: Family photo, multigenerational. Emotional hook: guilt/love. No price mention in headline.",
      performanceRating: 5,
    },
    {
      headline: "Final expense: $20/month?",
      primaryText:
        "This simple plan covers your final expenses starting at $20/month. Guaranteed approval for ages 50-85. No medical exam required. Lock in your rate today before prices go up.",
      ctaButton: "Get My Free Quote",
      targetingNotes: "Age 50-75, behaviors: online shoppers, interests: life insurance",
      notes: "Price-forward hook works for budget-conscious seniors. Follow up within 5 minutes of lead submission.",
      performanceRating: 4,
    },
  ],
  mortgage_protection: [
    {
      headline: "New homeowner? Read this.",
      primaryText:
        "If something happened to you tomorrow, could your family afford the mortgage? Mortgage protection insurance keeps your family in your home no matter what. Get a free review — takes 2 minutes.",
      ctaButton: "Protect My Home",
      targetingNotes: "Age 25-55, recent homebuyers, interests: home improvement, homeownership",
      notes: "Image style: Couple in front of home with keys. Fear hook + solution framing. Lead form funnel.",
      performanceRating: 5,
    },
    {
      headline: "Keep your family in your home",
      primaryText:
        "You worked hard for your home. Mortgage protection insurance makes sure your family never has to leave it — even if you're gone. Free mortgage protection review available for homeowners in your area.",
      ctaButton: "Get Free Review",
      targetingNotes: "Homeowners, age 30-55, household income $50k+",
      notes: "Aspirational + protective angle. Works well on mobile. Square image format recommended.",
      performanceRating: 4,
    },
  ],
  veteran: [
    {
      headline: "VA benefits don't cover this",
      primaryText:
        "VA benefits don't cover funeral costs — and most veterans don't know it. Here's what veterans need to know about protecting their family when they're gone. Free benefits check available.",
      ctaButton: "Check My Benefits",
      targetingNotes: "Age 45-75, veterans, military families, interests: VA benefits, patriotic",
      notes: "Image style: Veteran in civilian clothes with family, American flag. Do NOT use military uniforms or official VA/military insignia.",
      performanceRating: 5,
    },
    {
      headline: "Are you a veteran?",
      primaryText:
        "Are you a veteran missing out on benefits you've already earned? Many veterans qualify for coverage they've never claimed. Check what you're entitled to — takes 60 seconds.",
      ctaButton: "See If I Qualify",
      targetingNotes: "Veterans, age 50-75, interests: American Legion, VFW, patriotic",
      notes: "Question hook works well. Entitlement framing resonates with veterans. Avoid political messaging.",
      performanceRating: 4,
    },
  ],
  iul: [
    {
      headline: "Tax-free retirement income?",
      primaryText:
        "The life insurance policy that also builds tax-free wealth. How I'm earning market-linked returns without risking my principal — and passing it all on tax-free. Free analysis available.",
      ctaButton: "Get My Free Analysis",
      targetingNotes: "Age 35-55, household income $75k+, interests: investing, financial planning, retirement",
      notes: "Image style: Professional/family financial planning. Wealth-building angle. NOT for low-income audiences.",
      performanceRating: 4,
    },
    {
      headline: "Earn without risking principal",
      primaryText:
        "How do high earners build tax-free retirement income? Indexed universal life insurance links your growth to the market — but protects your principal in down years. See how it works.",
      ctaButton: "Learn More",
      targetingNotes: "Age 35-55, business owners, professionals, income $100k+",
      notes: "Educational angle. Lead form ask should be minimal — name and email only. Follow up with phone call.",
      performanceRating: 4,
    },
  ],
  trucker: [
    {
      headline: "CDL drivers: Your family first",
      primaryText:
        "Life on the road is tough. Your family deserves protection no matter what happens. Life insurance built for truckers — no medical exam required, competitive rates, fast approval.",
      ctaButton: "Get Protected Today",
      targetingNotes: "CDL drivers, age 30-55, interests: trucking, commercial driving, logistics",
      notes: "Image style: Trucker with family, or truck on open road. Emphasize ease of approval — CDL drivers often have high-risk occupations that complicate traditional insurance.",
      performanceRating: 5,
    },
    {
      headline: "Life insurance for truckers",
      primaryText:
        "CDL drivers often get denied for regular life insurance — but there are plans built just for you. No medical exam. Covers your family if you're in an accident. Get a free quote today.",
      ctaButton: "Get My Free Quote",
      targetingNotes: "Truckers, OTR drivers, age 25-55, interests: trucking lifestyle, Owner Operators",
      notes: "Pain-point lead: being denied. Addresses real fear. Fast follow-up critical — truckers are on the move.",
      performanceRating: 4,
    },
  ],
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { leadType } = req.body as { leadType?: string };
  if (!leadType) return res.status(400).json({ error: "leadType is required" });

  await mongooseConnect();

  const adLibraryUrl =
    AD_LIBRARY_URLS[leadType] ??
    "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=insurance&search_type=keyword_unordered";

  // Check if we have patterns for this lead type
  const existingCount = await FBAdIntelligence.countDocuments({ leadType, active: true });

  // Seed if empty
  if (existingCount === 0 && SEED_PATTERNS[leadType]) {
    const seeds = SEED_PATTERNS[leadType].map((p) => ({
      ...p,
      leadType,
      scrapedFrom: "facebook_ad_library",
      active: true,
    }));
    try {
      await FBAdIntelligence.insertMany(seeds, { ordered: false });
    } catch {
      // ignore duplicate key errors on re-seed
    }
  }

  const winningPatterns = await FBAdIntelligence.find({ leadType, active: true })
    .sort({ performanceRating: -1 })
    .limit(10)
    .lean();

  return res.status(200).json({
    ok: true,
    adLibraryUrl,
    winningPatterns,
    ads: winningPatterns, // backward-compat alias
    count: winningPatterns.length,
    tip: "Click 'Browse Live Winning Ads' to explore currently running ads in your niche. Look for ads that have been running 30+ days — those are the proven winners.",
  });
}
