// pages/api/ai/suggest-drip.ts
// Suggests an email campaign name/approach based on folder context using gpt-4o-mini.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { leadType, folderName, existingCampaigns = [] } = req.body as {
    leadType?: string;
    folderName: string;
    existingCampaigns: string[];
  };

  if (!folderName || typeof folderName !== "string") {
    return res.status(400).json({ error: "folderName is required" });
  }

  const existing =
    existingCampaigns.length > 0
      ? `Existing campaigns the agent already has: ${existingCampaigns.join(", ")}.`
      : "The agent has no existing campaigns yet.";

  const systemPrompt = `You are an insurance recruitment strategist. Based on the folder name an agent just created, suggest the best email drip campaign approach for that folder.

${existing}

Suggest a campaign that is different from existing ones if possible. Keep suggestions specific to insurance agent recruitment.

Respond with JSON only in this exact shape:
{
  "suggestion": "<suggested campaign name, under 50 chars>",
  "reason": "<one sentence explaining why this campaign fits the folder>"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Folder name: "${folderName}"${leadType ? `\nLead type: ${leadType}` : ""}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    return res.status(200).json({
      suggestion: String(parsed.suggestion || "").slice(0, 50),
      reason: String(parsed.reason || ""),
    });
  } catch (err: any) {
    console.error("[suggest-drip] OpenAI error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Suggestion failed" });
  }
}
