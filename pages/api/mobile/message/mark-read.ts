// pages/api/mobile/messages/mark-read.ts
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import dbConnect from "@/lib/dbConnect";
import Message from "@/models/Message";
import { emitToUser } from "@/lib/socket";

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET || process.env.NEXTAUTH_SECRET || "dev-mobile-secret";

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const email = (payload?.email || payload?.sub || "").toString().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

/**
 * Mobile: marks all UNREAD inbound messages in a thread as read for the JWT user.
 * Body: { leadId: string }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userEmail = getEmailFromAuth(req);
    if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

    const { leadId } = req.body as { leadId?: string };
    if (!leadId) return res.status(400).json({ error: "Missing leadId" });

    await dbConnect();

    const result = await Message.updateMany(
      { userEmail, leadId, direction: "inbound", read: { $ne: true } },
      { $set: { read: true } }
    );

    // Real-time event so web badges/sidebars also update
    emitToUser(userEmail, "message:read", { leadId, modified: result.modifiedCount });

    return res.status(200).json({ ok: true, modified: result.modifiedCount });
  } catch (err) {
    console.error("mobile mark-read error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
