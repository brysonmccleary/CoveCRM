import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await dbConnect();

    const leads = await Lead.find({
      userEmail: session.user.email,
      interactionHistory: { $exists: true, $not: { $size: 0 } },
    })
      .sort({ updatedAt: -1 })
      .select("First Name Phone interactionHistory updatedAt");

    return res.status(200).json({ leads });
  } catch (error: any) {
    console.error("❌ Failed to fetch leads with messages:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
