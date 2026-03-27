// lib/ai/generateCallCoachReport.ts
// Generates an AI-powered call coaching report for a completed call.
import { OpenAI } from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import CallCoachReport from "@/models/CallCoachReport";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are an expert insurance sales coach with 20+ years of experience training top-producing life insurance telesales agents. You analyze call transcripts and provide structured, actionable coaching feedback.

You score calls across 6 dimensions (each 1-10):
- Opening: quality of introduction, permission to continue, building instant rapport
- Rapport: tone, empathy, personalization, connecting with the prospect
- Discovery: asking good questions to uncover needs, budget, health situation, urgency
- Presentation: tailoring the product pitch to what was discovered, benefit-focused
- Objection Handling: rebuttal quality, staying calm, using feel/felt/found and other proven techniques
- Closing: asking for the appointment/business, overcoming hesitation, creating urgency

Return a single JSON object with NO markdown or code fences. Fields:
{
  "callScore": number (1-10, weighted average of breakdown),
  "scoreBreakdown": {
    "opening": number,
    "rapport": number,
    "discovery": number,
    "presentation": number,
    "objectionHandling": number,
    "closing": number
  },
  "whatWentWell": [string, string, ...],  (3-5 specific positive observations)
  "whatToImprove": [string, string, ...],  (3-5 specific, actionable improvements)
  "objectionsEncountered": [
    {
      "objection": string,      (exact objection or paraphrase)
      "howHandled": string,     (what the agent actually said/did)
      "betterResponse": string, (ideal rebuttal using insurance sales best practices)
      "wasOvercome": boolean
    }
  ],
  "nextStepRecommendation": string,  (1-2 sentences on the single most important thing to do next)
  "callSummary": string               (2-3 sentence plain-English summary of the call outcome)
}

Be specific and direct. Reference actual moments from the transcript when possible. If there is no transcript or it is too short, score conservatively (5s) and note limited data in your feedback.`;

export async function generateCallCoachReport(
  callId: string,
  userEmail: string,
  leadName?: string
): Promise<{ ok: boolean; report?: any; error?: string }> {
  await mongooseConnect();

  // Don't regenerate if already exists
  const existing = await CallCoachReport.findOne({ callId, userEmail }).lean();
  if (existing) return { ok: true, report: existing };

  const call = await (Call as any).findOne({ _id: callId, userEmail }).lean();
  if (!call) return { ok: false, error: "Call not found" };

  const transcript = (call as any).transcript || "";
  const durationSeconds =
    (call as any).duration || (call as any).durationSec || 0;

  const userContent = `
Call Duration: ${durationSeconds} seconds
Lead Name: ${leadName || "Unknown"}
Call Outcome (from AI Overview): ${(call as any).aiOverview?.outcome || "Unknown"}

Transcript:
${transcript || "(No transcript available — score conservatively)"}
`.trim();

  let parsed: any;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 1800,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    parsed = JSON.parse(raw);
  } catch (err: any) {
    console.error("[generateCallCoachReport] OpenAI error:", err?.message);
    return { ok: false, error: "AI generation failed" };
  }

  // Clamp scores to 1-10
  function clamp(n: any): number {
    const v = Number(n);
    if (isNaN(v)) return 5;
    return Math.min(10, Math.max(1, Math.round(v)));
  }

  const scoreBreakdown = {
    opening: clamp(parsed.scoreBreakdown?.opening),
    rapport: clamp(parsed.scoreBreakdown?.rapport),
    discovery: clamp(parsed.scoreBreakdown?.discovery),
    presentation: clamp(parsed.scoreBreakdown?.presentation),
    objectionHandling: clamp(parsed.scoreBreakdown?.objectionHandling),
    closing: clamp(parsed.scoreBreakdown?.closing),
  };
  const callScore = clamp(parsed.callScore);

  try {
    const report = await CallCoachReport.create({
      callId,
      callSid: (call as any).callSid,
      userId: (call as any).userId,
      userEmail,
      leadId: (call as any).leadId,
      leadName: leadName || "",
      callScore,
      scoreBreakdown,
      whatWentWell: Array.isArray(parsed.whatWentWell) ? parsed.whatWentWell : [],
      whatToImprove: Array.isArray(parsed.whatToImprove) ? parsed.whatToImprove : [],
      objectionsEncountered: Array.isArray(parsed.objectionsEncountered)
        ? parsed.objectionsEncountered.map((o: any) => ({
            objection: String(o.objection || ""),
            howHandled: String(o.howHandled || ""),
            betterResponse: String(o.betterResponse || ""),
            wasOvercome: Boolean(o.wasOvercome),
          }))
        : [],
      nextStepRecommendation: String(parsed.nextStepRecommendation || ""),
      callSummary: String(parsed.callSummary || ""),
      transcript,
      durationSeconds,
      generatedAt: new Date(),
    });

    return { ok: true, report };
  } catch (dbErr: any) {
    // E11000 = already exists (race condition), re-fetch
    if (dbErr?.code === 11000) {
      const existing2 = await CallCoachReport.findOne({ callId, userEmail }).lean();
      return { ok: true, report: existing2 };
    }
    console.error("[generateCallCoachReport] DB error:", dbErr?.message);
    return { ok: false, error: "Failed to save report" };
  }
}
