import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { sendSMS } from "@/lib/twilio/sendSMS";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { to, body } = (req.body || {}) as { to?: string; body?: string };
  if (!to || !body) return res.status(400).json({ error: "Missing 'to' or 'body'" });

  try {
    const r = await sendSMS(to, body, session.user.email);
    return res.status(200).json({ ok: true, ...r });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "send failed" });
  }
}
