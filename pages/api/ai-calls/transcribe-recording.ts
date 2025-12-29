// pages/api/ai-calls/transcribe-recording.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";

const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();

// OpenAI
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();

// Transcription + summary models (configurable, safe defaults)
const OPENAI_TRANSCRIBE_MODEL = (
  process.env.AI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe"
).trim();

const OPENAI_SUMMARY_MODEL = (
  process.env.AI_OVERVIEW_MODEL || "gpt-4o-mini"
).trim();

// Twilio (only used to AUTHENTICATE fetching the recording audio server-side)
const TWILIO_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || "").trim();

// Optional override if you ever need a different accountSid for recording fetch
const TWILIO_RECORDING_FETCH_ACCOUNT_SID = (
  process.env.TWILIO_RECORDING_FETCH_ACCOUNT_SID || ""
).trim();

type Body = {
  aiCallRecordingId?: string;
  callSid?: string;
};

type Resp =
  | {
      ok: true;
      recordingId: string;
      callSid: string;
      transcribedAt: string | null;
      transcriptChars: number;
      summaryChars: number;
      skipped?: boolean;
      reason?: string;
    }
  | { ok: false; message: string };

function isNonEmptyString(v: any) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeRecordingUrl(url: string): string {
  const u = url.trim();

  // If Twilio recording URL is provided without extension, .mp3 is typically supported.
  // (We keep this conservative and only append if there is no obvious extension.)
  const hasExt = /\.[a-z0-9]{2,5}(\?.*)?$/i.test(u);
  if (!hasExt) return `${u}.mp3`;

  return u;
}

function buildTwilioRecordingMp3Url(recordingSid: string): string | null {
  const acct =
    TWILIO_RECORDING_FETCH_ACCOUNT_SID || TWILIO_ACCOUNT_SID || "";
  if (!acct) return null;
  return `https://api.twilio.com/2010-04-01/Accounts/${acct}/Recordings/${recordingSid}.mp3`;
}

async function fetchRecordingAudio(args: {
  recordingUrl?: string | null;
  recordingSid?: string | null;
}): Promise<{ buffer: Buffer; contentType: string; sourceUrl: string }> {
  const candidates: string[] = [];

  if (isNonEmptyString(args.recordingUrl)) {
    candidates.push(normalizeRecordingUrl(String(args.recordingUrl)));
  }

  if (isNonEmptyString(args.recordingSid)) {
    const tw = buildTwilioRecordingMp3Url(String(args.recordingSid));
    if (tw) candidates.push(tw);
  }

  if (candidates.length === 0) {
    throw new Error("No recordingUrl or recordingSid available to fetch audio.");
  }

  // We only do basic auth if Twilio creds exist.
  const canBasicAuth = !!TWILIO_ACCOUNT_SID && !!TWILIO_AUTH_TOKEN;

  let lastErr: any = null;

  for (const url of candidates) {
    try {
      const headers: Record<string, string> = {};

      // Twilio API recording URLs typically require basic auth.
      if (canBasicAuth && url.includes("api.twilio.com")) {
        const basic = Buffer.from(
          `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
        ).toString("base64");
        headers["Authorization"] = `Basic ${basic}`;
      }

      const r = await fetch(url, { method: "GET", headers });

      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(
          `Failed to fetch recording audio (${r.status}) from ${url}. ${
            txt ? txt.slice(0, 200) : ""
          }`
        );
      }

      const ct = r.headers.get("content-type") || "audio/mpeg";
      const ab = await r.arrayBuffer();
      const buf = Buffer.from(ab);

      if (!buf || buf.length < 512) {
        throw new Error(
          `Recording audio too small from ${url} (${buf?.length || 0} bytes).`
        );
      }

      return { buffer: buf, contentType: ct, sourceUrl: url };
    } catch (e: any) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Failed to fetch recording audio from any candidate URL.");
}

async function transcribeWithOpenAI(args: {
  audio: Buffer;
  contentType: string;
}): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured.");
  }

  // Use undici-compatible FormData/Blob in Node runtime
  const fd = new FormData();

  // Use a stable filename extension for better server-side handling
  const filename = args.contentType.includes("wav")
    ? "recording.wav"
    : args.contentType.includes("mp4")
    ? "recording.mp4"
    : "recording.mp3";

  // ✅ TS FIX: Buffer<ArrayBufferLike> isn't assignable to BlobPart in Next/TS DOM typings.
  // Convert to a plain Uint8Array (valid BlobPart) without changing the bytes.
  const u8 = new Uint8Array(args.audio);

  const blob = new Blob([u8], { type: args.contentType });
  fd.append("file", blob, filename);
  fd.append("model", OPENAI_TRANSCRIBE_MODEL);

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: fd as any,
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(
      `OpenAI transcription failed (${resp.status}). ${txt ? txt.slice(0, 500) : ""}`
    );
  }

  const data: any = await resp.json().catch(() => null);
  const text = data?.text;

  if (!isNonEmptyString(text)) {
    throw new Error("OpenAI transcription returned empty text.");
  }

  return String(text).trim();
}

async function summarizeBullets(args: { transcriptText: string }): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured.");
  }

  const prompt = `You are writing a factual call summary for a CRM.

Rules:
- Output ONLY 3–6 bullet points.
- Each bullet must start with "- ".
- Keep bullets short and factual.
- No speculation.
- No salesy language.
- Do NOT mention “AI” or “model”.
- If the transcript is unclear, state that briefly in one bullet.

Transcript:
${args.transcriptText}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_SUMMARY_MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(
      `OpenAI summary generation failed (${resp.status}). ${txt ? txt.slice(0, 500) : ""}`
    );
  }

  const data: any = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;

  if (!isNonEmptyString(content)) {
    throw new Error("OpenAI summary generation returned empty content.");
  }

  // Normalize to "- " bullets; clamp to 6 lines max
  const lines = String(content)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (l.startsWith("- ")) return l;
      if (l.startsWith("• ")) return `- ${l.slice(2).trim()}`;
      if (l.startsWith("* ")) return `- ${l.slice(2).trim()}`;
      return `- ${l.replace(/^[-•*]\s*/, "").trim()}`;
    })
    .filter((l) => l.length > 2)
    .slice(0, 6);

  return lines.join("\n").trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  if (!AI_DIALER_CRON_KEY) {
    return res
      .status(500)
      .json({ ok: false, message: "AI_DIALER_CRON_KEY not configured" });
  }

  const hdr = (req.headers["x-cron-key"] || "") as string;
  if (!hdr || hdr !== AI_DIALER_CRON_KEY) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  try {
    const { aiCallRecordingId, callSid } = (req.body || {}) as Body;

    if (!isNonEmptyString(aiCallRecordingId) && !isNonEmptyString(callSid)) {
      return res.status(400).json({
        ok: false,
        message: "Provide aiCallRecordingId or callSid",
      });
    }

    await mongooseConnect();

    const rec = isNonEmptyString(aiCallRecordingId)
      ? await AICallRecording.findById(String(aiCallRecordingId)).exec()
      : await AICallRecording.findOne({ callSid: String(callSid) }).exec();

    if (!rec) {
      return res
        .status(404)
        .json({ ok: false, message: "AICallRecording not found" });
    }

    // Idempotency: if already transcribed, don’t redo unless you later add a force flag (not part of this task)
    const existingTranscript =
      typeof (rec as any).transcriptText === "string"
        ? String((rec as any).transcriptText)
        : "";
    const alreadyTranscribed =
      isNonEmptyString(existingTranscript) && !!(rec as any).transcribedAt;

    if (alreadyTranscribed) {
      return res.status(200).json({
        ok: true,
        recordingId: String(rec._id),
        callSid: String(rec.callSid || ""),
        transcribedAt: (rec as any).transcribedAt
          ? new Date((rec as any).transcribedAt).toISOString()
          : null,
        transcriptChars: existingTranscript.length,
        summaryChars: typeof rec.summary === "string" ? rec.summary.length : 0,
        skipped: true,
        reason: "already_transcribed",
      });
    }

    // Fetch audio server-side
    const audio = await fetchRecordingAudio({
      recordingUrl: (rec as any).recordingUrl,
      recordingSid: (rec as any).recordingSid,
    });

    // Transcribe
    const transcriptText = await transcribeWithOpenAI({
      audio: audio.buffer,
      contentType: audio.contentType,
    });

    // Summarize into bullets
    const bulletSummary = await summarizeBullets({ transcriptText });

    // Save (do NOT overwrite existing summary if already present from outcome flow)
    (rec as any).transcriptText = transcriptText;
    (rec as any).transcribedAt = new Date();

    if (!isNonEmptyString(rec.summary) && isNonEmptyString(bulletSummary)) {
      rec.summary = bulletSummary;
    }

    (rec as any).updatedAt = new Date();
    await rec.save();

    return res.status(200).json({
      ok: true,
      recordingId: String(rec._id),
      callSid: String(rec.callSid || ""),
      transcribedAt: (rec as any).transcribedAt
        ? new Date((rec as any).transcribedAt).toISOString()
        : null,
      transcriptChars: transcriptText.length,
      summaryChars: typeof rec.summary === "string" ? rec.summary.length : 0,
    });
  } catch (err: any) {
    console.error("[ai-calls/transcribe-recording] error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "Failed to transcribe recording",
    });
  }
}
