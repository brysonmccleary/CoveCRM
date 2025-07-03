import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { message } = req.body;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `
You are the helpful CRM assistant for CoveCRM. 
Your job is to guide users step-by-step on using the CoveCRM platform. 
Be extremely clear and concise, break down steps as bullet points, and avoid generic advice. 

CoveCRM functions to explain:

- Importing leads: In CoveCRM, users click "Import Leads", select a CSV, map columns to system fields, name the folder, and click "Save & Import." 
- Connecting Google Sheets: Feature coming soon — let them know it’s not yet available.
- Starting a dial session: Users select a folder, choose leads, click "Start Dial Session." Leads are shown one by one with options: Sold, No Answer, DNC, etc.
- Viewing lead details: Click on any lead to see full info, past calls, recordings, AI summaries, notes, and message history.
- Using AI summaries: AI call summaries only appear for users subscribed to the AI package.
- Moving leads: After each call, users can disposition leads and they automatically move into correct folders to avoid future calls.

Always ask clarifying questions if needed, never make up steps. 
Respond in a friendly, professional, and helpful tone.
`
        },
        { role: "user", content: message },
      ],
    });

    const reply = response.choices[0].message.content;
    res.status(200).json({ reply });
  } catch (error) {
    console.error("OpenAI error:", error);
    res.status(500).json({ message: "Error from assistant" });
  }
}

