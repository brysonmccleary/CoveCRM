import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import User from "@/models/User";

export const config = { api: { bodyParser: false } };

const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const ALLOW_DEV_TWILIO_TEST = process.env.ALLOW_LOCAL_TWILIO_TEST === "1" && process.env.NODE_ENV !== "production";

const CALL_AI_SUMMARY_ENABLED = (process.env.CALL_AI_SUMMARY_ENABLED || "").toString() === "1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Lazy import so build won’t fail if OPENAI_API_KEY isn’t set
async function summarizeIfEnabled(callDoc: any, recordingMp3Url: string) {
  try {
    if (!CALL_AI_SUMMARY_ENABLED) return;
    if (!OPENAI_API_KEY) return;

    const user = await User.findOne({ email: callDoc.userEmail });
    if (!user?.hasAI) return;

    // Download audio with Twilio Basic auth
    const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
    const resp = await fetch(recordingMp3Url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) throw new Error(`fetch mp3 failed ${resp.status}`);
    const blob = await resp.blob();

    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // 1) Transcribe (Whisper)
    const file = new File([blob], "call.mp3", { type: "audio/mpeg" });
    const tr = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      response_format: "text",
      temperature: 0,
    });
    const transcript = (tr as any) as string;

    // 2) Summarize to bullets + action items
    const sys = `You are an SDR assistant. Summarize phone calls briefly.
Return JSON with keys:
- "summary": short paragraph,
- "bullets": 3-7 concise bullet points,
- "actionItems": optional next steps (array of strings),
- "score": integer 0-100 for quality of the outcome,
- "sentiment": "positive" | "neutral" | "negative".`;
    const usr = `Transcript:\n"""${transcript}"""`;

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
    });

    const parsed = JSON.parse(chat.choices[0].message.content || "{}");
    await Call.updateOne(
      { _id: callDoc._id },
      {
        $set: {
          transcript,
          aiSummary: parsed.summary || "",
          aiBullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
          aiActionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
          aiScore: typeof parsed.score === "number" ? parsed.score : undefined,
          aiSentiment: parsed.sentiment || "neutral",
          aiProcessing: "done",
        },
      },
    );

    // Live update for UI
    try {
      const io = (global as any)?.socketServer?.io || (global as any)?.__io || (global as any)?.io || (global as any);
      const resAny = ({} as any);
      const ioFromApi = (resAny?.socket as any)?.server?.io; // best-effort if available in this runtime
      const target = ioFromApi || io;
      if (target) target.to(callDoc.userEmail).emit("call:updated", { id: String(callDoc._id), callSid: callDoc.callSid });
    } catch {}
  } catch (e) {
    await Call.updateOne(
      { _id: callDoc._id },
      { $set: { aiProcessing: "error" } },
    );
    console.warn("AI summary failed:", (e as any)?.message || e);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.status(405).end("Method Not Allowed"); return; }

  const raw = await buffer(req);
  const bodyStr = raw.toString("utf8");
  const params = new URLSearchParams(bodyStr);
  const signature = (req.headers["x-twilio-signature"] || "") as string;
  const requestUrl = `${BASE_URL}/api/voice/recording-webhook`;

  const valid = twilio.validateRequest(AUTH_TOKEN, signature, requestUrl, Object.fromEntries(params as any));
  if (!valid && !ALLOW_DEV_TWILIO_TEST) {
    console.warn("❌ Invalid Twilio signature on recording-webhook");
    res.status(403).end("Invalid signature");
    return;
  }
  if (!valid && ALLOW_DEV_TWILIO_TEST) {
    console.warn("⚠️ Dev bypass: Twilio signature validation skipped (recording-webhook).");
  }

  try {
    await dbConnect();

    const RecordingSid = params.get("RecordingSid") || "";
    const RecordingUrlBare = params.get("RecordingUrl") || ""; // no extension
    const RecordingStatus = (params.get("RecordingStatus") || "").toLowerCase(); // completed | failed | absent
    const RecordingDuration = params.get("RecordingDuration") || ""; // seconds (string)
    const CallSid = params.get("CallSid") || "";
    const ConferenceSid = params.get("ConferenceSid") || "";
    const ConferenceName = params.get("ConferenceName") || "";

    // Twilio mp3 URL
    const recordingMp3Url = RecordingUrlBare ? `${RecordingUrlBare}.mp3` : "";

    // Find the Call doc
    const callDoc =
      (await Call.findOne({ callSid })) ||
      (await Call.findOne({ conferenceName: ConferenceName })) ||
      (await Call.findOne({ recordingSid: RecordingSid })) ||
      null;

    if (!callDoc) {
      // If we can't find it, write a minimal doc so UI still works
      await Call.updateOne(
        { callSid: CallSid || `unknown-${RecordingSid}` },
        {
          $setOnInsert: {
            callSid: CallSid || `unknown-${RecordingSid}`,
            userEmail: "", // unknown
            direction: "outbound",
            startedAt: new Date(),
          },
          $set: {
            conferenceName: ConferenceName || undefined,
            recordingSid: RecordingSid || undefined,
            recordingUrl: recordingMp3Url || undefined,
            recordingDuration: RecordingDuration ? Number(RecordingDuration) : undefined,
            recordingStatus: RecordingStatus || undefined,
            completedAt: new Date(),
          },
        },
        { upsert: true },
      );
      res.status(200).end();
      return;
    }

    await Call.updateOne(
      { _id: callDoc._id },
      {
        $set: {
          recordingSid: RecordingSid || callDoc.recordingSid,
          recordingUrl: recordingMp3Url || callDoc.recordingUrl,
          recordingDuration: RecordingDuration ? Number(RecordingDuration) : callDoc.recordingDuration,
          recordingStatus: RecordingStatus || callDoc.recordingStatus,
          completedAt: callDoc.completedAt || new Date(),
        },
        $setOnInsert: { startedAt: new Date() },
      },
    );

    // Live update for UI immediately
    try {
      const io = (res.socket as any)?.server?.io;
      if (io && callDoc.userEmail) {
        io.to(callDoc.userEmail).emit("call:updated", { id: String(callDoc._id), callSid: callDoc.callSid });
      }
    } catch {}

    // AI (optional) — run after storing so the recording appears right away
    await summarizeIfEnabled(callDoc, recordingMp3Url);

    res.status(200).end();
  } catch (err) {
    console.error("❌ recording-webhook error:", err);
    res.status(200).end(); // Always 200 to Twilio
  }
}
