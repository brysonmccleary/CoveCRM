// pages/api/team/members.ts
// GET  — list team members for the current user
// DELETE /?memberEmail=xxx — remove a team member
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import TeamMember from "@/models/TeamMember";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const ownerEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    const members = await TeamMember.find({ ownerEmail, status: "active" })
      .sort({ joinedAt: -1 })
      .lean();
    return res.status(200).json({ members });
  }

  if (req.method === "DELETE") {
    const { memberEmail } = req.query as { memberEmail?: string };
    if (!memberEmail) return res.status(400).json({ error: "memberEmail required" });
    await TeamMember.updateOne(
      { ownerEmail, memberEmail: memberEmail.toLowerCase() },
      { $set: { status: "removed" } }
    );
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
