#!/usr/bin/env python3
from pathlib import Path
import sys

TARGET = Path("pages/api/twilio/voice/call-mobile.ts")

def die(msg):
    print("[patch] ERROR:", msg, file=sys.stderr)
    sys.exit(1)

def main():
    if TARGET.exists():
        die(f"{TARGET} already exists. Refusing to overwrite.")

    content = r'''// pages/api/twilio/voice/call-mobile.ts
// ✅ MOBILE-ONLY outbound call placement (Option 1)
// - Does NOT affect web calling
// - Auth via Authorization: Bearer <mobile JWT from /api/mobile/login>
// - Places PSTN call server-side using the user's Twilio subaccount client
// - Returns conferenceName so the mobile Twilio Device can join the same conference

import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  process.env.JWT_SECRET ||
  "dev-mobile-secret";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const VOICE_CONTINUE_PATH = "/api/twiml/voice/continue";
const voiceContinueUrl = (conference: string) =>
  `${BASE}${VOICE_CONTINUE_PATH}?conference=${encodeURIComponent(conference)}`;

function normalizeE164(p?: string) {
  const raw = String(p || "").trim();
  if (!raw) return "";

  if (raw.startsWith("+")) {
    const d = raw.replace(/\D/g, "");
    if (d.length >= 10 && d.length <= 15) return `+${d}`;
    return "";
  }

  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return "";
}

function makeConferenceName(email: string) {
  const slug = email.replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 8);
  return `cove_m_${slug}_${Date.now().toString(36)}_${rand}`;
}

function getEmailFromMobileAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const emailRaw = (payload?.email || payload?.sub || "").toString();
    const email = emailRaw.trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

// ✅ Validate that a requested caller ID actually exists on THIS user's Twilio subaccount.
// If Twilio API errors for any reason, we safely fall back to the normal picker.
async function validateFromOnSubaccount(client: any, requestedFromE164: string): Promise<boolean> {
  try {
    const list = await client.incomingPhoneNumbers.list({
      phoneNumber: requestedFromE164,
      limit: 1,
    });
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const email = (getEmailFromMobileAuth(req) || "").toLowerCase();
  if (!email) {
    return res.status(401).json({ message: "Unauthorized (missing user email for mobile JWT)" });
  }

  const body = (req.body || {}) as any;
  const toRaw = body.to || body.To || body.phone || body.number;
  const requestedFromRaw = body.fromNumber || body.from || body.From || "";

  const to = normalizeE164(toRaw);
  if (!to) return res.status(400).json({ message: "Missing or invalid destination number" });

  try {
    const { client, user } = await getClientForUser(email);

    // Prefer requested fromNumber IF it exists on this user's subaccount.
    const requestedFrom = normalizeE164(requestedFromRaw);
    let chosenFrom: string | null = null;

    if (requestedFrom) {
      const ok = await validateFromOnSubaccount(client, requestedFrom);
      if (ok) chosenFrom = requestedFrom;
    }

    if (!chosenFrom) {
      chosenFrom = await pickFromNumberForUser(email);
    }

    if (!chosenFrom) {
      return res.status(400).json({ message: "No outbound caller ID configured. Buy a number first." });
    }

    const conferenceName = makeConferenceName(email);

    const call = await client.calls.create({
      to,
      from: chosenFrom,
      url: voiceContinueUrl(conferenceName),
      record: false,
    });

    return res.status(200).json({
      success: true,
      conferenceName,
      callSid: call.sid,
      from: chosenFrom,
      to,
      requestedFrom: requestedFrom || null,
      userEmail: email,
    });
  } catch (e: any) {
    console.error("[call-mobile] error:", e?.message || e);
    return res.status(500).json({ message: e?.message || "Call failed" });
  }
}
'''
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(content, encoding="utf-8")
    print("[patch] Created:", TARGET)
    print("[patch] Next: run dev server or deploy; then curl test with Bearer JWT.")

if __name__ == "__main__":
    main()
