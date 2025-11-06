// pages/api/twilio/voice/inbound.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer as microBuffer } from "micro";
import twilio from "twilio";

import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import InboundCall from "@/models/InboundCall";

// optional models (tolerant)
let PhoneNumberModel: any = null;
let NumberModel: any = null;
try { PhoneNumberModel = require("@/models/PhoneNumber")?.default ?? null; } catch {}
try { NumberModel = require("@/models/Number")?.default ?? null; } catch {}

const { validateRequest } = twilio;

export const config = { api: { bodyParser: false } };

function normalizeE164(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (raw.startsWith("+")) return raw.trim();
  return `+${d}`;
}
function last10(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  return d.slice(-10);
}
function resolveFullUrl(req: NextApiRequest): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.NEXT_PUBLIC_BASE_URL?.startsWith("https") ? "https" : "http") ||
    "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string);
  const path = req.url || "/api/twilio/voice/inbound";
  return `${proto}://${host}${path}`;
}
function baseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
  return raw || "https://www.covecrm.com";
}

function pickFirst(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}
function buildLeadFullName(lead: any): string | undefined {
  const f = pickFirst(lead, ["firstName","First Name","FirstName","first_name","name","Name"]);
  const l = pickFirst(lead, ["lastName","Last Name","LastName","last_name","surname"]);
  if (f && l) return `${f} ${l}`.trim();
  if (f) return f;
  if (typeof lead?.email === "string" && lead.email) return lead.email.split("@")[0];
  return undefined;
}

async function mapDidToOwnerEmail(toE164: string): Promise<string | undefined> {
  if (!toE164) return undefined;

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

  if (NumberModel) {
    const n = (await NumberModel.findOne({ phoneNumber: toE164 }, null, { lean: true })) || null;
    if (n?.userEmail) return String(n.userEmail).toLowerCase();
  }

  const owner = await User.findOne({ "numbers.phoneNumber": toE164 }).lean();
  if (owner?.email) return String(owner.email).toLowerCase();

  return undefined;
}

async function findOrCreateLeadForOwner(ownerEmail: string, fromE164: string, fromLast10: string) {
  let lead =
    (await Lead.findOne({ userEmail: ownerEmail, phoneLast10: fromLast10 }, null, { lean: true })) ||
    (await Lead.findOne({ userEmail: ownerEmail, normalizedPhone: fromE164 }, null, { lean: true })) ||
    (await Lead.findOne({ userEmail: ownerEmail, Phone: fromE164 }, null, { lean: true }));
  if (lead) return lead;

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
  return JSON.parse(JSON.stringify(doc));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // raw body & params
  const rawBody = await microBuffer(req);
  const bodyStr = rawBody.toString("utf8");
  const params = new URLSearchParams(bodyStr);
  const paramsObj: Record<string, string> = {};
  params.forEach((v, k) => (paramsObj[k] = v));

  // signature check
  try {
    const sig = (req.headers["x-twilio-signature"] as string) || "";
    const url = resolveFullUrl(req);
    const token = process.env.TWILIO_AUTH_TOKEN || "";
    if (!token) return res.status(500).send("Server misconfigured");
    const ok = validateRequest(token, sig, url, paramsObj);
    if (!ok) return res.status(403).send("Forbidden");
  } catch (e) {
    console.error("Signature validation error:", e);
    return res.status(500).send("Server error");
  }

  const callSid = params.get("CallSid") || "";
  const fromRaw  = params.get("From") || "";
  const toRaw    = params.get("To") || "";
  const from = normalizeE164(fromRaw);
  const to   = normalizeE164(toRaw);
  const fromLast10 = last10(from);

  let ownerEmail: string | undefined;
  let leadDoc: any | null = null;

  try {
    await dbConnect();
    ownerEmail = await mapDidToOwnerEmail(to);
    if (ownerEmail && fromLast10) {
      leadDoc = await findOrCreateLeadForOwner(ownerEmail, from, fromLast10);
    }
  } catch (e) {
    console.error("DB mapping/upsert error:", e);
  }

  // save short-lived InboundCall doc
  try {
    if (callSid) {
      await InboundCall.findOneAndUpdate(
        { callSid },
        {
          callSid,
          from,
          to,
          ownerEmail: ownerEmail || null,
          leadId: leadDoc?._id?.toString() || null,
          state: "ringing",
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  } catch (e) {
    console.error("InboundCall upsert error:", e);
  }

  // emit banner
  try {
    if (ownerEmail) {
      const EMIT_URL =
        process.env.RENDER_EMIT_URL || "https://covecrm.onrender.com/emit/call-incoming";
      const secret = process.env.EMIT_BEARER_SECRET;
      if (!secret) {
        console.error("Missing EMIT_BEARER_SECRET");
      } else {
        const leadNameFull = leadDoc ? buildLeadFullName(leadDoc) : undefined;
        const resp = await fetch(EMIT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({
            email: ownerEmail,
            leadId: leadDoc?._id?.toString(),
            leadName: leadNameFull,
            phone: from,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          console.error(`Render emit failed (${resp.status}): ${text || resp.statusText}`);
        }
      }
    }
  } catch (e) {
    console.error("Render emit error:", e);
  }

  // keep the call IN-PROGRESS with YOUR ringback until agent clicks Answer.
  // Use ABSOLUTE URL for Twilio <Play>.
  const vr = new twilio.twiml.VoiceResponse();
  const ringUrl = `${baseUrl()}/ringback.mp3`;
  // loop="0" = infinite on Twilio
  vr.play({ loop: 0 }, ringUrl);

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(vr.toString());
}
