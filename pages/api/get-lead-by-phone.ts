// /pages/api/get-lead-by-phone.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { phone } = req.query;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ message: "Missing phone number" });
  }

  await dbConnect();
  const lead = await Lead.findOne({ phone });

  if (!lead) {
    return res.status(404).json({ message: "Lead not found" });
  }

  res.status(200).json({ lead });
}
