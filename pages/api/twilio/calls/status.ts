// /pages/api/twilio/calls/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const email = String(session?.user?.email || "");
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const sid = String(req.query.sid || "").trim();
  if (!sid) return res.status(400).json({ error: "Missing sid" });

  try {
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
    // Return 200 so the front-end poller doesn't treat this as a fatal error.
    return res.status(200).json({ sid, status: "unknown", error: e?.message || "fetch failed" });
  }
}
