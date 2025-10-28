// pages/api/drips/campaigns.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";

/**
 * Returns all SMS drip campaigns visible to the current user:
 *  - User-scoped campaigns (some codebases use `user`, others `userEmail`)
 *  - Any global campaigns (`isGlobal: true`)
 *
 * Query params:
 *  - active=1   -> only return isActive === true
 *
 * Response shape matches your current UI expectations:
 *   { campaigns: [{ _id, name, key, isActive }] }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Cast to any to avoid TS mismatch with your next-auth typing
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    await dbConnect();

    const activeOnly = ["1", "true", "yes"].includes(String(req.query.active || "").toLowerCase());

    // Respect multi-tenant scoping AND include any global campaigns.
    // Some installs store the owner field as `user`, others as `userEmail`.
    const scopeOr = [
      { user: session.user.email },
      { userEmail: session.user.email },
      { isGlobal: true },
    ];

    const query: any = {
      type: "sms",
      $or: scopeOr,
    };
    if (activeOnly) query.isActive = true;

    const campaigns = await DripCampaign.find(query)
      .select({ _id: 1, name: 1, key: 1, isActive: 1 })
      .sort({ name: 1 })
      .lean();

    // Keep the exact shape your Lead UI expects.
    return res.status(200).json({
      campaigns: campaigns.map((c) => ({
        _id: String(c._id),
        name: c.name,
        key: c.key,
        isActive: Boolean(c.isActive),
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}
