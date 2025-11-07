// /pages/api/twilio/connect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { provisionUserTwilio } from "@/lib/twilio/provision";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ ok: false, message: "Unauthorized" });

  try {
    await dbConnect();
    const email = session.user.email.toLowerCase().trim();
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    // Idempotent: safe to call repeatedly
    const result = await provisionUserTwilio(email);
    if (!result.ok) return res.status(200).json(result);

    return res.status(200).json({
      ok: true,
      message: "Twilio ready",
      data: result.data,
    });
  } catch (err: any) {
    console.error("twilio/connect error:", err?.message || err);
    // Always return 200 with ok:false so clients can safely ignore retries
    return res.status(200).json({ ok: false, message: "Provisioning failed", error: err?.message || String(err) });
  }
}
