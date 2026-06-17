// /pages/api/twilio/calls/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Make the type explicit so TS knows session?.user exists
  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const email = String(session?.user?.email || "");
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const sid = String(req.query.sid || "").trim();
  const manual = String(req.query.manual || "").trim() === "1";
  if (!sid && !manual) return res.status(400).json({ error: "Missing sid" });

  try {
    if (manual) {
      await dbConnect();

      const leadId = String(req.query.leadId || "").trim();
      const to = String(req.query.to || "").trim();
      const from = String(req.query.from || "").trim();
      const sinceMs = Number(String(req.query.since || ""));
      const createdAtFloor = Number.isFinite(sinceMs) && sinceMs > 0
        ? new Date(Math.max(0, sinceMs - 2 * 60 * 1000))
        : new Date(Date.now() - 10 * 60 * 1000);

      const query: Record<string, any> = {
        userEmail: email.toLowerCase(),
        billingCategory: "manual_dial",
        legType: "pstn",
        createdAt: { $gte: createdAtFloor },
      };

      if (leadId) {
        query.leadId = leadId;
      } else {
        if (to) query.to = to;
        if (from) query.from = from;
      }

      if (!leadId && !to) {
        return res.status(200).json({ sid: "", status: "unknown", source: "manual-pstn", matched: false });
      }

      const c = await (Call as any)
        .findOne(query)
        .sort({ firstManualPstnCallbackAt: -1, updatedAt: -1, createdAt: -1 })
        .lean();

      res.setHeader("Cache-Control", "no-store");
      if (!c) {
        return res.status(200).json({ sid: "", status: "unknown", source: "manual-pstn", matched: false });
      }

      return res.status(200).json({
        sid: c.callSid,
        callSid: c.callSid,
        pstnCallSid: c.pstnCallSid || c.callSid,
        status: c.status || "unknown",
        direction: c.direction || "outbound",
        duration: typeof c.durationSec === "number" ? c.durationSec : typeof c.duration === "number" ? c.duration : null,
        to: c.to,
        from: c.from,
        leadId: c.leadId ? String(c.leadId) : "",
        billingCategory: c.billingCategory || "",
        legType: c.legType || "",
        source: "manual-pstn",
        matched: true,
      });
    }

    const { client } = await getClientForUser(email);
    const c = await client.calls(sid).fetch();
    // c.status: queued | ringing | in-progress | completed | busy | failed | no-answer | canceled
    // c.answeredBy may exist if AMD was used; null otherwise.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      sid: c.sid,
      status: c.status,
      direction: c.direction,
      answeredBy: (c as any).answeredBy || null,
      startTime: c.startTime || null,
      endTime: c.endTime || null,
      duration: typeof c.duration === "number" ? c.duration : null,
      to: c.to,
      from: c.from,
    });
  } catch (e: any) {
    // Keep 200 so the poller isn’t fatal on transient errors
    return res.status(200).json({ sid, status: "unknown", error: e?.message || "fetch failed" });
  }
}
