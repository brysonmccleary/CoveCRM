// pages/api/twilio/calls/decline.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import InboundCall from "@/models/InboundCall";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const ownerEmail = session?.user?.email?.toLowerCase();
  if (!ownerEmail) return res.status(401).json({ message: "Unauthorized" });

  const { phone } = (req.body || {}) as { phone?: string };

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return res.status(500).json({ message: "Missing Twilio env" });
  }
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  try {
    await dbConnect();

    // Find the most recent ringing call for this user, still within the 2-minute window we set
    const now = new Date();
    const q: any = { ownerEmail, state: "ringing", expiresAt: { $gt: now } };
    if (phone) {
      // narrow by caller if provided
      q.from = phone;
    }
    const ic = await InboundCall.findOne(q).sort({ _id: -1 }).lean();

    if (!ic?.callSid) {
      return res.status(200).json({ ok: true, message: "No active inbound call found" });
    }

    // End the call on Twilio
    await client.calls(ic.callSid).update({ status: "completed" });
    // Best-effort mark ended (ignore errors)
    try {
      await InboundCall.updateOne({ callSid: ic.callSid }, { $set: { state: "ended" } });
    } catch {}

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error("decline error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
