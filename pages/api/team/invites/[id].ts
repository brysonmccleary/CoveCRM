// pages/api/team/invites/[id].ts
// DELETE — cancel a pending invite (scoped to the requesting owner)
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import TeamInvite from "@/models/TeamInvite";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const ownerEmail = session.user.email.toLowerCase();
  const { id } = req.query as { id: string };

  // ownerEmail scope prevents cancelling another owner's invites
  await TeamInvite.findOneAndUpdate(
    { _id: id, ownerEmail, status: "pending" },
    { $set: { status: "expired" } }
  );

  return res.status(200).json({ ok: true });
}
