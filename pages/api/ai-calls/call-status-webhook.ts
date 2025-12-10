// pages/api/ai-calls/call-status-webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import User from "@/models/User";
import { trackAiDialerUsage } from "@/lib/billing/trackAiDialerUsage";

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

// Your cost per **dial minute** (Twilio + OpenAI), for margin tracking only.
const VENDOR_RATE_PER_MINUTE = Number(
  process.env.AI_DIALER_VENDOR_RATE_PER_MIN_USD || "0.03"
);

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
  const urls = candidateUrls("/api/ai-calls/call-status-webhook");
  const paramsObj = Object.fromEntries(params as any);

  await mongooseConnect();

  let valid = await tryValidate(signature, paramsObj, urls, [
    PLATFORM_AUTH_TOKEN,
  ]);

  if (!valid && !ALLOW_DEV_TWILIO_TEST) {
    console.warn(
      "❌ Invalid Twilio signature on AI call-status-webhook (all tokens/URLs failed)"
    );
    res.status(403).end("Invalid signature");
    return;
  }
  if (!valid && ALLOW_DEV_TWILIO_TEST) {
    console.warn(
      "⚠️ Dev bypass: Twilio signature validation skipped (AI call-status-webhook)."
    );
  }

  try {
    const CallSid = params.get("CallSid") || "";
    const CallStatus = (params.get("CallStatus") || "").toLowerCase();
    // Twilio sends Duration or CallDuration in seconds on completed calls
    const DurationStr =
      params.get("CallDuration") || params.get("Duration") || "";
    const durationSec = parseIntSafe(DurationStr);

    // Optional hints from statusCallback URL
    const qs = req.query as {
      userEmail?: string;
    };
    let userEmail = (qs.userEmail || "").toString().toLowerCase() || "";

    // Only bill on completed calls with a positive duration
    if (CallStatus !== "completed" || !durationSec || durationSec <= 0) {
      return res.status(200).end();
    }

    // ✅ Persist durationSec on the AI recording for analytics / QA
    if (CallSid && durationSec && durationSec > 0) {
      try {
        await AICallRecording.updateOne(
          { callSid: CallSid },
          { $set: { durationSec } }
        ).exec();
      } catch (recErr) {
        console.warn(
          "[AI Dialer billing] Failed to update AICallRecording.durationSec (non-blocking):",
          (recErr as any)?.message || recErr
        );
      }
    }

    // If we don't have userEmail in query, try to get it from AICallRecording
    if (!userEmail && CallSid) {
      const rec = await AICallRecording.findOne({ callSid: CallSid }).lean();
      if (rec?.userEmail) {
        userEmail = (rec.userEmail as string).toLowerCase();
      }
    }

    if (!userEmail) {
      console.warn(
        "[AI Dialer billing] No userEmail resolved for CallSid",
        CallSid
      );
      return res.status(200).end();
    }

    const user = await User.findOne({ email: userEmail });
    if (!user) {
      console.warn(
        "[AI Dialer billing] User not found for email",
        userEmail,
        "CallSid",
        CallSid
      );
      return res.status(200).end();
    }

    // Bill based on **dial time** (full call duration in seconds)
    const minutes = Math.max(1, Math.ceil(durationSec / 60));
    const vendorCostUsd =
      VENDOR_RATE_PER_MINUTE > 0 ? minutes * VENDOR_RATE_PER_MINUTE : 0;

    try {
      await trackAiDialerUsage({
        user,
        minutes,
        vendorCostUsd,
      });
    } catch (billErr) {
      console.error(
        "❌ AI Dialer billing error (non-blocking) in call-status-webhook:",
        (billErr as any)?.message || billErr
      );
    }

    return res.status(200).end();
  } catch (err) {
    console.error("❌ AI call-status-webhook error:", err);
    return res.status(200).end();
  }
}
