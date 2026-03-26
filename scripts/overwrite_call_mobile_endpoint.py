#!/usr/bin/env python3
from pathlib import Path
import shutil
from datetime import datetime
import sys

TARGET = Path("pages/api/twilio/voice/call-mobile.ts")

CONTENT = r'''// pages/api/twilio/voice/call-mobile.ts
// Mobile-only outbound call placement endpoint (conference-based)
// - Auth: Bearer mobile JWT (from /api/mobile/login)
// - Behavior: match web /api/twilio/voice/call.ts call placement (PSTN leg via REST + conferenceName)

import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Call from "@/models/Call";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";
import { isCallAllowedForLead } from "@/utils/checkCallTime";

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  process.env.JWT_SECRET ||
  "dev-mobile-secret";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");

const VOICE_CONTINUE_PATH = "/api/twiml/voice/continue";
const voiceContinueUrl = (conference: string) =>
  `${BASE}${VOICE_CONTINUE_PATH}?conference=${encodeURIComponent(conference)}`;

const voiceStatusUrl = (email: string) =>
  `${BASE}/api/twilio/voice-status?userEmail=${encodeURIComponent(email.toLowerCase())}`;

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

function makeConferenceName(email: string) {
  const slug = email.replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 24);
  const rand = Math.random().toString(36).slice(2, 8);
  return `cove_${slug}_${Date.now().toString(36)}_${rand}`;
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const email = getEmailFromMobileAuth(req);
  if (!email) return res.status(401).json({ message: "Unauthorized (missing mobile JWT email)" });

  const body = (req.body || {}) as any;
  const toRaw = body.to || body.To || "";
  const leadId = body.leadId || body.LeadId || null;
  const requestedFromRaw = body.fromNumber || body.from || body.CallerId || "";

  try {
    await dbConnect();

    // If leadId provided, we can enforce quiet-hours based on lead; otherwise skip that check.
    let leadDoc: any = null;
    if (leadId) {
      leadDoc = await Lead.findOne({ _id: leadId, userEmail: email }).lean();
      if (!leadDoc) return res.status(404).json({ message: "Lead not found or access denied" });

      const { allowed, zone } = isCallAllowedForLead(leadDoc);
      if (!allowed) {
        return res.status(409).json({
          message: "Quiet hours — local time for this lead is outside 8am–9pm",
          zone: zone || null,
        });
      }
    }

    const to = normalizeE164(String(toRaw));
    if (!to) return res.status(400).json({ message: "Missing or invalid destination number" });

    const { client } = await getClientForUser(email);

    // Match web behavior: honor requested fromNumber if it exists on this subaccount, else pick one.
    const requestedFrom = normalizeE164(String(requestedFromRaw || ""));
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
      statusCallback: voiceStatusUrl(email),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      record: false,
    });

    // Optional: store a Call row like web does (doesn't affect web flow)
    const now = new Date();
    await Call.findOneAndUpdate(
      { callSid: call.sid },
      {
        $setOnInsert: {
          userEmail: email,
          leadId: leadId || undefined,
          callSid: call.sid,
          direction: "outbound",
          to,
          from: chosenFrom,
          createdAt: now,
          startedAt: now,
        },
        $set: { lastStatus: "initiated", conferenceName },
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      ok: true,
      conferenceName,
      callSid: call.sid,
      from: chosenFrom,
      to,
    });
  } catch (e: any) {
    console.error("[call-mobile] error:", e?.message || e);
    return res.status(500).json({ message: e?.message || "Call failed" });
  }
}
'''

def main():
    TARGET.parent.mkdir(parents=True, exist_ok=True)

    if TARGET.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = TARGET.with_suffix(TARGET.suffix + f".bak_{ts}")
        shutil.copy2(TARGET, backup)
        print("[patch] Backup:", backup)

    TARGET.write_text(CONTENT, encoding="utf-8")
    print("[patch] Wrote:", TARGET)

if __name__ == "__main__":
    main()
