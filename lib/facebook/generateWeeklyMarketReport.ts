// lib/facebook/generateWeeklyMarketReport.ts
// Generate weekly market intelligence report using competitor ad data
import { OpenAI } from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import AdActionReport from "@/models/AdActionReport";
import CompetitorAd from "@/models/CompetitorAd";
import CRMOutcome from "@/models/CRMOutcome";
import AdMetricsDaily from "@/models/AdMetricsDaily";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateWeeklyMarketReport(
  userId: string,
  userEmail: string
): Promise<string> {
  await mongooseConnect();

  const today = new Date().toISOString().split("T")[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  // Get active campaigns
  const campaigns = await FBLeadCampaign.find({
    userId,
    status: { $in: ["active", "paused"] },
  }).lean();

  // Gather lead types being advertised
  const leadTypes = [...new Set(campaigns.map((c) => (c as any).leadType as string))];

  // Fetch competitor ads for these lead types
  const competitorAds = await CompetitorAd.find({
    leadType: { $in: leadTypes },
    active: true,
  })
    .sort({ engagementLevel: -1, performanceRating: -1 })
    .limit(20)
    .lean();

  // Build user's 7-day performance summary
  const campaignSummaries: string[] = [];
  for (const c of campaigns) {
    const cid = c._id;
    const metricsAgg = await AdMetricsDaily.aggregate([
      { $match: { campaignId: cid, date: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: null,
          spend: { $sum: "$spend" },
          leads: { $sum: "$leads" },
        },
      },
    ]);
    const outcomeAgg = await CRMOutcome.aggregate([
      { $match: { campaignId: cid, date: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: null,
          appointmentsBooked: { $sum: "$appointmentsBooked" },
          sales: { $sum: "$sales" },
          revenue: { $sum: "$revenue" },
        },
      },
    ]);

    const m = metricsAgg[0] || { spend: 0, leads: 0 };
    const o = outcomeAgg[0] || { appointmentsBooked: 0, sales: 0, revenue: 0 };
    const cpl = m.leads > 0 ? (m.spend / m.leads).toFixed(2) : "N/A";
    const score = (c as any).performanceScore ?? "unscored";
    const pClass = (c as any).performanceClass ?? "UNKNOWN";

    campaignSummaries.push(
      `"${(c as any).campaignName}" (${(c as any).leadType}): Score ${score} (${pClass}), Spend $${m.spend.toFixed(2)}, Leads ${m.leads}, CPL $${cpl}, Booked ${o.appointmentsBooked}, Sales ${o.sales}`
    );
  }

  // Format competitor ad intelligence
  const competitorContext =
    competitorAds.length > 0
      ? competitorAds
          .map(
            (ad) =>
              `[${(ad as any).leadType}] Hook: "${(ad as any).hook || (ad as any).headline}" | Offer: "${(ad as any).offer}" | Funnel: ${(ad as any).funnelType} | Engagement: ${(ad as any).engagementLevel} | Est. CPL: $${(ad as any).estimatedCpl}`
          )
          .join("\n")
      : "No competitor ad data available yet.";

  const prompt = `You are an expert Facebook Ads strategist for insurance agents. Generate a weekly market intelligence report.

USER'S CAMPAIGN PERFORMANCE (Last 7 days):
${campaignSummaries.join("\n") || "No active campaigns."}

COMPETITOR AD INTELLIGENCE:
${competitorContext}

Generate a weekly market report that includes:
1. MARKET PULSE (2-3 sentences on what's working in the market right now)
2. TOP COMPETITOR HOOKS (list the 3 most compelling hooks you see in the data, or suggest 3 if none)
3. TRENDING ANGLES (what messaging angles are winning — fear, aspiration, urgency, social proof?)
4. YOUR BIGGEST OPPORTUNITY THIS WEEK (specific campaign + specific change to make)
5. SUGGESTED AD CHANGES (2-3 concrete copy/creative changes to test)
6. OUTLOOK (one sentence prediction for next week)

Be specific, actionable, and data-driven. Plain text, no markdown. Under 500 words.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are an elite Facebook Ads strategist specializing in insurance lead generation. Combine performance data with competitive intelligence to give agents an unfair advantage.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 1000,
  });

  const reportText = completion.choices[0]?.message?.content ?? "";
  const tokensUsed = completion.usage?.total_tokens ?? 0;

  // Build market intelligence summary
  const topHooks = competitorAds
    .filter((ad) => (ad as any).engagementLevel === "high" || (ad as any).engagementLevel === "viral")
    .map((ad) => (ad as any).hook || (ad as any).headline)
    .filter(Boolean)
    .slice(0, 3);

  // Save report
  await AdActionReport.create({
    userId,
    userEmail,
    type: "weekly",
    date: today,
    reportText,
    summary: reportText.slice(0, 200),
    campaignActions: campaigns.map((c) => ({
      campaignId: String(c._id),
      campaignName: (c as any).campaignName,
      action: (c as any).performanceClass || "MONITOR",
      performanceScore: (c as any).performanceScore,
      performanceClass: (c as any).performanceClass,
    })),
    marketIntelligence: {
      topCompetitorHooks: topHooks,
      trendingSentiment: "",
      recommendedAngles: [],
      suggestedAdChanges: "",
    },
    generatedAt: new Date(),
    tokensUsed,
  });

  return reportText;
}
