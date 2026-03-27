// pages/api/ai/generate-email.ts
// Generates an email subject + body for a given campaign step using gpt-4o-mini.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const {
    prompt,
    stepNumber,
    campaignName,
    licenseType,
    state,
    tone = "professional",
  } = req.body as {
    prompt: string;
    stepNumber: number;
    campaignName: string;
    licenseType?: string;
    state?: string;
    tone?: "professional" | "casual" | "urgent";
  };

  if (!prompt || !campaignName) {
    return res.status(400).json({ error: "prompt and campaignName are required" });
  }

  const toneMap = {
    professional: "professional and polished",
    casual: "friendly and conversational",
    urgent: "direct and action-oriented with mild urgency",
  };

  const toneDesc = toneMap[tone] || toneMap.professional;

  const systemPrompt = `You are an expert insurance industry email copywriter. You write CAN-SPAM compliant recruitment emails for insurance agencies targeting licensed life and health insurance agents.

Rules:
- Subject lines must be under 60 characters
- Never make false income claims or guarantees
- Include a clear, specific call to action
- Write in a ${toneDesc} tone
- Emails should be concise (150-250 words for the body)
- Return valid HTML for the body (use <p>, <strong>, <br> tags — no inline styles)
- Every email you generate MUST end with the placeholder text [FOOTER] on its own line at the very end of the html. This will be automatically replaced with the required CAN-SPAM footer including unsubscribe link and physical address. Never omit this placeholder.

Respond with JSON only in this exact shape:
{
  "subject": "...",
  "html": "...",
  "text": "..."
}`;

  const userPrompt = `Campaign: "${campaignName}"
Step number: ${stepNumber}${licenseType ? `\nLicense type: ${licenseType}` : ""}${state ? `\nTarget state: ${state}` : ""}

Additional instructions: ${prompt}

Write step ${stepNumber} of the email sequence.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 900,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    if (!parsed.subject || !parsed.html) {
      return res.status(500).json({ error: "AI returned incomplete response" });
    }

    return res.status(200).json({
      subject: String(parsed.subject).slice(0, 60),
      html: String(parsed.html),
      text: String(parsed.text || ""),
    });
  } catch (err: any) {
    console.error("[generate-email] OpenAI error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Generation failed" });
  }
}
