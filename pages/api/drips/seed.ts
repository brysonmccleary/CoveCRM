// /pages/api/drips/seed.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";
import { prebuiltDrips } from "@/utils/prebuiltDrips";

/**
 * Ensure all prebuilt drips exist for the current user.
 * - Idempotent per user (no duplicates)
 * - Never deletes other campaigns
 * - Scopes to user via DripCampaign.user
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Session typing fix: cast to a minimal shape we actually use
    const session = (await getServerSession(
      req,
      res,
      authOptions as any
    )) as { user?: { email?: string | null } } | null;

    const userEmail = session?.user?.email || null;
    if (!userEmail) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await dbConnect();

    const results: Array<{ name: string; status: "created" | "exists" }> = [];

    for (const drip of prebuiltDrips) {
      // Use the prebuilt "id" as a stable key for idempotency
      const key = String(drip.id);

      const existing = await DripCampaign.findOne({
        user: userEmail,
        key,
      }).lean();

      if (existing) {
        results.push({ name: existing.name, status: "exists" });
        continue;
      }

      await DripCampaign.create({
        name: drip.name,
        key, // <-- stable key so we can re-run safely
        type: drip.type, // "sms" | "email"
        isActive: true,
        isGlobal: false, // per-user
        assignedFolders: [],
        steps: (drip.messages || []).map((msg: any) => ({
          text: String(msg.text ?? ""),
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

      results.push({ name: drip.name, status: "created" });
    }

    return res.status(200).json({
      message: "Prebuilt drips ensured for user",
      userEmail,
      results,
    });
  } catch (err: any) {
    console.error("seed error", err);
    return res
      .status(500)
      .json({ error: "Failed to seed drips", detail: err?.message });
  }
}
