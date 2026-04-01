// pages/api/facebook/ads-library.ts
// Search Meta Ads Library for winning ads by lead type.
// Scores each ad by longevity, video presence, body length, and CTA.
// Gated behind active FBLeadSubscription.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadSubscription from "@/models/FBLeadSubscription";

const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";

// Lead type → search terms that surface strong life insurance ads
const LEAD_TYPE_SEARCH_TERMS: Record<string, string> = {
  final_expense: "final expense life insurance",
  mortgage_protection: "mortgage protection insurance",
  iul: "cash value life insurance IUL",
  veteran: "veteran life insurance benefits",
  trucker: "trucker life insurance",
};

interface RawAd {
  id: string;
  page_name?: string;
  ad_creative_body?: string;
  ad_creative_link_caption?: string;
  ad_creative_link_description?: string;
  ad_creative_link_title?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_snapshot_url?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  currency?: string;
  spend?: { lower_bound?: string; upper_bound?: string };
  impressions?: { lower_bound?: string; upper_bound?: string };
  // video presence inferred from snapshot url or body keywords
}

interface ScoredAd {
  id: string;
  pageName: string;
  body: string;
  title: string;
  description: string;
  snapshotUrl: string;
  daysRunning: number;
  hasVideo: boolean;
  score: number;
  spendRange: string;
  impressionRange: string;
  dataSource: string;
  disclaimer: string;
}

function daysBetween(isoStart: string, isoEnd?: string): number {
  const start = new Date(isoStart).getTime();
  const end = isoEnd ? new Date(isoEnd).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

function scoreAd(ad: RawAd): number {
  const body = ad.ad_creative_body || (ad.ad_creative_bodies?.[0] ?? "");
  const daysRunning = ad.ad_delivery_start_time
    ? daysBetween(ad.ad_delivery_start_time, ad.ad_delivery_stop_time)
    : 0;

  // Scoring heuristics (max ~100)
  let score = 0;

  // Longevity: ads running 30+ days are proven
  if (daysRunning >= 90) score += 40;
  else if (daysRunning >= 30) score += 25;
  else if (daysRunning >= 14) score += 15;
  else if (daysRunning >= 7) score += 8;

  // Body length: more copy = more testing investment
  if (body.length >= 300) score += 20;
  else if (body.length >= 150) score += 12;
  else if (body.length >= 50) score += 6;

  // CTA keywords
  const bodyLower = body.toLowerCase();
  if (bodyLower.includes("free") || bodyLower.includes("no cost")) score += 10;
  if (bodyLower.includes("apply") || bodyLower.includes("get quote") || bodyLower.includes("click")) score += 8;
  if (bodyLower.includes("approved") || bodyLower.includes("guaranteed")) score += 6;

  // Video signals
  const snapshotUrl = ad.ad_snapshot_url || "";
  const hasVideo =
    snapshotUrl.includes("video") ||
    bodyLower.includes("watch") ||
    bodyLower.includes("video");
  if (hasVideo) score += 16;

  return score;
}

function buildScoredAd(ad: RawAd): ScoredAd {
  const body = ad.ad_creative_body || (ad.ad_creative_bodies?.[0] ?? "");
  const title = ad.ad_creative_link_title || (ad.ad_creative_link_titles?.[0] ?? "");
  const daysRunning = ad.ad_delivery_start_time
    ? daysBetween(ad.ad_delivery_start_time, ad.ad_delivery_stop_time)
    : 0;
  const snapshotUrl = ad.ad_snapshot_url || "";
  const hasVideo =
    snapshotUrl.includes("video") ||
    body.toLowerCase().includes("watch") ||
    body.toLowerCase().includes("video");
  const spendLow = ad.spend?.lower_bound ?? "?";
  const spendHigh = ad.spend?.upper_bound ?? "?";
  const impLow = ad.impressions?.lower_bound ?? "?";
  const impHigh = ad.impressions?.upper_bound ?? "?";

  return {
    id: ad.id,
    pageName: ad.page_name || "Unknown",
    body,
    title,
    description: ad.ad_creative_link_description || "",
    snapshotUrl,
    daysRunning,
    hasVideo,
    score: scoreAd(ad),
    spendRange: spendLow === "?" ? "N/A" : `$${spendLow}–$${spendHigh}`,
    impressionRange: impLow === "?" ? "N/A" : `${impLow}–${impHigh}`,
    dataSource: "meta_ads_library_search",
    disclaimer: "Ad performance estimates are based on run duration heuristics, not verified Meta metrics",
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  // Gate: active FBLeadSubscription required
  const sub = await FBLeadSubscription.findOne({
    userEmail: session.user.email.toLowerCase(),
    status: { $in: ["active", "trialing"] },
  }).lean();
  if (!sub) return res.status(403).json({ error: "FB Lead Manager subscription required" });

  const leadType = String(req.query.leadType || "mortgage_protection");
  const searchQuery = LEAD_TYPE_SEARCH_TERMS[leadType] || LEAD_TYPE_SEARCH_TERMS["mortgage_protection"];

  const token = process.env.META_SYSTEM_USER_TOKEN || process.env.META_PAGE_ACCESS_TOKEN || "";
  if (!token) return res.status(500).json({ error: "Meta access token not configured" });

  const url = new URL(`${META_GRAPH_BASE}/ads_archive`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("ad_type", "ALL");
  url.searchParams.set("ad_reached_countries", '["US"]');
  url.searchParams.set("search_terms", searchQuery);
  url.searchParams.set("ad_active_status", "ALL");
  url.searchParams.set(
    "fields",
    "id,page_name,ad_creative_body,ad_creative_bodies,ad_creative_link_caption,ad_creative_link_description,ad_creative_link_title,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,spend,impressions"
  );
  url.searchParams.set("limit", "50");

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return res.status(502).json({ error: `Meta Ads Library error ${resp.status}`, detail: body.slice(0, 300) });
    }
    const json = await resp.json() as any;
    const rawAds: RawAd[] = json?.data || [];

    // Score, filter blanks, sort descending, return top 20
    const scored = rawAds
      .map(buildScoredAd)
      .filter((a) => a.body.length > 0 || a.title.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    return res.status(200).json({ ok: true, ads: scored, total: rawAds.length });
  } catch (err: any) {
    console.error("[ads-library] error:", err?.message);
    return res.status(500).json({ error: "Failed to fetch ads library" });
  }
}
