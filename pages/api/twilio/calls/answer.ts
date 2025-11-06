// pages/api/twilio/calls/answer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import InboundCall from "@/models/InboundCall";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import twilio from "twilio";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");

async function updateCallUrlWithClient(client: twilio.Twilio, callSid: string, url: string) {
  return client.calls(callSid).update({ url, method: "POST" });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const ownerEmail = session?.user?.email?.toLowerCase();
  if (!ownerEmail) return res.status(401).json({ message: "Unauthorized" });

  const { phone } = (req.body || {}) as { phone?: string };
  if (!BASE) return res.status(500).json({ message: "Missing BASE_URL" });
  const continueUrl = `${BASE}/api/twilio/calls/continue`;

  try {
    await dbConnect();

    const q: any = { ownerEmail, state: "ringing", expiresAt: { $gt: new Date() } };
    if (phone) q.from = phone;
    const ic = await InboundCall.findOne(q).sort({ _id: -1 }).lean();
    if (!ic?.callSid) {
      return res.status(200).json({ ok: true, message: "No active inbound call found" });
    }

    // 1) Try PLATFORM credentials first (env), then 2) fallback to USER personal creds.
    const platformSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
    const platformToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
    let platformClient: twilio.Twilio | null = null;
    if (platformSid && platformToken) {
      platformClient = twilio(platformSid, platformToken);
    }

    let updated = false;
    try {
      if (platformClient) {
        await updateCallUrlWithClient(platformClient, ic.callSid, continueUrl);
        updated = true;
      }
    } catch (e: any) {
      // ignore and try personal
    }

    if (!updated) {
      try {
        const { client } = await getClientForUser(ownerEmail);
        await updateCallUrlWithClient(client, ic.callSid, continueUrl);
        updated = true;
      } catch (e: any) {
        // If Twilio says "not in-progress", retry once shortly after to win race
        const msg = (e?.message || "").toLowerCase();
        if (msg.includes("not in-progress")) {
          await new Promise(r => setTimeout(r, 700));
          const { client } = await getClientForUser(ownerEmail);
          await updateCallUrlWithClient(client, ic.callSid, continueUrl);
          updated = true;
        } else {
          throw e;
        }
      }
    }

    // mark bridging (best-effort)
    try {
      await InboundCall.updateOne({ callSid: ic.callSid }, { $set: { state: "bridging" } });
    } catch {}

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error("answer error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
