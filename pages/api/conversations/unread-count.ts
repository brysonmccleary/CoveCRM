// pages/api/conversations/unread-count.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import Message from "@/models/Message";

/**
 * Returns the EXACT number of unread inbound messages for the current user.
 * Multi-tenant safe via session.user.email.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const userEmail = (session?.user?.email || "").toLowerCase();

    // If no session/user, just say "0 unread" instead of throwing 401s into logs.
    if (!userEmail) {
      return res.status(200).json({ count: 0 });
    }

    await dbConnect();

    // Count ONLY inbound, unread messages for this user
    const count = await Message.countDocuments({
      userEmail,
      direction: "inbound",
      read: { $ne: true },
    });

    return res.status(200).json({ count });
  } catch (err) {
    console.error("Unread count error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
