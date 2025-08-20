// /pages/api/twilio/link-a2p.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

/**
 * Link an already-verified A2P setup to the logged-in user.
 * Stores messagingServiceSid / brandSid / campaignSid and marks messagingReady=true.
 *
 * POST body:
 * {
 *   "messagingServiceSid": "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *   "brandSid": "BNxxxxxxxxxxxxxxxxxxxxxxxxxxxx",        // optional
 *   "campaignSid": "Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",    // optional
 * }
 *
 * Auth: user must be logged in. (No admin token required.)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const userEmail = session.user.email.toLowerCase();

  const { messagingServiceSid, brandSid, campaignSid } = (req.body || {}) as {
    messagingServiceSid?: string;
    brandSid?: string;
    campaignSid?: string;
  };

  if (!messagingServiceSid) {
    return res.status(400).json({ error: "Missing messagingServiceSid (MG...)" });
  }

  try {
    await dbConnect();

    const update: any = {
      "a2p.messagingServiceSid": messagingServiceSid,
      "a2p.messagingReady": true, // <-- tell the CRM we can send now
      "a2p.lastSyncedAt": new Date(),
    };
    if (brandSid) update["a2p.brandSid"] = brandSid;
    if (brandSid && !update["a2p.brandStatus"]) update["a2p.brandStatus"] = "APPROVED";
    if (campaignSid) update["a2p.campaignSid"] = campaignSid;
    if (campaignSid && !update["a2p.campaignStatus"]) update["a2p.campaignStatus"] = "ACTIVE";

    const r = await User.updateOne({ email: userEmail }, { $set: update });
    return res.status(200).json({ ok: true, matched: r.matchedCount, modified: r.modifiedCount, a2p: update });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "link-a2p failed" });
  }
}
