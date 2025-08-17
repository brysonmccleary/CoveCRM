import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import Lead from "@/models/Lead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    await dbConnect();

    const count = await Lead.countDocuments({
      userEmail: session.user.email,
      unreadMessages: true,
    });

    res.status(200).json({ count });
  } catch (err) {
    console.error("Unread count error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
