// lib/ai/generateCallCoachReport.ts
// Generates an AI-powered call coaching report for a completed call.
import { OpenAI } from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import CallCoachReport from "@/models/CallCoachReport";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are an elite insurance sales call coach reviewing real agent calls.

Your job is to help agents improve for the next call, not to flatter them and not to tear them down.

Coaching style:
- Be honest, specific, and useful.
- Do not be overly harsh or insulting.
- Do not sugarcoat obvious mistakes.
- If the agent missed the close, say so clearly.
- If they got stuck on an objection, identify the exact objection and explain where momentum was lost.
- If they failed to control the call, ask enough discovery questions, explain value clearly, or ask for the appointment, say that directly.
- Praise only things they actually did well in the transcript.
- Never give generic feedback. Every point must connect to something that actually happened on the call.
- Prefer concrete language the agent can actually use on the next call.

You understand insurance-specific conversations including final expense, mortgage protection, veteran leads, IUL, coverage amount, premiums, spouse objections, existing coverage objections, thinking-it-over objections, timing objections, and budget objections.

You must specifically evaluate:
- opening / introduction
- rapport
- discovery
- pitch clarity
- objection handling
- closing / asking for the appointment

When objections appear, identify:
- the exact objection
- how the agent handled it
- whether the agent actually overcame it
- what the better response should have been

If the agent lost the call because they were vague, passive, too wordy, failed to redirect, failed to isolate the objection, or failed to ask for the appointment, say that plainly.

Always respond with valid JSON only.`;

export async function generateCallCoachReport(
  callId: string,
  userEmail: string,
  leadName?: string
): Promise<{ ok: boolean; report?: any; error?: string; skipped?: boolean; reason?: string }> {
  await mongooseConnect();

  // Don't regenerate if already exists
  const existing = await CallCoachReport.findOne({ callId, userEmail }).lean();
  if (existing) return { ok: true, report: existing };

  const call = await (Call as any).findOne({ _id: callId, userEmail }).lean();
  if (!call) return { ok: false, error: "Call not found" };

  const transcript = String((call as any).transcript || "").trim();
  const durationSeconds =
    Number((call as any).duration || (call as any).durationSec || 0) || 0;

  const sourceBits = [
    (call as any)?.source,
    (call as any)?.callSource,
    (call as any)?.origin,
    (call as any)?.mode,
    (call as any)?.dialerType,
  ]
    .map((v: any) => String(v || "").toLowerCase().trim())
    .filter(Boolean);

  const likelyAIDialer =
    (call as any)?.isAIDialer === true ||
    Boolean((call as any)?.aiDialerSessionId) ||
    Boolean((call as any)?.aiCallSessionId) ||
    sourceBits.some((v: string) => ["ai_dialer", "ai-dialer", "ai dialer"].includes(v));

  if (likelyAIDialer) {
    return { ok: true, skipped: true, reason: "ai_dialer_call" };
  }

  if (durationSeconds < 60) {
    return { ok: true, skipped: true, reason: "duration_under_60_seconds" };
  }

  if (!transcript || transcript.length < 40) {
    return { ok: true, skipped: true, reason: "missing_or_short_transcript" };
  }

  const userContent = `Analyze this insurance sales call and provide a detailed coaching report.

Agent name: ${userEmail}
Lead name: ${leadName || "Unknown"}
Call duration: ${durationSeconds} seconds
Transcript:
${transcript}

Important coaching instructions:
- Be honest and specific.
- Do not be fake-positive.
- Do not be overly harsh.
- Identify exactly where the call slowed down or lost momentum.
- Identify the real objection(s), not generic categories.
- Be very clear about whether the agent actually asked for the appointment.
- If the agent never clearly closed, say that directly.
- If they talked too much, were vague, failed to isolate the objection, or failed to control the call, say that directly.
- Quote or closely reference actual moments from the transcript.
- Give corrections the agent can actually use on the next call.

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
    "topBread": [<1-3 specific things they actually did well>],
    "filling": [<2-5 specific improvements, including where they got held up and what they should have done instead>],
    "bottomBread": [<1-2 encouraging but honest closing points>]
  },
  "objectionsEncountered": [
    {
      "objection": <exact objection or hesitation from the lead>,
      "howHandled": <what the agent actually said or did>,
      "betterResponse": <better response with specific wording the agent could use next time>,
      "wasOvercome": <boolean>,
      "conceptConfusion": <any confusing wording / jargon used by the agent, or null>
    }
  ],
  "nextStepRecommendation": <the most important thing the agent should do differently on the next similar call>,
  "managerSuggestion": <short role-play or drill suggestion if needed, otherwise null>,
  "callSummary": <2-3 honest sentences summarizing what happened and where the call was won or lost>
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
