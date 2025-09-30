// /pages/api/drips/seed.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";
import { prebuiltDrips } from "@/utils/prebuiltDrips";

/**
 * Ensure that every user has all prebuilt drips automatically.
 * - Runs idempotently per userEmail (no duplicates).
 * - Never deletes other campaigns.
 * - Scopes each campaign to the user.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const session = await getServerSession(req, res, authOptions as any);
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await dbConnect();
    const userEmail = session.user.email;

    const results: any[] = [];

    for (const drip of prebuiltDrips) {
      const existing = await DripCampaign.findOne({
        user: userEmail,
        key: drip.id, // use the prebuilt id as a stable key
      });

      if (existing) {
        results.push({ name: drip.name, status: "exists" });
        continue;
      }

      const campaign = await DripCampaign.create({
        name: drip.name,
        key: drip.id,
        type: drip.type,
        isActive: true,
        isGlobal: false, // scoped to user, not global
        assignedFolders: [],
        steps: (drip.messages || []).map((msg: any) => ({
          text: msg.text,
          day: String(msg.day ?? ""),
          time: "9:00 AM",
          calendarLink: "",
          views: 0,
          responses: 0,
        })),
        analytics: { views: 0, clicks: 0, replies: 0, unsubscribes: 0 },
        createdBy: "system",
        comments: [],
        user: userEmail,
      });

      results.push({ name: campaign.name, status: "created" });
    }

    return res.status(200).json({
      message: "Prebuilt drips ensured for user",
      userEmail,
      results,
    });
  } catch (err: any) {
    console.error("seed error", err);
    return res.status(500).json({ error: "Failed to seed drips", detail: err?.message });
  }
}
