// pages/api/twilio/calls/hangup.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import twilioClient from "@/lib/twilioClient";

type HangResult = {
  sid: string;
  previousStatus?: string;
  finalStatus?: "completed" | "canceled" | "noop" | "error";
  ok: boolean;
  error?: string;
};

async function endBySid(sid: string): Promise<HangResult> {
  try {
    const call = await twilioClient.calls(sid).fetch();
    const prev = (call.status || "").toLowerCase();

    // Twilio statuses: queued | ringing | in-progress | completed | busy | failed | no-answer | canceled
    if (prev === "queued" || prev === "ringing" || prev === "pending") {
      await twilioClient.calls(sid).update({ status: "canceled" as any });
      return { sid, previousStatus: prev, finalStatus: "canceled", ok: true };
    }
    if (prev === "in-progress" || prev === "bridged") {
      await twilioClient.calls(sid).update({ status: "completed" as any });
      return { sid, previousStatus: prev, finalStatus: "completed", ok: true };
    }

    // Already terminal (nothing to do)
    if (["completed", "busy", "failed", "no-answer", "canceled"].includes(prev)) {
      return { sid, previousStatus: prev, finalStatus: "noop", ok: true };
    }

    // Fallback attempt: try completed then canceled
    try {
      await twilioClient.calls(sid).update({ status: "completed" as any });
      return { sid, previousStatus: prev, finalStatus: "completed", ok: true };
    } catch {
      try {
        await twilioClient.calls(sid).update({ status: "canceled" as any });
        return { sid, previousStatus: prev, finalStatus: "canceled", ok: true };
      } catch (err2: any) {
        return {
          sid,
          previousStatus: prev,
          finalStatus: "error",
          ok: false,
          error: err2?.message || "Unknown Twilio error",
        };
      }
    }
  } catch (err: any) {
    return {
      sid,
      previousStatus: undefined,
      finalStatus: "error",
      ok: false,
      error: err?.message || "Failed to fetch call from Twilio",
    };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { callSid, callSids } = (req.body ?? {}) as { callSid?: string; callSids?: string[] };
  const sids = (Array.isArray(callSids) ? callSids : []).concat(callSid ? [callSid] : []).filter(Boolean) as string[];
  if (sids.length === 0) return res.status(400).json({ message: "Missing callSid/callSids" });

  const results: HangResult[] = [];
  for (const sid of sids) {
    const r = await endBySid(sid);
    results.push(r);
  }

  const allOk = results.every(r => r.ok);
  const payload = { success: allOk, results };

  try {
    const summary = results.map(r => `${r.sid}:${r.previousStatus}->${r.finalStatus}${r.ok ? "" : "(err)"}`).join(", ");
    console.log("🔴 hangup results:", summary);
  } catch {}

  return res.status(allOk ? 200 : 207).json(payload);
}
