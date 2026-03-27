// lib/facebook/generateActionReport.ts
// Generate daily AI action report for a user's FB campaigns
import { OpenAI } from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import AdActionReport from "@/models/AdActionReport";
import CRMOutcome from "@/models/CRMOutcome";
import AdMetricsDaily from "@/models/AdMetricsDaily";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateDailyActionReport(
  userId: string,
  userEmail: string
): Promise<string> {
  await mongooseConnect();

  const today = new Date().toISOString().split("T")[0];

  // Get all active/paused campaigns
  const campaigns = await FBLeadCampaign.find({
    userId,
    status: { $in: ["active", "paused"] },
  }).lean();

  if (campaigns.length === 0) {
    return "No active campaigns to analyze.";
  }

  // Build per-campaign context
  const campaignSummaries: string[] = [];
  const campaignActions: any[] = [];

  for (const c of campaigns) {
    const cid = c._id;
    const score = (c as any).performanceScore;
    const pClass = (c as any).performanceClass || "UNKNOWN";

    // Last 7 days of metrics
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const metricsAgg = await AdMetricsDaily.aggregate([
      { $match: { campaignId: cid, date: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: null,
          spend: { $sum: "$spend" },
          leads: { $sum: "$leads" },
          clicks: { $sum: "$clicks" },
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

    const m = metricsAgg[0] || { spend: 0, leads: 0, clicks: 0 };
    const o = outcomeAgg[0] || { appointmentsBooked: 0, sales: 0, revenue: 0 };

    const cpl = m.leads > 0 ? (m.spend / m.leads).toFixed(2) : "N/A";

    campaignSummaries.push(
      `Campaign: "${(c as any).campaignName}" (${(c as any).leadType})
  Status: ${(c as any).status} | Score: ${score ?? "unscored"} (${pClass})
  Last 7 days: Spend $${m.spend.toFixed(2)}, Leads: ${m.leads}, CPL: $${cpl}
  CRM: Booked ${o.appointmentsBooked}, Sales ${o.sales}, Revenue $${o.revenue.toFixed(2)}`
    );

    if (pClass && pClass !== "UNKNOWN") {
      campaignActions.push({
        campaignId: String(cid),
        campaignName: (c as any).campaignName,
        action: pClass,
        performanceScore: score,
        performanceClass: pClass,
      });
    }
  }

  const prompt = `You are an expert Facebook Ads manager for insurance agents. Based on the following campaign performance data, generate a concise daily action report.

CAMPAIGN DATA:
${campaignSummaries.join("\n\n")}

Generate a daily action report that:
1. Starts with a 2-sentence executive summary
2. For each campaign: state the recommended action (SCALE/DUPLICATE_TEST/MONITOR/FIX/PAUSE) and give 2-3 specific, actionable steps
3. Ends with today's top priority (one campaign, one clear action)

Be direct and specific. Use plain text, no markdown headers. Keep it under 400 words.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content:
          "You are an expert Facebook Ads manager specializing in insurance lead generation. Give actionable, data-driven recommendations. Be concise and direct.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 800,
  });

  const reportText = completion.choices[0]?.message?.content ?? "";
  const tokensUsed = completion.usage?.total_tokens ?? 0;

  // Add reasoning to campaign actions
  const actionsWithReasoning = campaignActions.map((ca) => ({
    ...ca,
    reasoning: `Auto-classified as ${ca.performanceClass} with score ${ca.performanceScore}`,
  }));

  // Save report
  await AdActionReport.create({
    userId,
    userEmail,
    type: "daily",
    date: today,
    reportText,
    summary: reportText.slice(0, 200),
    campaignActions: actionsWithReasoning,
    generatedAt: new Date(),
    tokensUsed,
  });

  // Update lastActionReport on each campaign
  for (const ca of campaignActions) {
    await FBLeadCampaign.updateOne(
      { _id: ca.campaignId },
      { $set: { lastActionReport: ca.action, lastActionReportAt: new Date() } }
    );
  }

  return reportText;
}
