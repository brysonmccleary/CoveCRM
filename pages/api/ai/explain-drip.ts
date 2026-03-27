// pages/api/ai/explain-drip.ts
// POST — given a lead scenario, build a complete drip sequence using GPT-4o-mini
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import OpenAI from "openai";

export const config = { maxDuration: 30 };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are an expert insurance sales coach and copywriter. You build high-converting SMS and email drip sequences for insurance agents. You understand insurance buyer psychology, common objections, and what motivates people to take action. Always respond with valid JSON only.`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({ error: "AI requires OPENAI_API_KEY." });
  }

  const { scenario, type = "sms", campaignName, stepCount = 5 } = req.body as {
    scenario?: string;
    type?: "sms" | "email";
    campaignName?: string;
    stepCount?: number;
  };

  if (!scenario || !scenario.trim()) {
    return res.status(400).json({ error: "scenario is required" });
  }

  const count = Math.min(Math.max(Number(stepCount) || 5, 3), 10);

  const userPrompt = `Build a ${type} drip campaign for this lead scenario:
${scenario.trim()}

Return a JSON object:
{
  "campaignName": string,
  "description": string,
  "steps": [
    {
      "day": number,
      "subject": string,
      "text": string,
      "reasoning": string
    }
  ]
}

Build ${count} steps. Space them appropriately (day 0, 2, 5, 10, 14 for example).
${type === "sms"
  ? "For SMS: keep each message under 160 characters. Conversational, not salesy. No subject line needed (use empty string). Use {{first_name}} and {{agent_name}} merge fields."
  : "For email: include meaningful subject lines. Professional but warm. Use {{first_name}} and {{agent_name}} merge fields."}
Always include an opt-out line in the last step.
${campaignName ? `Campaign name suggestion from user: "${campaignName}" (use this or improve it).` : ""}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1200,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    return res.status(200).json({
      campaignName: parsed.campaignName || "AI Drip Campaign",
      description: parsed.description || "",
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    });
  } catch (err: any) {
    console.error("[explain-drip] OpenAI error:", err?.message);
    return res.status(500).json({ error: "Failed to generate campaign" });
  }
}
