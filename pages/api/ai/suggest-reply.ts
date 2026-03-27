// pages/api/ai/suggest-reply.ts
// Suggests reply options for an email thread using gpt-4o-mini.
// Suggestions only — never auto-sends anything.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ThreadMessage {
  role: "agent" | "lead";
  content: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { thread, channel = "email", leadName } = req.body as {
    thread: ThreadMessage[];
    channel?: string;
    leadName?: string;
  };

  if (!Array.isArray(thread) || thread.length === 0) {
    return res.status(400).json({ error: "thread is required and must be a non-empty array" });
  }

  const threadText = thread
    .slice(-6) // only last 6 messages for context window efficiency
    .map((m) => `${m.role === "agent" ? "Agent" : leadName || "Lead"}: ${m.content}`)
    .join("\n");

  const systemPrompt = `You are an insurance agency recruitment assistant. An agent needs help responding to a ${channel} conversation with a prospective recruit${leadName ? ` named ${leadName}` : ""}.

Write 3 reply suggestions in different tones. Each should be a complete, ready-to-send reply. Keep replies concise (2-4 sentences max).

Respond with JSON only in this exact shape:
{
  "replies": [
    { "tone": "professional", "content": "..." },
    { "tone": "friendly", "content": "..." },
    { "tone": "direct", "content": "..." }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Here is the conversation so far:\n\n${threadText}\n\nSuggest 3 replies for the agent.`,
        },
      ],
      temperature: 0.75,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    const replies = Array.isArray(parsed.replies) ? parsed.replies.slice(0, 3) : [];

    return res.status(200).json({ replies });
  } catch (err: any) {
    console.error("[suggest-reply] OpenAI error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Suggestion failed" });
  }
}
