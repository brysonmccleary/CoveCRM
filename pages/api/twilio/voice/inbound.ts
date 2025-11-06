// /pages/api/twilio/voice/inbound.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer as microBuffer } from "micro";
import twilio from "twilio";

import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import InboundCall from "@/models/InboundCall";

// We will try both possible number models gracefully.
let PhoneNumberModel: any = null;
let NumberModel: any = null;
try {
  // If you have /models/PhoneNumber.ts
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PhoneNumberModel = require("@/models/PhoneNumber")?.default ?? null;
} catch {}
try {
  // If you have /models/Number.ts (provided)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NumberModel = require("@/models/Number")?.default ?? null;
} catch {}

const { validateRequest } = twilio;

// Twilio sends x-www-form-urlencoded; keep bodyParser off
export const config = {
  api: { bodyParser: false },
};

// ---- Helpers (scoped, no global behavior changes) ---------------------------
function normalizeE164(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (raw.startsWith("+")) return raw.trim();
  return raw.trim();
}

function last10(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  return d.slice(-10);
}

function resolveFullUrl(req: NextApiRequest): string {
  // Build the exact URL Twilio hit for signature validation
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.NEXT_PUBLIC_BASE_URL?.startsWith("https") ? "https" : "http") ||
    "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers.host as string);
  const path = req.url || "/api/twilio/voice/inbound";
  return `${proto}://${host}${path}`;
}

function resolveOrigin(req: NextApiRequest): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.NEXT_PUBLIC_BASE_URL?.startsWith("https") ? "https" : "http") ||
    "https";
  const host =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers.host as string);
  return `${proto}://${host}`;
}

function pickLeadName(lead: any): string | undefined {
  const keys = [
    "name",
    "Name",
    "fullName",
    "Full Name",
    "FullName",
    "First Name",
    "FirstName",
    "firstName",
  ];
  for (const k of keys) {
    const v = lead?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (typeof lead?.email === "string" && lead.email) {
    return lead.email.split("@")[0];
  }
  return undefined;
}

async function mapDidToOwnerEmail(toE164: string): Promise<string | undefined> {
  if (!toE164) return undefined;

  // 1) Check PhoneNumber model (fields can vary: phoneNumber | number, userEmail | userId)
  if (PhoneNumberModel) {
    const pn =
      (await PhoneNumberModel.findOne(
        { $or: [{ phoneNumber: toE164 }, { number: toE164 }] },
        null,
        { lean: true }
      )) || null;

    if (pn?.userEmail) return String(pn.userEmail).toLowerCase();

    if (pn?.userId) {
      const owner = await User.findById(pn.userId).lean();
      if (owner?.email) return String(owner.email).toLowerCase();
    }
  }

  // 2) Check Number model you provided (/models/Number.ts)
  if (NumberModel) {
    const n =
      (await NumberModel.findOne({ phoneNumber: toE164 }, null, {
        lean: true,
      })) || null;
    if (n?.userEmail) return String(n.userEmail).toLowerCase();
  }

  // 3) Fallback: embedded numbers[] inside User
  const owner = await User.findOne({ "numbers.phoneNumber": toE164 }).lean();
  if (owner?.email) return String(owner.email).toLowerCase();

  return undefined;
}

async function findOrCreateLeadForOwner(
  ownerEmail: string,
  fromE164: string,
  fromLast10: string
) {
  // Prefer existing lead scoped to owner
  let lead =
    (await Lead.findOne(
      { userEmail: ownerEmail, phoneLast10: fromLast10 },
      null,
      { lean: true }
    )) ||
    (await Lead.findOne(
      { userEmail: ownerEmail, normalizedPhone: fromE164 },
      null,
      { lean: true }
    )) ||
    (await Lead.findOne(
      { userEmail: ownerEmail, Phone: fromE164 }, // legacy field compat
      null,
      { lean: true }
    ));

  if (lead) return lead;

  // Create a minimal placeholder (does not touch drips/folders)
  const now = new Date();
  const doc = await (Lead as any).create({
    userEmail: ownerEmail,
    normalizedPhone: fromE164,
    phoneLast10: fromLast10,
    source: "inbound-call",
    status: "New",
    createdAt: now,
    updatedAt: now,
  });

  // Return as plain object to keep consistency with lean()
  return JSON.parse(JSON.stringify(doc));
}

// ---- Handler ----------------------------------------------------------------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Read raw body exactly as Twilio sent it
  const rawBody = await microBuffer(req);
  const bodyStr = rawBody.toString("utf8");

  // Parse application/x-www-form-urlencoded into params object
  const params = new URLSearchParams(bodyStr);
  const paramsObj: Record<string, string> = {};
  params.forEach((v, k) => {
    paramsObj[k] = v;
  });

  // ---- Twilio signature validation (security) -------------------------------
  try {
    const sig = (req.headers["x-twilio-signature"] as string) || "";
    const url = resolveFullUrl(req);
    const token = process.env.TWILIO_AUTH_TOKEN || "";
    if (!token) {
      console.error("❌ Missing TWILIO_AUTH_TOKEN env");
      return res.status(500).send("Server misconfigured");
    }
    const ok = validateRequest(token, sig, url, paramsObj);
    if (!ok) {
      console.warn("🚫 Invalid Twilio signature for inbound voice webhook");
      return res.status(403).send("Forbidden");
    }
  } catch (e) {
    console.error("❌ Signature validation error:", e);
    return res.status(500).send("Server error");
  }

  // ---- Extract core fields ---------------------------------------------------
  const callSid = params.get("CallSid") || "";
  const fromRaw = params.get("From") || "";
  const toRaw = params.get("To") || "";

  const from = normalizeE164(fromRaw);
  const to = normalizeE164(toRaw);
  const fromLast10 = last10(from);

  console.log(
    `📞 Inbound call (ringing): From ${from || fromRaw} → To ${to || toRaw} (CallSid=${callSid})`
  );

  // ---- Map DID -> ownerEmail, then find or create lead ----------------------
  let ownerEmail: string | undefined;
  let leadDoc: any | null = null;

  try {
    await dbConnect();

    ownerEmail = await mapDidToOwnerEmail(to);
    if (!ownerEmail) {
      console.warn(`⚠️ No owner mapped for DID: ${to}`);
    } else if (fromLast10) {
      leadDoc = await findOrCreateLeadForOwner(ownerEmail, from, fromLast10);
    }
  } catch (e) {
    console.error("❌ DB mapping/upsert error:", e);
  }

  // ---- Persist short-lived InboundCall (idempotent on callSid) --------------
  const payload: {
    callSid: string;
    from: string;
    to: string;
    leadId?: string;
    leadName?: string;
  } = { callSid, from, to };

  try {
    const leadId = leadDoc?._id?.toString();
    const leadName = leadDoc ? pickLeadName(leadDoc) : undefined;
    if (leadId) payload.leadId = leadId;
    if (leadName) payload.leadName = leadName;

    if (callSid) {
      await InboundCall.findOneAndUpdate(
        { callSid },
        {
          callSid,
          from,
          to,
          ownerEmail: ownerEmail || null,
          leadId: leadId || null,
          state: "ringing",
          // expire in 2 minutes (UI banner window)
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  } catch (e) {
    console.error("❌ InboundCall upsert error:", e);
  }

  // ---- Emit to Render socket service (authoritative path) -------------------
  try {
    if (ownerEmail) {
      const EMIT_URL =
        process.env.RENDER_EMIT_URL ||
        "https://covecrm.onrender.com/emit/call-incoming";
      const secret = process.env.EMIT_BEARER_SECRET;
      if (!secret) {
        console.error("❌ Missing EMIT_BEARER_SECRET env");
      } else {
        const resp = await fetch(EMIT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({
            email: ownerEmail,
            leadId: payload.leadId,
            leadName: payload.leadName,
            phone: from,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          console.error(
            `❌ Render emit failed (${resp.status}): ${text || resp.statusText}`
          );
        } else {
          console.log(`📡 Emitted call:incoming to ${ownerEmail}`, {
            email: ownerEmail,
            leadId: payload.leadId,
            leadName: payload.leadName,
            phone: from,
          });
        }
      }
    } else {
      console.warn("⚠️ Skipping emit: ownerEmail not resolved");
    }
  } catch (e) {
    console.error("❌ Render emit error:", e);
  }

  // ---- Respond TwiML: KEEP CALL IN-PROGRESS with your ringback --------------
  // We must give Twilio an **absolute** URL for the audio asset.
  const origin = resolveOrigin(req);
  const ringbackUrl = `${origin}/ringback.mp3`;

  const vr = new twilio.twiml.VoiceResponse();
  // Optional tiny pause to ensure banner render before audio starts
  vr.pause({ length: 1 });
  // Loop your custom MP3 so the call stays "in-progress" until Answer/Decline/timeout.
  vr.play({ loop: 99 }, ringbackUrl);

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(vr.toString());
}
