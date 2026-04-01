// pages/api/settings/recruiting-sender.ts
// GET/POST recruiting email sender fields (recruitingFromName, recruitingFromEmail) on User model.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    const user = await User.findOne({ email: userEmail })
      .select("recruitingFromName recruitingFromEmail")
      .lean() as any;
    return res.status(200).json({
      fromName: user?.recruitingFromName || "",
      fromEmail: user?.recruitingFromEmail || "",
    });
  }

  if (req.method === "POST") {
    const { fromName, fromEmail } = req.body || {};
    if (!fromName || !fromEmail) {
      return res.status(400).json({ error: "fromName and fromEmail are required" });
    }
    await User.updateOne(
      { email: userEmail },
      { $set: { recruitingFromName: String(fromName).trim(), recruitingFromEmail: String(fromEmail).trim().toLowerCase() } }
    );
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
