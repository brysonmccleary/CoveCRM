// pages/api/facebook/analyze-ad.ts
// GPT-4o structured analysis of a winning ad.
// Returns hook, why it works, rewritten copy, image prompt, video script,
// recreation steps, targeting suggestions, and budget guidance.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const sub = await FBLeadSubscription.findOne({
    userEmail: session.user.email.toLowerCase(),
    status: { $in: ["active", "trialing"] },
  }).lean();
  if (!sub) return res.status(403).json({ error: "FB Lead Manager subscription required" });

  const { adBody, adTitle, adDescription, pageName, daysRunning, leadType } = req.body as {
    adBody?: string;
    adTitle?: string;
    adDescription?: string;
    pageName?: string;
    daysRunning?: number;
    leadType?: string;
  };

  if (!adBody && !adTitle) {
    return res.status(400).json({ error: "adBody or adTitle required" });
  }

  const adText = [
    adTitle ? `HEADLINE: ${adTitle}` : "",
    adBody ? `BODY: ${adBody}` : "",
    adDescription ? `DESCRIPTION: ${adDescription}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `You are an expert Facebook ads strategist specializing in life insurance lead generation.
You analyze winning ads and provide actionable insights to help agents replicate their success.
Always respond with valid JSON matching the exact schema requested. No markdown fences.`;

  const userPrompt = `Analyze this Facebook ad that has been running for ${daysRunning ?? "unknown"} days from "${pageName ?? "unknown page"}".
Lead type: ${leadType || "life insurance"}.

AD COPY:
${adText}

Respond ONLY with this JSON schema (no markdown, no extra text):
{
  "hook": "The attention-grabbing first line or concept that makes people stop scrolling",
  "whyItWorks": "2–3 sentences on the psychological and strategic reasons this ad performs well",
  "emotionalTrigger": "The core emotion or pain point being addressed",
  "targetAudience": "Who this ad is clearly targeting and why it resonates with them",
  "rewrittenCopy": "A rewritten version of this ad body with the same proven structure but fresh copy you could use today",
  "imagePrompt": "A DALL-E or Midjourney prompt that would generate a high-converting image for this ad",
  "videoScript": "A 30–45 second video script with the same hook and emotional arc, formatted as: [HOOK] ... [BODY] ... [CTA]",
  "recreationSteps": ["Step 1", "Step 2", "Step 3", "Step 4"],
  "targetingRecommendations": {
    "ageRange": "e.g. 45–65",
    "interests": ["interest1", "interest2", "interest3"],
    "excludedAudiences": ["audience1"],
    "customAudienceTip": "One sentence tip on lookalike or retargeting strategy"
  },
  "budgetGuidance": "Recommended daily budget range and testing strategy for replicating this ad"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "{}";

    let analysis: any;
    try {
      analysis = JSON.parse(raw);
    } catch {
      // Strip markdown fences if present
      const stripped = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      analysis = JSON.parse(stripped);
    }

    return res.status(200).json({ ok: true, analysis });
  } catch (err: any) {
    console.error("[analyze-ad] error:", err?.message);
    return res.status(500).json({ error: "Failed to analyze ad" });
  }
}
