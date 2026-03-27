// pages/api/ai/explain-drip.ts
// POST — use GPT-4o-mini to explain what a drip sequence does in plain English
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import OpenAI from "openai";

export const config = { maxDuration: 30 };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({ explanation: "AI explanation requires OPENAI_API_KEY." });
  }

  const { steps, campaignName, channel } = req.body as {
    steps?: { day: number; text: string }[];
    campaignName?: string;
    channel?: "sms" | "email";
  };

  if (!steps || steps.length === 0) {
    return res.status(400).json({ error: "steps array is required" });
  }

  const stepsText = steps
    .map((s) => `Day ${s.day}: "${s.text}"`)
    .join("\n");

  const prompt = `You are a helpful insurance sales coach. A CRM user has a ${channel || "SMS"} drip sequence called "${campaignName || "Untitled"}". Here are the steps:\n\n${stepsText}\n\nExplain this sequence in 2-3 plain English sentences. Focus on the timing strategy, tone, and what outcome it's designed for. Be concise and friendly.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
    });

    const explanation = completion.choices[0]?.message?.content?.trim() || "No explanation generated.";
    return res.status(200).json({ explanation });
  } catch (err: any) {
    console.error("[explain-drip] OpenAI error:", err?.message);
    return res.status(500).json({ error: "Failed to generate explanation" });
  }
}
