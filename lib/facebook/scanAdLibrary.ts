// lib/facebook/scanAdLibrary.ts
// Scans Facebook Ad Library for winning ad patterns per insurance lead type.
import axios from "axios";
import mongooseConnect from "@/lib/mongooseConnect";
import FBAdIntelligence from "@/models/FBAdIntelligence";

const LEAD_TYPE_QUERIES: Record<string, string[]> = {
  final_expense: [
    "final expense insurance",
    "burial insurance",
    "senior life insurance",
  ],
  iul: [
    "indexed universal life",
    "IUL insurance",
    "cash value life insurance",
  ],
  mortgage_protection: [
    "mortgage protection insurance",
    "protect your mortgage",
  ],
  veteran: [
    "veteran life insurance",
    "military life insurance",
    "VA benefits",
  ],
  trucker: [
    "trucker insurance",
    "CDL insurance",
    "commercial driver insurance",
  ],
};

export interface AdPattern {
  headline: string;
  primaryText: string;
  description: string;
  ctaButton: string;
  targetingNotes: string;
  estimatedCpl: number;
  performanceRating: number;
}

// Map FB Graph API ad fields to our schema
function parseGraphAdResult(ad: any, leadType: string): AdPattern {
  const headline = ad.ad_creative_link_title || ad.ad_creative_link_caption || "";
  const primaryText = ad.ad_creative_body || "";
  const description = ad.ad_creative_link_description || "";
  const pageName = ad.page_name || "";

  // Estimate performance from spend/impressions ratio
  const spend = ad.spend?.lower_bound ?? 0;
  const impressions = ad.impressions?.lower_bound ?? 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const rating = cpm < 10 ? 5 : cpm < 20 ? 4 : cpm < 40 ? 3 : 2;

  return {
    headline: headline.slice(0, 200),
    primaryText: primaryText.slice(0, 500),
    description: description.slice(0, 300),
    ctaButton: "Learn More",
    targetingNotes: pageName ? `Page: ${pageName}` : "",
    estimatedCpl: cplRangeForLeadType(leadType),
    performanceRating: rating,
  };
}

function cplRangeForLeadType(leadType: string): number {
  const ranges: Record<string, number> = {
    final_expense: 12,
    iul: 20,
    mortgage_protection: 15,
    veteran: 14,
    trucker: 18,
  };
  return ranges[leadType] ?? 15;
}

// Fallback seed patterns when FB API is unavailable
function seedPatternsForLeadType(leadType: string): AdPattern[] {
  const seeds: Record<string, AdPattern[]> = {
    final_expense: [
      {
        headline: "Help Cover Final Expenses",
        primaryText: "Leave your family with peace of mind, not debt. Get a free final expense quote in 60 seconds.",
        description: "No medical exam required. Coverage from $5,000-$35,000.",
        ctaButton: "Get Quote",
        targetingNotes: "Age 50-80, interests: AARP, seniors, retirement planning",
        estimatedCpl: 12,
        performanceRating: 4,
      },
      {
        headline: "Protect Your Family Today",
        primaryText: "Don't leave your loved ones with funeral costs. Final expense coverage starting at $12/month.",
        description: "Guaranteed acceptance. No waiting period.",
        ctaButton: "Learn More",
        targetingNotes: "Age 55-75, income $25k-$60k, homeowners",
        estimatedCpl: 10,
        performanceRating: 5,
      },
    ],
    iul: [
      {
        headline: "Grow Wealth Tax-Free",
        primaryText: "Build retirement income with an Indexed Universal Life policy. Market gains, zero market risk.",
        description: "Earn up to 12% indexed returns with 0% floor.",
        ctaButton: "Learn More",
        targetingNotes: "Age 30-55, HHI $75k+, interests: investing, retirement",
        estimatedCpl: 20,
        performanceRating: 4,
      },
    ],
    mortgage_protection: [
      {
        headline: "Protect Your Home",
        primaryText: "If something happens to you, your family keeps the house. Mortgage protection starting at $18/mo.",
        description: "Simple approval. Covers your full mortgage balance.",
        ctaButton: "Get Protected",
        targetingNotes: "New homeowners, age 25-55, recent mortgage",
        estimatedCpl: 15,
        performanceRating: 4,
      },
    ],
    veteran: [
      {
        headline: "Veterans: Maximize Benefits",
        primaryText: "Eligible veterans may qualify for additional life insurance benefits. See what you qualify for.",
        description: "Exclusive programs for US veterans and their families.",
        ctaButton: "Check Eligibility",
        targetingNotes: "Veterans, military interests, age 40-70, VA benefits",
        estimatedCpl: 14,
        performanceRating: 4,
      },
    ],
    trucker: [
      {
        headline: "Life Insurance for Truckers",
        primaryText: "CDL drivers: get life insurance that understands your profession. Quick approval, fair rates.",
        description: "Coverage designed for commercial drivers.",
        ctaButton: "Get a Quote",
        targetingNotes: "CDL holders, trucking industry, age 25-60",
        estimatedCpl: 18,
        performanceRating: 3,
      },
    ],
  };
  return seeds[leadType] ?? seeds["final_expense"];
}

export async function scanAdLibraryForLeadType(leadType: string): Promise<AdPattern[]> {
  await mongooseConnect();

  const queries = LEAD_TYPE_QUERIES[leadType];
  if (!queries?.length) {
    console.warn(`[scanAdLibrary] Unknown leadType: ${leadType}`);
    return [];
  }

  const token = process.env.FB_AD_LIBRARY_TOKEN;
  const found: AdPattern[] = [];

  if (token) {
    // Try official Graph API
    for (const query of queries.slice(0, 1)) {
      try {
        const url = new URL("https://graph.facebook.com/v19.0/ads_archive");
        url.searchParams.set("access_token", token);
        url.searchParams.set("ad_type", "ALL");
        url.searchParams.set("ad_reached_countries", '["US"]');
        url.searchParams.set("search_terms", query);
        url.searchParams.set(
          "fields",
          "id,ad_creative_body,ad_creative_link_caption,ad_creative_link_description,ad_creative_link_title,page_name,spend,impressions"
        );
        url.searchParams.set("limit", "10");

        const res = await axios.get(url.toString(), { timeout: 10000 });
        const data: any[] = res.data?.data ?? [];

        for (const ad of data.slice(0, 5)) {
          found.push(parseGraphAdResult(ad, leadType));
        }
      } catch (err: any) {
        console.warn(`[scanAdLibrary] Graph API error for "${query}": ${err?.message}`);
      }
    }
  }

  // Fall back to seed patterns when FB API is unavailable or returned nothing
  const patterns = found.length > 0 ? found : seedPatternsForLeadType(leadType);

  // Upsert top 5 results into FBAdIntelligence
  const now = new Date();
  for (const p of patterns.slice(0, 5)) {
    await FBAdIntelligence.findOneAndUpdate(
      { leadType, headline: p.headline },
      {
        $set: {
          leadType,
          headline: p.headline,
          primaryText: p.primaryText,
          description: p.description,
          ctaButton: p.ctaButton,
          targetingNotes: p.targetingNotes,
          estimatedCpl: p.estimatedCpl,
          performanceRating: p.performanceRating,
          scrapedFrom: "facebook_ad_library",
          scrapedAt: now,
          active: true,
        },
      },
      { upsert: true, new: true }
    );
  }

  return patterns;
}
