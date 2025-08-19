// /pages/api/get-leads.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await dbConnect();

    const leads = await Lead.find({ userEmail: session.user.email }).sort({
      createdAt: -1,
    });

    const formattedLeads = leads.map((lead) => ({
      id: lead._id.toString(),
      ...lead.toObject(),
    }));

    res.status(200).json({ leads: formattedLeads });
  } catch (error) {
    console.error("Get leads error:", error);
    res.status(500).json({ message: "Server error" });
  }
}
