import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { syncA2PForUser } from "@/lib/twilio/syncA2P";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    await mongooseConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const updated = await syncA2PForUser(user as any);

    // Return minimal payload for UI
    return res.status(200).json({
      success: true,
      messagingReady: Boolean(updated.a2p?.messagingReady),
      a2p: updated.a2p,
      numbers: updated.numbers?.map((n) => ({
        sid: n.sid,
        phoneNumber: n.phoneNumber,
        messagingServiceSid: n.messagingServiceSid,
        status: n.status,
        capabilities: n.capabilities,
      })),
      numbersLastSyncedAt: updated.numbersLastSyncedAt,
    });
  } catch (e: any) {
    console.error("sync-a2p failed:", e);
    return res
      .status(500)
      .json({ error: e?.message || "Failed to sync A2P status" });
  }
}
