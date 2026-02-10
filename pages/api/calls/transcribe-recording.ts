// pages/api/calls/transcribe-recording.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import UserModel from "@/models/User";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { getUserByEmail } from "@/models/User";

const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();

// OpenAI
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_TRANSCRIBE_MODEL = (
  process.env.AI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe"
).trim();
const OPENAI_OVERVIEW_MODEL = (
  process.env.AI_OVERVIEW_MODEL || "gpt-4o-mini"
).trim();

// Platform Twilio (fallback for fetching Twilio-protected recordings)
const PLATFORM_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || "").trim();
const PLATFORM_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || "").trim();

type Body = {
  callId?: string;
  callSid?: string;
};

type Resp =
  | {
      ok: true;
      callId: string;
      callSid: string;
      transcribedAt: string;
      transcriptChars: number;
      overviewReady: boolean;
      skipped?: boolean;
      reason?: string;
    }
  | { ok: false; message: string };

function isNonEmptyString(v: any) {
  return typeof v === "string" && v.trim().length > 0;
}

function asLowerEmail(v: any): string | null {
  if (!isNonEmptyString(v)) return null;
  return String(v).toLowerCase().trim();
}

function normalizeRecordingUrl(url: string): string {
  const u = url.trim();
  const hasExt = /\.[a-z0-9]{2,5}(\?.*)?$/i.test(u);
  if (!hasExt) return `${u}.mp3`;
  return u;
}

function btoaBasic(user: string, pass: string) {
  return Buffer.from(`${user}:${pass}`).toString("base64");
}

async function fetchRecordingAudio(args: {
  recordingUrl?: string | null;
  recordingSid?: string | null;
  userEmail?: string | null;
}): Promise<{ buffer: Buffer; contentType: string; sourceUrl: string }> {
  const candidates: string[] = [];

  if (isNonEmptyString(args.recordingUrl)) {
    candidates.push(normalizeRecordingUrl(String(args.recordingUrl)));
  }

  // If we ever only have RecordingSid (no URL), we can build Twilio URL
  // but your Call model already stores recordingUrl in normal flows.
  if (candidates.length === 0 && isNonEmptyString(args.recordingSid)) {
    if (PLATFORM_ACCOUNT_SID) {
      candidates.push(
        `https://api.twilio.com/2010-04-01/Accounts/${PLATFORM_ACCOUNT_SID}/Recordings/${String(
          args.recordingSid
        )}.mp3`
      );
    }
  }

  if (candidates.length === 0) {
    throw new Error("No recordingUrl/recordingSid available on Call.");
  }

  // Determine auth candidates (platform first, then per-user if present)
  const authCandidates: { accountSid: string; authToken: string; label: string }[] =
    [];

  if (PLATFORM_ACCOUNT_SID && PLATFORM_AUTH_TOKEN) {
    authCandidates.push({
      accountSid: PLATFORM_ACCOUNT_SID,
      authToken: PLATFORM_AUTH_TOKEN,
      label: "platform",
    });
  }

  const userEmail = asLowerEmail(args.userEmail);
  if (userEmail) {
    try {
      const userDoc: any = await (UserModel as any).findOne({ email: userEmail }).lean();
      const acct = (userDoc as any)?.twilio?.accountSid;
      const tok = (userDoc as any)?.twilio?.authToken;
      if (isNonEmptyString(acct) && isNonEmptyString(tok)) {
        authCandidates.push({
          accountSid: String(acct),
          authToken: String(tok),
          label: "user",
        });
      }
    } catch {
      // ignore
    }
  }

  let lastErr: any = null;

  for (const url of candidates) {
    // If it’s not Twilio API domain, just fetch it directly (no auth header)
    const isTwilioApi = url.includes("api.twilio.com");

    // Try unauthenticated first for non-twilio URLs
    if (!isTwilioApi) {
      try {
        const r = await fetch(url);
        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(
            `Fetch recording failed (${r.status}) from ${url}. ${txt ? txt.slice(0, 200) : ""}`
          );
        }
        const ct = r.headers.get("content-type") || "audio/mpeg";
        const ab = await r.arrayBuffer();
        const buf = Buffer.from(ab);
        if (!buf || buf.length < 512) {
          throw new Error(`Recording audio too small from ${url} (${buf?.length || 0} bytes).`);
        }
        return { buffer: buf, contentType: ct, sourceUrl: url };
      } catch (e: any) {
        lastErr = e;
        continue;
      }
    }

    // Twilio API URLs: try each auth candidate (platform first, then user)
    for (const auth of authCandidates) {
      try {
        const r = await fetch(url, {
          headers: {
            Authorization: `Basic ${btoaBasic(auth.accountSid, auth.authToken)}`,
          },
        });

        if (!r.ok) {
          const txt = await r.text().catch(() => "");
          throw new Error(
            `Fetch recording failed (${r.status}) from ${url} using ${auth.label} auth. ${
              txt ? txt.slice(0, 200) : ""
            }`
          );
        }

        const ct = r.headers.get("content-type") || "audio/mpeg";
        const ab = await r.arrayBuffer();
        const buf = Buffer.from(ab);

        if (!buf || buf.length < 512) {
          throw new Error(`Recording audio too small from ${url} (${buf?.length || 0} bytes).`);
        }

        return { buffer: buf, contentType: ct, sourceUrl: url };
      } catch (e: any) {
        lastErr = e;
        continue;
      }
    }
  }

  throw lastErr || new Error("Failed to fetch recording audio from candidate URLs.");
}

async function transcribeWithOpenAI(args: {
  audio: Buffer;
  contentType: string;
}): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured.");

  const fd = new FormData();

  const filename = args.contentType.includes("wav")
    ? "recording.wav"
    : args.contentType.includes("mp4")
    ? "recording.mp4"
    : "recording.mp3";

  // ✅ TS-safe Blob creation
  const u8 = new Uint8Array(args.audio);
  const blob = new Blob([u8], { type: args.contentType });

  fd.append("file", blob, filename);
  fd.append("model", OPENAI_TRANSCRIBE_MODEL);

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
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

  if (!isNonEmptyString(text)) throw new Error("OpenAI transcription returned empty text.");
  return String(text).trim();
}

// ───────────────────────── Close-style AI Call Overview (same schema as Call.ts) ─────────────────────────

type AICallOverviewOutcome =
  | "Booked"
  | "Callback"
  | "Not Interested"
  | "No Answer"
  | "Voicemail"
  | "Other";

type AICallOverviewSentiment = "Positive" | "Neutral" | "Negative";

interface AICallOverview {
  overviewBullets: string[];
  keyDetails: string[];
  objections: string[];
  questions: string[];
  nextSteps: string[];
  outcome: AICallOverviewOutcome;
  appointmentTime?: string;
  sentiment?: AICallOverviewSentiment;
  generatedAt: string; // ISO
  version: 1;
}

function normalizeOverviewSentiment(v: any): AICallOverviewSentiment | undefined {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return undefined;
  if (s === "positive") return "Positive";
  if (s === "neutral") return "Neutral";
  if (s === "negative") return "Negative";
  if (s.includes("pos")) return "Positive";
  if (s.includes("neut")) return "Neutral";
  if (s.includes("neg")) return "Negative";
  return undefined;
}

function clampBulletsTotal(o: AICallOverview): AICallOverview {
  const fields: (keyof Pick<
    AICallOverview,
    "overviewBullets" | "keyDetails" | "objections" | "questions" | "nextSteps"
  >)[] = ["overviewBullets", "keyDetails", "objections", "questions", "nextSteps"];

  for (const f of fields) {
    const arr = Array.isArray(o[f]) ? o[f] : [];
    o[f] = arr.map((x) => String(x || "").trim()).filter(Boolean);
  }

  let total =
    o.overviewBullets.length +
    o.keyDetails.length +
    o.objections.length +
    o.questions.length +
    o.nextSteps.length;

  if (total <= 12) return o;

  const trimOrder: (keyof AICallOverview)[] = [
    "nextSteps",
    "questions",
    "objections",
    "keyDetails",
    "overviewBullets",
  ];

  for (const f of trimOrder) {
    if (total <= 12) break;
    const arr = (o as any)[f] as string[];
    while (Array.isArray(arr) && arr.length > 0 && total > 12) {
      arr.pop();
      total -= 1;
    }
  }

  return o;
}

function capSections(o: AICallOverview): AICallOverview {
  // Keep it tight (Close-style) and avoid overwhelming the agent
  o.overviewBullets = (Array.isArray(o.overviewBullets) ? o.overviewBullets : []).slice(0, 6);
  o.keyDetails = (Array.isArray(o.keyDetails) ? o.keyDetails : []).slice(0, 4);
  o.objections = (Array.isArray(o.objections) ? o.objections : []).slice(0, 3);
  o.questions = (Array.isArray(o.questions) ? o.questions : []).slice(0, 3);
  o.nextSteps = (Array.isArray(o.nextSteps) ? o.nextSteps : []).slice(0, 3);
  return o;
}

function buildLockedPrompt(args: {
  transcript: string;
  durationSeconds?: number;
  isVoicemail?: boolean;
  direction?: string;
}): string {
  const schema = `interface AICallOverview {
  overviewBullets: string[];       // 3–6 bullets (top summary)
  keyDetails: string[];            // household, coverage, timing
  objections: string[];            // objections + responses
  questions: string[];             // questions asked by lead
  nextSteps: string[];             // follow-ups / actions
  outcome: "Booked" | "Callback" | "Not Interested" | "No Answer" | "Voicemail" | "Other";
  appointmentTime?: string;        // ISO or display string if booked
  sentiment?: "Positive" | "Neutral" | "Negative";
  generatedAt: string;             // ISO timestamp
  version: 1;
}`;

  const meta: string[] = [];
  if (typeof args.durationSeconds === "number")
    meta.push(`- call duration: ${args.durationSeconds}s`);
  if (typeof args.isVoicemail === "boolean")
    meta.push(`- voicemail detected: ${args.isVoicemail ? "yes" : "no"}`);
  if (args.direction) meta.push(`- direction: ${args.direction}`);

  return `You are generating a CRM call overview for a sales agent.

Rules:
- Output ONLY valid JSON matching the provided schema.
- DO NOT include explanations.
- DO NOT include paragraphs.
- Bullet points only.
- Pick ONLY the most important points (no filler).
- Keep it tight (Close-style):
  - overviewBullets: max 6
  - keyDetails: max 4
  - objections: max 3
  - questions: max 3
  - nextSteps: max 3
- No more than 12 total bullets across all sections.
- Bullets must be factual, not salesy.
- If something did not occur, return an empty array for that field.
- If voicemail is detected, set outcome="Voicemail".

Schema:
${schema}

Transcript:
${args.transcript}

Call metadata:
${meta.length ? meta.join("\n") : "- (none)"}`;
}

async function generateCallOverview(args: {
  transcript: string;
  durationSeconds?: number;
  isVoicemail?: boolean;
  direction?: string;
}): Promise<AICallOverview | null> {
  if (!OPENAI_API_KEY) return null;

  const prompt = buildLockedPrompt({
    transcript: args.transcript,
    durationSeconds: args.durationSeconds,
    isVoicemail: args.isVoicemail,
    direction: args.direction,
  });

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_OVERVIEW_MODEL,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    console.warn("[calls/transcribe-recording] overview generation failed", {
      status: resp.status,
      body: txt ? txt.slice(0, 500) : "",
    });
    return null;
  }

  const data: any = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (!isNonEmptyString(content)) return null;

  let parsed: any = null;
  try {
    parsed = JSON.parse(String(content));
  } catch {
    const s = String(content);
    const first = s.indexOf("{");
    const last = s.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        parsed = JSON.parse(s.slice(first, last + 1));
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") return null;

  const isVoicemail = args.isVoicemail === true;

  const overview: AICallOverview = {
    overviewBullets: Array.isArray(parsed.overviewBullets) ? parsed.overviewBullets : [],
    keyDetails: Array.isArray(parsed.keyDetails) ? parsed.keyDetails : [],
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
    outcome: isVoicemail ? "Voicemail" : (parsed.outcome as any) || "Other",
    appointmentTime: isNonEmptyString(parsed.appointmentTime) ? String(parsed.appointmentTime) : undefined,
    sentiment: normalizeOverviewSentiment(parsed?.sentiment),
    generatedAt: new Date().toISOString(),
    version: 1,
  };

  return clampBulletsTotal(capSections(overview));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }
  // Auth: allow either cron-key (server automation) OR signed-in user (manual UI)
  const hdr = (req.headers["x-cron-key"] || "") as string;
  const cronOk = !!AI_DIALER_CRON_KEY && !!hdr && hdr === AI_DIALER_CRON_KEY;

  let requesterEmail: string | null = null;
  let requesterIsAdmin = false;

  if (!cronOk) {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    requesterEmail = session?.user?.email ? String(session.user.email).toLowerCase() : null;
    if (!requesterEmail) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
  }

  try {
    const { callId, callSid } = (req.body || {}) as Body;

    if (!isNonEmptyString(callId) && !isNonEmptyString(callSid)) {
      return res.status(400).json({ ok: false, message: "Provide callId or callSid" });
    }
    await dbConnect();

    // If this is a user-initiated call (no cron key), determine admin status
    if (requesterEmail) {
      try {
        const requester: any = await getUserByEmail(requesterEmail);
        requesterIsAdmin = !!requester && (requester as any).role === "admin";
      } catch {
        requesterIsAdmin = false;
      }
    }

    const call: any = isNonEmptyString(callId)
      ? await (Call as any).findById(String(callId)).exec()
      : await (Call as any).findOne({ callSid: String(callSid) }).exec();

    if (!call) return res.status(404).json({ ok: false, message: "Call not found" });

    // Ownership: signed-in users may only process their own calls (admins can process any)
    if (!cronOk && !requesterIsAdmin) {
      const callEmail = isNonEmptyString(call?.userEmail) ? String(call.userEmail).toLowerCase() : "";
      if (!requesterEmail || !callEmail || callEmail !== requesterEmail) {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }
    }

    const alreadyHasOverview =
      call.aiOverviewReady === true && call.aiOverview && typeof call.aiOverview === "object";
    const alreadyHasTranscript = isNonEmptyString(call.transcript);

    // Idempotency: if already done, skip
    if (alreadyHasOverview && alreadyHasTranscript) {
      return res.status(200).json({
        ok: true,
        callId: String(call._id),
        callSid: String(call.callSid || ""),
        transcribedAt: new Date().toISOString(),
        transcriptChars: String(call.transcript || "").length,
        overviewReady: true,
        skipped: true,
        reason: "already_done",
      });
    }

    if (!isNonEmptyString(call.recordingUrl) && !isNonEmptyString(call.recordingSid)) {
      return res.status(400).json({
        ok: false,
        message: "Call has no recordingUrl/recordingSid yet (recording not ready).",
      });
    }

    // Mark as pending (post-call only)
    try {
      call.aiProcessing = "pending";
      await call.save();
    } catch {
      // non-blocking
    }

    const audio = await fetchRecordingAudio({
      recordingUrl: call.recordingUrl,
      recordingSid: call.recordingSid,
      userEmail: call.userEmail,
    });

    const transcriptText = await transcribeWithOpenAI({
      audio: audio.buffer,
      contentType: audio.contentType,
    });

    // Save transcript ONLY if empty (don’t overwrite anything existing)
    if (!alreadyHasTranscript) {
      call.transcript = transcriptText;
    }

    // Generate structured overview (same schema UI reads)
    const durationSeconds =
      typeof call.duration === "number"
        ? call.duration
        : typeof call.durationSec === "number"
        ? call.durationSec
        : typeof call.recordingDuration === "number"
        ? call.recordingDuration
        : undefined;

    const overview = await generateCallOverview({
      transcript: transcriptText,
      durationSeconds,
      isVoicemail: call.isVoicemail === true,
      direction: isNonEmptyString(call.direction) ? String(call.direction) : undefined,
    });

    if (overview) {
      call.aiOverview = {
        ...overview,
        generatedAt: new Date(overview.generatedAt),
      };
      call.aiOverviewReady = true;
      call.aiProcessing = "done";
    } else {
      call.aiProcessing = "error";
    }

    await call.save();

    return res.status(200).json({
      ok: true,
      callId: String(call._id),
      callSid: String(call.callSid || ""),
      transcribedAt: new Date().toISOString(),
      transcriptChars: transcriptText.length,
      overviewReady: !!call.aiOverviewReady,
    });
  } catch (err: any) {
    console.error("[calls/transcribe-recording] error:", err?.message || err);

    // Best-effort: mark error on the call if possible (non-blocking)
    try {
      const { callId, callSid } = (req.body || {}) as Body;
      if (isNonEmptyString(callId) || isNonEmptyString(callSid)) {
        await dbConnect();
        const call: any = isNonEmptyString(callId)
          ? await (Call as any).findById(String(callId)).exec()
          : await (Call as any).findOne({ callSid: String(callSid) }).exec();
        if (call) {
          call.aiProcessing = "error";
          await call.save();
        }
      }
    } catch {}

    return res.status(500).json({
      ok: false,
      message: err?.message || "Failed to transcribe and generate overview",
    });
  }
}
