// pages/api/ai/score-subject.ts
// Scores an email subject line and returns feedback + suggestions using gpt-4o-mini.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { subject } = req.body as { subject: string };

  if (!subject || typeof subject !== "string") {
    return res.status(400).json({ error: "subject is required" });
  }

  const systemPrompt = `You are an email deliverability and copywriting expert specializing in insurance industry recruitment emails. Score email subject lines on a scale of 1-10 and provide actionable feedback.

Scoring criteria:
- Clarity and relevance (2 pts)
- Engagement and curiosity (2 pts)
- Length (under 60 chars is better) (2 pts)
- Spam filter safety (no ALL CAPS, excessive punctuation, spam trigger words) (2 pts)
- CAN-SPAM compliance / no false promises (2 pts)

Respond with JSON only in this exact shape:
{
  "score": <number 1-10>,
  "feedback": "<one or two sentences explaining the score>",
  "suggestions": ["<alternative subject 1>", "<alternative subject 2>", "<alternative subject 3>"]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Score this subject line: "${subject}"` },
      ],
      temperature: 0.5,
      max_tokens: 400,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    return res.status(200).json({
      score: Number(parsed.score) || 5,
      feedback: String(parsed.feedback || ""),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [],
    });
  } catch (err: any) {
    console.error("[score-subject] OpenAI error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Scoring failed" });
  }
}
