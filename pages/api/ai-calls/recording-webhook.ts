// pages/api/ai-calls/recording-webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import AICallSession from "@/models/AICallSession";
import { Types } from "mongoose";

export const config = { api: { bodyParser: false } };

const PLATFORM_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || "").trim();

const RAW_BASE = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  ""
).replace(/\/$/, "");
const BASE_URL = RAW_BASE || "";
const ALLOW_DEV_TWILIO_TEST =
  process.env.ALLOW_LOCAL_TWILIO_TEST === "1" &&
  process.env.NODE_ENV !== "production";

function candidateUrls(path: string): string[] {
  if (!BASE_URL) return [];
  const u = new URL(BASE_URL);
  const withWww = u.hostname.startsWith("www.")
    ? BASE_URL
    : `${u.protocol}//www.${u.hostname}${u.port ? ":" + u.port : ""}`;
  const withoutWww = u.hostname.startsWith("www.")
    ? `${u.protocol}//${u.hostname.replace(/^www\./, "")}${
        u.port ? ":" + u.port : ""
      }`
    : BASE_URL;
  return [
    `${BASE_URL}${path}`,
    `${withWww}${path}`,
    `${withoutWww}${path}`,
  ].filter((v, i, a) => !!v && a.indexOf(v) === i);
}

function parseIntSafe(n?: string | null): number | undefined {
  if (!n) return undefined;
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : undefined;
}

async function tryValidate(
  signature: string,
  params: Record<string, any>,
  urls: string[],
  tokens: (string | undefined)[]
) {
  for (const token of tokens) {
    const t = (token || "").trim();
    if (!t) continue;
    for (const url of urls) {
      if (twilio.validateRequest(t, signature, url, params)) return true;
    }
  }
  return false;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  const raw = await buffer(req);
  const bodyStr = raw.toString("utf8");
  const params = new URLSearchParams(bodyStr);
  const signature = (req.headers["x-twilio-signature"] || "") as string;
  const urls = candidateUrls("/api/ai-calls/recording-webhook");
  const paramsObj = Object.fromEntries(params as any);

  await mongooseConnect();

  let valid = await tryValidate(signature, paramsObj, urls, [
    PLATFORM_AUTH_TOKEN,
  ]);

  if (!valid && !ALLOW_DEV_TWILIO_TEST) {
    console.warn(
      "❌ Invalid Twilio signature on AI recording-webhook (all tokens/URLs failed)"
    );
    res.status(403).end("Invalid signature");
    return;
  }
  if (!valid && ALLOW_DEV_TWILIO_TEST) {
    console.warn(
      "⚠️ Dev bypass: Twilio signature validation skipped (AI recording-webhook)."
    );
  }

  try {
    const CallSid = params.get("CallSid") || "";
    const RecordingSid = params.get("RecordingSid") || "";
    const RecordingStatus = (params.get("RecordingStatus") || "").toLowerCase(); // completed | ...
    const RecordingUrlRaw = params.get("RecordingUrl") || "";
    const RecordingDurationStr = params.get("RecordingDuration") || "";
    const Timestamp = params.get("Timestamp") || undefined;
    const CallStatus = params.get("CallStatus") || "";

    const recordingUrl = RecordingUrlRaw
      ? RecordingUrlRaw.endsWith(".mp3") || RecordingUrlRaw.endsWith(".wav")
        ? RecordingUrlRaw
        : `${RecordingUrlRaw}.mp3`
      : "";

    const durationSec = parseIntSafe(RecordingDurationStr);
    const now = Timestamp ? new Date(Timestamp) : new Date();

    const { sessionId, leadId } = req.query as {
      sessionId?: string;
      leadId?: string;
    };

    let aiSession: any = null;
    let userEmail: string | null = null;

    if (sessionId && Types.ObjectId.isValid(String(sessionId))) {
      aiSession = await AICallSession.findById(sessionId).lean();
      if (aiSession?.userEmail) {
        userEmail = String(aiSession.userEmail).toLowerCase();
      }
    }

    const leadObjectId =
      leadId && Types.ObjectId.isValid(String(leadId))
        ? new Types.ObjectId(String(leadId))
        : undefined;

    const existing =
      (CallSid &&
        (await AICallRecording.findOne({ callSid: CallSid }).exec())) ||
      (RecordingSid &&
        (await AICallRecording.findOne({ recordingSid: RecordingSid }).exec())) ||
      null;

    const baseSet: any = {
      recordingSid: RecordingSid || existing?.recordingSid || undefined,
      recordingUrl: recordingUrl || existing?.recordingUrl || undefined,
      durationSec:
        typeof durationSec === "number" ? durationSec : existing?.durationSec,
      updatedAt: now,
    };

    // Build Twilio meta notes suffix
    const metaBits: string[] = [];
    if (CallStatus) metaBits.push(`callStatus=${CallStatus}`);
    if (RecordingStatus) metaBits.push(`recordingStatus=${RecordingStatus}`);
    if (typeof durationSec === "number")
      metaBits.push(`durationSec=${durationSec}`);
    const notesSuffix =
      metaBits.length > 0 ? `Twilio: ${metaBits.join(", ")}` : null;

    // If we don't have a row yet, create one
    if (!existing) {
      await AICallRecording.create({
        userEmail: userEmail || undefined,
        leadId: leadObjectId,
        aiCallSessionId: aiSession?._id,
        callSid: CallSid || RecordingSid || "",
        outcome: "unknown",
        notes: notesSuffix,
        summary: null,
        recordingSid: baseSet.recordingSid,
        recordingUrl: baseSet.recordingUrl,
        durationSec: baseSet.durationSec,
        createdAt: now,
        updatedAt: now,
      });

      // Optionally: mark session as completed when everything is done.
      // For now we leave session state management to the worker.
    } else {
      const newNotes =
        notesSuffix && notesSuffix.length
          ? existing.notes
            ? `${existing.notes}\n${notesSuffix}`
            : notesSuffix
          : existing.notes ?? null;

      await AICallRecording.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...baseSet,
            userEmail: existing.userEmail || userEmail || undefined,
            leadId: existing.leadId || leadObjectId,
            aiCallSessionId:
              existing.aiCallSessionId || aiSession?._id || undefined,
            notes: newNotes,
          },
        }
      );
    }

    // We do NOT attempt to guess outcome here; that can be done later via AI summary.
    if (RecordingStatus === "completed") {
      // Hook point for future: enqueue AI summarizer to update outcome + summary
    }

    res.status(200).end();
  } catch (err) {
    console.error("❌ AI recording-webhook error:", err);
    res.status(200).end();
  }
}
