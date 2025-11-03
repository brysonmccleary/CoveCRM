// /pages/api/twilio/voice/inbound.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer as microBuffer } from "micro";
import twilio from "twilio";

import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import PhoneNumber from "@/models/PhoneNumber";
import InboundCall from "@/models/InboundCall";
import { initSocket, emitToUser } from "@/lib/socket";

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
  // Prefer X-Forwarded-* when behind Vercel/Proxies
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

function pickLeadName(lead: any): string | undefined {
  // Try common field variants without changing schema
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
  // fallback: from email local part or phone
  if (typeof lead?.email === "string" && lead.email) {
    return lead.email.split("@")[0];
  }
  return undefined;
}

// ---- Handler ----------------------------------------------------------------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Ensure socket server exists (idempotent, no side effects to dialer)
  try {
    // @ts-ignore next line augments res type in our util
    initSocket(res);
  } catch {}

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

  console.log(`📞 Inbound call (ringing): From ${from || fromRaw} → To ${to || toRaw} (CallSid=${callSid})`);

  // ---- Map DID -> ownerEmail, then find lead (scoped to owner) --------------
  let ownerEmail: string | undefined;
  let leadDoc: any | null = null;

  try {
    await dbConnect();

    // (a) Prefer explicit PhoneNumber mapping (single-owner per DID)
    const pn = to ? await PhoneNumber.findOne({ phoneNumber: to }).lean() : null;
    if (pn?.userId) {
      const owner = await User.findById(pn.userId).lean();
      ownerEmail = owner?.email?.toLowerCase();
    }

    // (b) Fallback to embedded numbers[] on User
    if (!ownerEmail && to) {
      const owner = await User.findOne({ "numbers.phoneNumber": to }).lean();
      ownerEmail = owner?.email?.toLowerCase();
    }

    if (!ownerEmail) {
      console.warn(`⚠️ No owner mapped for DID: ${to}`);
    } else if (fromLast10) {
      // Scoped lead lookup for that owner
      leadDoc =
        (await Lead.findOne(
          { userEmail: ownerEmail, phoneLast10: fromLast10 },
          null,
          { lean: true },
        )) ||
        (await Lead.findOne(
          { userEmail: ownerEmail, normalizedPhone: from },
          null,
          { lean: true },
        )) ||
        (await Lead.findOne(
          { userEmail: ownerEmail, Phone: from }, // legacy field compat
          null,
          { lean: true },
        ));
    }
  } catch (e) {
    console.error("❌ DB mapping error:", e);
  }

  // ---- Upsert short-lived InboundCall (idempotent on callSid) ---------------
  let payload: {
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
          // expire in 2 minutes by default (UI banner window)
          expiresAt: new Date(Date.now() + 2 * 60 * 1000),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
  } catch (e) {
    console.error("❌ InboundCall upsert error:", e);
  }

  // ---- Emit event to correct user channel (no UI here, just server emit) ----
  try {
    if (ownerEmail) {
      emitToUser(ownerEmail, "inbound_call:ringing", payload);
      console.log(`📡 Emitted inbound_call:ringing to ${ownerEmail}`, payload);
    } else {
      console.warn("⚠️ Skipping emit: ownerEmail not resolved");
    }
  } catch (e) {
    console.error("❌ Socket emit error:", e);
  }

  // ---- Respond to Twilio (no behavior changes to your dialer flow) ----------
  // Step 1 acceptance: we're only notifying server-side; keep a minimal response.
  // Keeping a tiny message is harmless while we wire the banner in Step 2.
  const vr = new twilio.twiml.VoiceResponse();
  vr.pause({ length: 1 }); // brief pause keeps webhook valid without altering your dialer logic
  // (No conference/dial here. We will control answer/decline via new endpoints in Step 3.)
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(vr.toString());
}
