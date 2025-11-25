// /pages/api/set-a2p-state.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

/**
 * Securely set the current user's A2P state (for linking an already-approved setup).
 * POST body example:
 * {
 *   "a2p": {
 *     "messagingServiceSid": "MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
 *     "brandSid": "BNxxxxxxxxxxxxxxxxxxxxxxxxxxxx",         // optional
 *     "campaignSid": "CExxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",    // optional
 *     "brandStatus": "APPROVED",                           // optional
 *     "campaignStatus": "ACTIVE",                          // optional
 *     "messagingReady": true
 *   }
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const email = session.user.email.toLowerCase();

  const { a2p } = (req.body || {}) as {
    a2p?: {
      messagingServiceSid?: string;
      brandSid?: string;
      campaignSid?: string;
      brandStatus?: string;
      campaignStatus?: string;
      messagingReady?: boolean;
    };
  };

  if (!a2p?.messagingServiceSid) {
    return res.status(400).json({ error: "Missing a2p.messagingServiceSid (MG…)" });
  }

  try {
    await dbConnect();
    const update: Record<string, any> = {
      "a2p.messagingServiceSid": a2p.messagingServiceSid,
      "a2p.messagingReady": a2p.messagingReady === false ? false : true,
      "a2p.lastSyncedAt": new Date(),
    };
    if (a2p.brandSid) update["a2p.brandSid"] = a2p.brandSid;
    if (a2p.campaignSid) update["a2p.campaignSid"] = a2p.campaignSid;
    if (a2p.brandStatus) update["a2p.brandStatus"] = a2p.brandStatus;
    if (a2p.campaignStatus) update["a2p.campaignStatus"] = a2p.campaignStatus;

    const r = await User.updateOne({ email }, { $set: update });
    return res.status(200).json({
      ok: true,
      matched: r.matchedCount,
      modified: r.modifiedCount,
      a2p: update,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "set-a2p-state failed" });
  }
}
