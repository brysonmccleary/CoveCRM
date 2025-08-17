// /pages/api/leads/callback-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import Lead from "@/models/Lead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ message: "Method Not Allowed" });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  await dbConnect();

  try {
    const lead = await Lead.findOne({
      userEmail,
      isInboundCallback: true,
      callbackNotified: false,
    });

    if (!lead) {
      res.status(204).end(); // No banner should show
      return;
    }

    lead.callbackNotified = true;
    await lead.save();

    res.status(200).json({ lead });
    return;
  } catch (err) {
    console.error("❌ Error fetching callback lead:", err);
    res.status(500).json({ message: "Internal Server Error" });
    return;
  }
}
