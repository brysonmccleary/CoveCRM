// pages/api/email/smtp-status.ts
// Returns whether the agent has a verified SMTP connection.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import AgentEmailAccount from "@/models/AgentEmailAccount";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();

  await mongooseConnect();

  const user = await User.findOne({ email: userEmail }).select("_id").lean();
  if (!user?._id) return res.status(404).json({ error: "User not found" });

  const account = await AgentEmailAccount.findOne({ userId: user._id, active: true })
    .select("fromName fromEmail smtpHost isVerified verifiedAt lastUsedAt")
    .lean() as any;

  if (!account) {
    return res.status(200).json({ connected: false });
  }

  return res.status(200).json({
    connected: true,
    isVerified: account.isVerified,
    fromName: account.fromName,
    fromEmail: account.fromEmail,
    smtpHost: account.smtpHost,
    verifiedAt: account.verifiedAt,
    lastUsedAt: account.lastUsedAt,
  });
}
