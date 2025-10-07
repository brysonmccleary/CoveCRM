// pages/api/messages/mark-read.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import Message from "@/models/Message";
import { emitToUser } from "@/lib/socket";

/**
 * Marks all UNREAD inbound messages in a thread as read for the current user.
 * Body: { leadId: string }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const session = await getServerSession(req, res, authOptions);
    const userEmail = (session?.user?.email || "").toLowerCase();
    if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

    const { leadId } = req.body as { leadId?: string };
    if (!leadId) return res.status(400).json({ error: "Missing leadId" });

    await dbConnect();

    const result = await Message.updateMany(
      { userEmail, leadId, direction: "inbound", read: { $ne: true } },
      { $set: { read: true } }
    );

    // Fire a real-time event so badges/sidebars update instantly.
    // Safe no-op if socket server isn't initialized.
    emitToUser(userEmail, "message:read", { leadId, modified: result.modifiedCount });

    return res.status(200).json({ ok: true, modified: result.modifiedCount });
  } catch (err) {
    console.error("mark-read error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
