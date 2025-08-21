// pages/api/twilio/calls/hangup.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import twilioClient from "@/lib/twilioClient";

type Result = { sid: string; ok: boolean; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { callSid, callSids } = (req.body ?? {}) as { callSid?: string; callSids?: string[] };
  const sids = (Array.isArray(callSids) ? callSids : []).concat(callSid ? [callSid] : []).filter(Boolean) as string[];
  if (sids.length === 0) {
    return res.status(400).json({ message: "Missing callSid/callSids" });
  }

  const results: Result[] = [];
  for (const sid of sids) {
    try {
      // Try to end the call regardless of state
      await twilioClient.calls(sid).update({ status: "completed" as any });
      results.push({ sid, ok: true });
    } catch (err: any) {
      // If it's not in-progress (queued/ringing), 'completed' may fail; try 'canceled'
      try {
        await twilioClient.calls(sid).update({ status: "canceled" as any });
        results.push({ sid, ok: true });
      } catch (err2: any) {
        results.push({ sid, ok: false, error: err2?.message || err?.message || "Unknown Twilio error" });
      }
    }
  }

  // 207: multi-status style response
  const allOk = results.every(r => r.ok);
  return res.status(allOk ? 200 : 207).json({ success: allOk, results });
}
