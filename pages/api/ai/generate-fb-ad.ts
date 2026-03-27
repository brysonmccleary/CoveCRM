// pages/api/ai/generate-fb-ad.ts
// POST — generate Facebook ad copy for an insurance agent
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CPL_RANGES: Record<string, string> = {
  final_expense: "$8–$15",
  iul: "$15–$30",
  mortgage_protection: "$10–$20",
  veteran: "$10–$18",
  trucker: "$12–$22",
};

const LEAD_TYPE_LABELS: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "Indexed Universal Life (IUL)",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran Life Insurance",
  trucker: "Trucker / CDL Life Insurance",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { leadType, agentName, agentState, tone = "empathetic", targetAge = "50-70" } =
    req.body as {
      leadType: string;
      agentName: string;
      agentState: string;
      tone?: string;
      targetAge?: string;
    };

  if (!leadType || !agentName || !agentState) {
    return res.status(400).json({ error: "leadType, agentName, and agentState are required" });
  }

  const leadLabel = LEAD_TYPE_LABELS[leadType] ?? leadType;
  const cplRange = CPL_RANGES[leadType] ?? "$10–$20";

  const prompt = `Generate Facebook ad copy for an insurance agent selling ${leadLabel} in ${agentState}.
Agent name: ${agentName}
Tone: ${tone}
Target age: ${targetAge}

Return exactly this JSON structure:
{
  "headlines": ["headline1", "headline2", "headline3"],
  "primaryTexts": ["text1", "text2", "text3"],
  "cta": "CTA button text",
  "targeting": {
    "ageRange": "e.g. 50-70",
    "interests": ["interest1", "interest2", "interest3"],
    "behaviors": ["behavior1", "behavior2"],
    "incomeLevel": "description",
    "locations": "recommendation"
  },
  "estimatedCpl": "${cplRange}"
}

Rules:
- Each headline must be under 40 characters
- Each primary text must be under 125 characters
- No income guarantees or claims of specific returns
- Focus on the prospect's fear/pain (unexpected costs, leaving family without protection)
- Must comply with Facebook ad policies
- CTA must be one of: Learn More, Get Quote, Apply Now, Get Started, Sign Up`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert Facebook advertising copywriter specializing in insurance lead generation. Generate compliant, high-converting Facebook ad copy for insurance agents. Never make income guarantees. Follow Facebook ad policies. Focus on the prospect's pain points and how insurance solves them.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const result = JSON.parse(raw);

    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[generate-fb-ad] OpenAI error:", err?.message);
    return res.status(500).json({ error: "AI generation failed" });
  }
}
