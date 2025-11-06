// pages/api/twilio/calls/answer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import InboundCall from "@/models/InboundCall";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const ownerEmail = session?.user?.email?.toLowerCase();
  if (!ownerEmail) return res.status(401).json({ message: "Unauthorized" });

  const { phone } = (req.body || {}) as { phone?: string };

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !BASE) {
    return res.status(500).json({ message: "Missing env (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/BASE_URL)" });
  }
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  try {
    await dbConnect();

    // Most recent active inbound for this user (optionally filtered by caller)
    const q: any = { ownerEmail, state: "ringing", expiresAt: { $gt: new Date() } };
    if (phone) q.from = phone;
    const ic = await InboundCall.findOne(q).sort({ _id: -1 }).lean();

    if (!ic?.callSid) {
      return res.status(200).json({ ok: true, message: "No active inbound call found" });
    }

    // Redirect the live call to our continue TwiML, which then forwards to your existing voice-answer flow
    const continueUrl = `${BASE}/api/twilio/calls/continue`; // ← matches your current file path
    await client.calls(ic.callSid).update({ url: continueUrl, method: "POST" });

    // Best-effort mark as bridging
    try {
      await InboundCall.updateOne({ callSid: ic.callSid }, { $set: { state: "bridging" } });
    } catch {}

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error("answer error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
