// pages/api/internal/warm-dialer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
    const email = String(session?.user?.email ?? "").toLowerCase();
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    // ✅ Warm DB connection
    await dbConnect();

    // ✅ Warm Twilio selection path (does NOT place any calls)
    // This should be cheap: it loads user config + constructs a client.
    await getClientForUser(email);

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    // best-effort warmup; never break UX
    return res.status(200).json({ ok: false, message: e?.message || "warmup failed" });
  }
}
