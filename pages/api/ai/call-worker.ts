// /pages/api/ai/call-worker.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import { getUserByEmail } from "@/models/User";
import axios from "axios";
import FormData from "form-data";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const WORKER_SECRET = process.env.AI_WORKER_SECRET || "";

// Optional env to override default models without code change
const OPENAI_TRANSCRIBE_MODEL =
  process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const OPENAI_SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini";

type Sentiment = "positive" | "neutral" | "negative";

function okJson(res: NextApiResponse, body: any, code = 200) {
  res.status(code).json({ ok: true, ...body });
}
function errJson(res: NextApiResponse, message: string, code = 400) {
  res.status(code).json({ ok: false, error: message });
}

function parseStrictJSON(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    // attempt to find a JSON object within content (defensive)
    const start = input.indexOf("{");
    const end = input.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(input.slice(start, end + 1));
      } catch {}
    }
    return {};
  }
}

async function transcribeMp3Buffer(buf: Buffer): Promise<string> {
  const fd = new FormData();
  fd.append("file", buf, { filename: "audio.mp3", contentType: "audio/mpeg" });
  fd.append("model", OPENAI_TRANSCRIBE_MODEL);

  const resp = await axios.post(
    "https://api.openai.com/v1/audio/transcriptions",
    fd,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...fd.getHeaders(),
      },
      maxBodyLength: Infinity,
    },
  );
  return String(resp.data?.text ?? "").trim();
}

async function summarizeTranscript(transcript: string): Promise<{
  summary: string;
  actionItems: string[];
  sentiment: Sentiment;
}> {
  const sys =
    "You are an expert sales call analyst. Return concise JSON with keys: summary, actionItems (array), sentiment (positive|neutral|negative). Keep it factual and brief.";
  const user = `Transcript:\n${transcript}\n\nRespond ONLY as JSON.`;

  const resp = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: OPENAI_SUMMARY_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: 120000 },
  );

  const raw = String(resp.data?.choices?.[0]?.message?.content || "{}");
  const parsed = parseStrictJSON(raw);

  const summary = String(parsed.summary || "").trim();
  let actionItems: string[] = [];

  if (Array.isArray(parsed.actionItems)) {
    actionItems = parsed.actionItems
      .map((s: any) => String(s).trim())
      .filter(Boolean);
  } else if (typeof parsed.actionItems === "string") {
    // tolerate newline/bullet-delimited strings
    actionItems = parsed.actionItems
      .split(/\r?\n|•|-/g)
      .map((s: string) => s.trim())
      .filter(Boolean);
  }

  const sentiment: Sentiment = (
    ["positive", "neutral", "negative"].includes(parsed.sentiment)
      ? parsed.sentiment
      : "neutral"
  ) as Sentiment;

  return { summary, actionItems, sentiment };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return errJson(res, "Method not allowed", 405);

  // Worker auth
  if ((req.headers["x-worker-secret"] as string) !== WORKER_SECRET) {
    return errJson(res, "Unauthorized", 401);
  }

  const { callSid, force } = (req.body || {}) as {
    callSid?: string;
    force?: boolean;
  };
  if (!callSid) return errJson(res, "Missing callSid", 400);

  try {
    await dbConnect();

    const call = await Call.findOne({ callSid });
    if (!call) return errJson(res, "Call not found", 404);

    // Entitlement check (align with your earlier gates: aiEnabled or plan.ai === true)
    const user = await getUserByEmail(call.userEmail);
    const aiEnabled = !!(
      user &&
      ((user as any).aiEnabled === true || (user as any)?.plan?.ai === true)
    );
    call.aiEnabledAtCallTime = aiEnabled;

    if (!aiEnabled) {
      await call.save();
      return okJson(res, { skipped: "no-entitlement" });
    }

    // Idempotency:
    // - If already processed and not forcing, skip.
    if (
      !force &&
      call.aiProcessing === "done" &&
      call.aiSummary &&
      call.transcript
    ) {
      return okJson(res, { skipped: "already-processed" });
    }

    // If another worker set pending within last few minutes, skip to avoid double work
    if (!force && call.aiProcessing === "pending") {
      const pendingAgeMs =
        Date.now() - new Date(call.updatedAt as any).getTime();
      if (pendingAgeMs < 5 * 60 * 1000) {
        return okJson(res, { skipped: "already-pending" });
      }
    }

    if (!call.recordingUrl || !call.recordingSid) {
      // Mark error but do not fail the webhook pipeline
      call.aiProcessing = "error";
      await call.save();
      return errJson(res, "No recording on call", 400);
    }

    // Lock for processing
    call.aiProcessing = "pending";
    await call.save();

    // Fetch audio from Twilio with basic auth
    const audioResp = await axios.get(call.recordingUrl, {
      responseType: "arraybuffer",
      auth: {
        username: TWILIO_ACCOUNT_SID,
        password: TWILIO_AUTH_TOKEN,
      },
      timeout: 120000,
    });
    const audioBuf = Buffer.from(audioResp.data);

    // Transcribe
    const transcript = await transcribeMp3Buffer(audioBuf);
    if (!transcript) {
      call.aiProcessing = "error";
      await call.save();
      return errJson(res, "Empty transcript", 500);
    }

    // Summarize
    const { summary, actionItems, sentiment } =
      await summarizeTranscript(transcript);

    // Save (don’t clobber if something already present and not forcing)
    call.transcript = force || !call.transcript ? transcript : call.transcript;
    call.aiSummary = force || !call.aiSummary ? summary : call.aiSummary;
    call.aiActionItems =
      force || !(call.aiActionItems && call.aiActionItems.length)
        ? actionItems
        : call.aiActionItems;
    call.aiSentiment = (sentiment as any) || call.aiSentiment;
    call.aiProcessing = "done";
    await call.save();

    return okJson(res, { processed: true });
  } catch (err) {
    console.error("AI worker error:", err);
    try {
      await dbConnect();
      await Call.updateOne({ callSid }, { $set: { aiProcessing: "error" } });
    } catch {}
    return errJson(res, "Worker failure", 500);
  }
}
