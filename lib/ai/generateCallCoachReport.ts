// lib/ai/generateCallCoachReport.ts
// Generates an AI-powered call coaching report for a completed call.
import { OpenAI } from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import CallCoachReport from "@/models/CallCoachReport";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are an experienced insurance sales manager and coach with 20+ years training top producers. You use the sandwich coaching method: start with genuine strengths, address specific improvements, end with encouragement. You are specific, direct, and reference exact moments from the transcript. You understand insurance-specific concepts like equity protection, critical period, cash value, IUL, final expense, mortgage protection, and term life. You know common objections and how to handle them. You never give generic advice — every piece of feedback references something that actually happened on the call. Always respond with valid JSON only.`;

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

  const userContent = `Analyze this insurance sales call and provide a detailed coaching report using the sandwich method.

Agent name: ${userEmail}
Lead name: ${leadName || "Unknown"}
Call duration: ${durationSeconds} seconds
Transcript:
${transcript || "(No transcript available — score conservatively)"}

IMPORTANT: Be specific. Reference exact quotes or moments from the transcript. If the call was short or unclear, acknowledge that honestly.

Return this exact JSON structure:
{
  "callScore": <number 1-10>,
  "scoreBreakdown": {
    "opening": <number>,
    "rapport": <number>,
    "discovery": <number>,
    "presentation": <number>,
    "objectionHandling": <number>,
    "closing": <number>
  },
  "sandwichFeedback": {
    "topBread": [<2-3 specific things they did WELL — reference exact moments>],
    "filling": [<2-4 specific improvements — be direct and reference exact moments with better alternatives>],
    "bottomBread": [<1-2 encouraging closing points — specific to this call>]
  },
  "objectionsEncountered": [
    {
      "objection": <exact objection they raised>,
      "howHandled": <what the agent actually said or did>,
      "betterResponse": <ideal response — be specific, give exact words to use>,
      "wasOvercome": <boolean>,
      "conceptConfusion": <if agent used jargon the lead may not have understood, explain it — or null>
    }
  ],
  "nextStepRecommendation": <exact words to say on the next call — specific and actionable>,
  "managerSuggestion": <if there is a specific skill gap, suggest a role-play exercise or null>,
  "callSummary": <2-3 sentences of what happened on this call>
}`;

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

  // Build sandwich feedback — may come in sandwichFeedback or fall back to whatWentWell/whatToImprove
  const sf = parsed.sandwichFeedback;
  const sandwichFeedback = sf
    ? {
        topBread: Array.isArray(sf.topBread) ? sf.topBread.map(String) : [],
        filling: Array.isArray(sf.filling) ? sf.filling.map(String) : [],
        bottomBread: Array.isArray(sf.bottomBread) ? sf.bottomBread.map(String) : [],
      }
    : undefined;

  // Backward-compat: also store whatWentWell/whatToImprove
  const whatWentWell = sandwichFeedback?.topBread || (Array.isArray(parsed.whatWentWell) ? parsed.whatWentWell : []);
  const whatToImprove = sandwichFeedback?.filling || (Array.isArray(parsed.whatToImprove) ? parsed.whatToImprove : []);

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
      whatWentWell,
      whatToImprove,
      sandwichFeedback,
      managerSuggestion: parsed.managerSuggestion || null,
      objectionsEncountered: Array.isArray(parsed.objectionsEncountered)
        ? parsed.objectionsEncountered.map((o: any) => ({
            objection: String(o.objection || ""),
            howHandled: String(o.howHandled || ""),
            betterResponse: String(o.betterResponse || ""),
            wasOvercome: Boolean(o.wasOvercome),
            conceptConfusion: o.conceptConfusion ? String(o.conceptConfusion) : null,
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
