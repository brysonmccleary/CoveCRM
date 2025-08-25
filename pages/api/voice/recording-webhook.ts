import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import User from "@/models/User";
import { getUserByPhoneNumber } from "@/lib/getUserByPhoneNumber";

export const config = { api: { bodyParser: false } };

const PLATFORM_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || "").trim();
const PLATFORM_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || "").trim();

const RAW_BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const BASE_URL = RAW_BASE || "";
const ALLOW_DEV_TWILIO_TEST = process.env.ALLOW_LOCAL_TWILIO_TEST === "1" && process.env.NODE_ENV !== "production";

const CALL_AI_SUMMARY_ENABLED =
  (process.env.CALL_AI_SUMMARY_ENABLED || "").toLowerCase() === "1" ||
  (process.env.CALL_AI_SUMMARY_ENABLED || "").toLowerCase() === "true";

function candidateUrls(path: string): string[] {
  if (!BASE_URL) return [];
  const u = new URL(BASE_URL);
  const withWww = u.hostname.startsWith("www.") ? BASE_URL : `${u.protocol}//www.${u.hostname}${u.port ? ":" + u.port : ""}`;
  const withoutWww = u.hostname.startsWith("www.") ? `${u.protocol}//${u.hostname.replace(/^www\./, "")}${u.port ? ":" + u.port : ""}` : BASE_URL;
  return [
    `${BASE_URL}${path}`,
    `${withWww}${path}`,
    `${withoutWww}${path}`,
  ].filter((v, i, a) => !!v && a.indexOf(v) === i);
}

function extFromUrl(url?: string | null): string {
  if (!url) return "unknown";
  const m = url.toLowerCase().match(/\.(mp3|wav)(?:\?|#|$)/);
  return m?.[1] || "unknown";
}
function parseIntSafe(n?: string | null): number | undefined {
  if (!n) return undefined;
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : undefined;
}
function btoaBasic(user: string, pass: string) {
  const raw = `${user}:${pass}`;
  return Buffer.from(raw).toString("base64");
}
async function tryValidate(signature: string, params: Record<string, any>, urls: string[], tokens: (string | undefined)[]) {
  for (const token of tokens) {
    const t = (token || "").trim();
    if (!t) continue;
    for (const url of urls) {
      if (twilio.validateRequest(t, signature, url, params)) return true;
    }
  }
  return false;
}

// Helper: resolve which user owns a Twilio number
async function resolveOwnerEmailByOwnedNumber(num: string): Promise<string | null> {
  if (!num) return null;
  const owner =
    (await User.findOne({ "numbers.phoneNumber": num })) ||
    (await User.findOne({ "numbers.messagingServiceSid": num }));
  return owner?.email?.toLowerCase?.() || null;
}

// Try to fetch content-length of the recording (if authentication available)
async function probeRecordingSize(url: string, accountSid?: string, authToken?: string): Promise<number | undefined> {
  try {
    if (!url || !accountSid || !authToken) return undefined;
    const res = await fetch(url, {
      method: "HEAD",
      headers: { Authorization: `Basic ${btoaBasic(accountSid, authToken)}` },
    });
    const cl = res.headers.get("content-length");
    if (!cl) return undefined;
    const num = parseInt(cl, 10);
    return Number.isFinite(num) ? num : undefined;
  } catch {
    return undefined;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") { res.status(405).end("Method Not Allowed"); return; }

  const raw = await buffer(req);
  const bodyStr = raw.toString("utf8");
  const params = new URLSearchParams(bodyStr);
  const signature = (req.headers["x-twilio-signature"] || "") as string;
  const urls = candidateUrls("/api/voice/recording-webhook");
  const paramsObj = Object.fromEntries(params as any);

  await dbConnect();

  // Try platform token first
  let valid = await tryValidate(signature, paramsObj, urls, [PLATFORM_AUTH_TOKEN]);

  // If invalid, attempt to resolve owner and use their personal auth token (if stored)
  let ownerUser: any | null = null;
  if (!valid && !ALLOW_DEV_TWILIO_TEST) {
    const CallSid = params.get("CallSid") || "";
    const From = params.get("From") || params.get("Caller") || "";
    const To = params.get("To") || params.get("Called") || "";

    const inboundOwner = To ? await getUserByPhoneNumber(To) : null;
    const outboundOwner = From ? await getUserByPhoneNumber(From) : null;
    ownerUser = inboundOwner || outboundOwner || (CallSid ? await Call.findOne({ callSid: CallSid }) : null);

    const personalToken =
      (ownerUser as any)?.twilio?.authToken ||
      (typeof ownerUser?.userEmail === "string"
        ? ((await User.findOne({ email: (ownerUser.userEmail || ownerUser.email).toLowerCase() })) as any)?.twilio?.authToken
        : undefined);

    if (personalToken) {
      valid = await tryValidate(signature, paramsObj, urls, [personalToken]);
    }
  }

  if (!valid && !ALLOW_DEV_TWILIO_TEST) {
    console.warn("❌ Invalid Twilio signature on recording-webhook (all tokens/URLs failed)");
    res.status(403).end("Invalid signature");
    return;
  }
  if (!valid && ALLOW_DEV_TWILIO_TEST) {
    console.warn("⚠️ Dev bypass: Twilio signature validation skipped (recording-webhook).");
  }

  try {
    // ---- Core Twilio fields
    const CallSid = params.get("CallSid") || "";
    const RecordingSid = params.get("RecordingSid") || "";
    const RecordingStatus = (params.get("RecordingStatus") || "").toLowerCase(); // completed | processing | failed | ...
    const RecordingUrlRaw = params.get("RecordingUrl") || "";
    const RecordingDurationStr = params.get("RecordingDuration") || "";
    const ConferenceName = params.get("ConferenceName") || params.get("conferenceName") || "";

    const RecordingChannels = params.get("RecordingChannels") || "";
    const RecordingSource = params.get("RecordingSource") || "";
    const RecordingType = params.get("RecordingType") || "";

    const From = params.get("From") || params.get("Caller") || "";
    const To = params.get("To") || params.get("Called") || "";
    const Timestamp = params.get("Timestamp") || undefined;

    // Normalize URL → prefer mp3
    const recordingUrl =
      RecordingUrlRaw
        ? (RecordingUrlRaw.endsWith(".mp3") || RecordingUrlRaw.endsWith(".wav"))
          ? RecordingUrlRaw
          : `${RecordingUrlRaw}.mp3`
        : "";

    const recordingDuration = parseIntSafe(RecordingDurationStr);
    const now = Timestamp ? new Date(Timestamp) : new Date();

    // ---- Resolve owner / user
    const inboundOwner = To ? await getUserByPhoneNumber(To) : null;
    const outboundOwner = From ? await getUserByPhoneNumber(From) : null;
    const direction: "inbound" | "outbound" = inboundOwner ? "inbound" : "outbound";
    const ownerNumber = inboundOwner ? To : From;
    const otherNumber = inboundOwner ? From : To;
    const userEmail =
      (inboundOwner?.email?.toLowerCase?.() ||
        outboundOwner?.email?.toLowerCase?.() ||
        (await resolveOwnerEmailByOwnedNumber(ownerNumber)) ||
        undefined) as string | undefined;

    const recordingFormat = extFromUrl(recordingUrl);

    // Attempt to find an existing call
    const existing =
      (CallSid && (await Call.findOne({ callSid: CallSid }))) ||
      (RecordingSid && (await Call.findOne({ recordingSid: RecordingSid }))) ||
      null;

    // Probe size (best-effort)
    let sizeBytes: number | undefined;
    try {
      const userDoc = userEmail ? await User.findOne({ email: userEmail }) : null;
      const acctSid = (userDoc as any)?.twilio?.accountSid || PLATFORM_ACCOUNT_SID;
      const authTok = (userDoc as any)?.twilio?.authToken || PLATFORM_AUTH_TOKEN;
      if (recordingUrl && acctSid && authTok) sizeBytes = await probeRecordingSize(recordingUrl, acctSid, authTok);
    } catch {}

    // ---- Build updates
    const setBase: any = {
      recordingSid: RecordingSid || undefined,
      recordingUrl: recordingUrl || undefined,
      recordingStatus: RecordingStatus || undefined,
      recordingDuration: recordingDuration,
      recordingFormat,
      recordingChannels: RecordingChannels || undefined,
      recordingSource: RecordingSource || undefined,
      recordingType: RecordingType || undefined,
      recordingSizeBytes: typeof sizeBytes === "number" ? sizeBytes : undefined,

      ownerNumber: ownerNumber || existing?.ownerNumber,
      otherNumber: otherNumber || existing?.otherNumber,
      from: ownerNumber || existing?.from,
      to: otherNumber || existing?.to,
      conferenceName: ConferenceName || existing?.conferenceName,
    };

    if (RecordingStatus === "completed") {
      setBase.completedAt = existing?.completedAt || now;
      setBase.endedAt = existing?.endedAt || setBase.completedAt;
      if (typeof recordingDuration === "number" && recordingDuration >= 0) {
        if (typeof (existing as any)?.duration !== "number") {
          setBase.duration = recordingDuration;
          setBase.durationSec = recordingDuration;
        }
      }
    }

    // ---- Upsert logic
    if (existing) {
      await Call.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...setBase,
            userEmail: existing.userEmail || userEmail,
            direction: existing.direction || direction,
          },
        },
      );
    } else if (CallSid) {
      await Call.updateOne(
        { callSid: CallSid },
        {
          $setOnInsert: {
            callSid: CallSid,
            userEmail,
            direction,
            startedAt: now,
          },
          $set: setBase,
        },
        { upsert: true },
      );
    } else {
      console.warn("⚠️ Recording webhook without CallSid; skipping upsert.", { RecordingSid, ConferenceName });
      res.status(200).end();
      return;
    }

    // ---- Emit live update for UI
    try {
      const io = (res.socket as any)?.server?.io;
      if (io && userEmail) {
        io.to(userEmail).emit("call:updated", {
          callSid: CallSid || RecordingSid,
          status: RecordingStatus || "recorded",
          recordingUrl,
          recordingSid: RecordingSid || null,
          durationSec: recordingDuration || null,
          timestamp: now.toISOString(),
        });
      }
    } catch (e) {
      console.warn("ℹ️ Socket emit (call:updated) failed:", (e as any)?.message || e);
    }

    // ---- AI gate
    if (RecordingStatus === "completed" && recordingUrl) {
      try {
        const user =
          (userEmail && (await User.findOne({ email: userEmail }))) || null;
        const aiAllowed = !!(user?.hasAI && CALL_AI_SUMMARY_ENABLED);

        if (aiAllowed) {
          await Call.updateOne(
            { callSid: CallSid },
            { $set: { aiProcessing: "pending", aiEnabledAtCallTime: true } },
          );
          // Optionally trigger your background summarizer here.
        }
      } catch (e) {
        console.warn("ℹ️ Skipped AI queue:", (e as any)?.message || e);
      }
    }

    res.status(200).end();
  } catch (err) {
    console.error("❌ Recording webhook error:", err);
    res.status(200).end();
  }
}
