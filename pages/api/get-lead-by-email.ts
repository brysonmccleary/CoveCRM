// /pages/api/get-lead-by-email.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const { email } = req.query;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ message: "Missing email" });
  }

  await dbConnect();
  const owner = session.user.email.trim();
  const ownerExact = new RegExp(`^${escapeRegExp(owner)}$`, "i");
  const lead = await Lead.findOne({
    email,
    $or: [{ userEmail: ownerExact }, { ownerEmail: ownerExact }, { user: ownerExact }],
  });

  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  res.status(200).json({ lead });
}
