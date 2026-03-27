// pages/api/ai/optimize-campaign.ts
// POST — analyze FB campaign metrics and return optimization recommendation
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { campaignId, metrics } = req.body as {
    campaignId?: string;
    metrics: {
      spend: number;
      leads: number;
      clicks: number;
      cpl: number;
      daysSinceStart: number;
    };
  };

  if (!metrics) return res.status(400).json({ error: "metrics are required" });

  if (campaignId) {
    await mongooseConnect();
    const campaign = await FBLeadCampaign.findOne({
      _id: campaignId,
      userEmail: session.user.email,
    }).lean();
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
  }

  const { spend, leads, clicks, cpl, daysSinceStart } = metrics;

  const prompt = `Analyze this Facebook insurance lead campaign performance and provide a recommendation.

Campaign metrics:
- Total spend: $${spend}
- Leads generated: ${leads}
- Clicks: ${clicks}
- Cost per lead (CPL): $${cpl}
- Days running: ${daysSinceStart}

Performance rules to apply:
- CPL under $10 = excellent, scale up budget 20-30%
- CPL $10-20 = good, maintain and test new creative
- CPL $20-35 = below average, test new audience or new ad creative
- CPL over $35 = poor, pause and rebuild campaign
- Under 5 leads after $50 spend = stop immediately

Return exactly this JSON:
{
  "recommendation": "1-2 sentence specific recommendation",
  "action": "scale" | "pause" | "test" | "stop",
  "reasoning": "2-3 sentences explaining why",
  "suggestedBudgetChange": null or number (percentage, e.g. 25 means increase 25%, -100 means stop)
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert Facebook advertising analyst specializing in insurance lead generation campaigns. Analyze campaign metrics and provide clear, actionable optimization advice based on cost per lead benchmarks.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const result = JSON.parse(raw);

    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[optimize-campaign] OpenAI error:", err?.message);
    return res.status(500).json({ error: "AI analysis failed" });
  }
}
