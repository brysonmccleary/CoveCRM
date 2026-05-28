// pages/api/team/invites.ts
// GET — list pending invites for the current team owner
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import TeamInvite from "@/models/TeamInvite";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const ownerEmail = session.user.email.toLowerCase();

  const invites = await TeamInvite.find({ ownerEmail, status: "pending" })
    .sort({ createdAt: -1 })
    .lean();

  return res.status(200).json({ invites });
}
