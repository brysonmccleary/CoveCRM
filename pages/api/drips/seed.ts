// /pages/api/drips/seed.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";
import { prebuiltDrips } from "@/utils/prebuiltDrips";

/**
 * SAFE SEED ENDPOINT (HARDENED)
 *
 * What it does:
 * - Ensures the *global prebuilt* drip campaigns exist in MongoDB.
 * - Updates them by name if they already exist.
 *
 * What it will NEVER do:
 * - It will NEVER delete user/custom drips.
 * - It will NEVER wipe the entire DripCampaign collection.
 *
 * How to run (dev only):
 * - Set env: ALLOW_DRIPS_SEED=true
 * - Set env: DRIPS_SEED_TOKEN=<long-random>
 * - Call: POST /api/drips/seed?token=<DRIPS_SEED_TOKEN>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ✅ Require POST (no accidental GET in browser)
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  // ✅ Hard disable unless explicitly allowed
  const allow = String(process.env.ALLOW_DRIPS_SEED || "").toLowerCase();
  const isAllowed = ["1", "true", "yes"].includes(allow);
  if (!isAllowed) {
    return res.status(403).json({
      error: "Seed disabled",
      detail:
        "This endpoint is disabled unless ALLOW_DRIPS_SEED=true is set in env (dev only).",
    });
  }

  // ✅ Require token
  const expectedToken = String(process.env.DRIPS_SEED_TOKEN || "");
  const token = String(req.query.token || "");
  if (!expectedToken || token !== expectedToken) {
    return res.status(403).json({
      error: "Forbidden",
      detail:
        "Missing/invalid token. Provide ?token=... and set DRIPS_SEED_TOKEN in env.",
    });
  }

  await dbConnect();

  try {
    // Transform each drip from prebuilt format -> DB format
    const formattedDrips = prebuiltDrips.map((drip: any) => ({
      name: drip.name,
      type: drip.type, // e.g., "sms"
      isActive: true,
      isGlobal: true,
      assignedFolders: [],
      steps: (drip.messages || []).map((msg: any) => ({
        text: msg.text,
        day: String(msg.day ?? ""),
        time: "9:00 AM",
        calendarLink: "",
        views: 0,
        responses: 0,
      })),
      analytics: {
        views: 0,
        clicks: 0,
        replies: 0,
        unsubscribes: 0,
      },
      createdBy: "admin",
      comments: [],
      // NOTE: do NOT set user/userEmail on globals
      user: undefined,
      userEmail: undefined,
    }));

    // ✅ Upsert by (isGlobal + name) so we only touch global prebuilt drips
    let upserted = 0;
    for (const doc of formattedDrips) {
      await DripCampaign.updateOne(
        { isGlobal: true, name: doc.name },
        { $set: doc },
        { upsert: true }
      );
      upserted++;
    }

    // ✅ Optional: remove *only* global drips that no longer exist in prebuilt list
    // This is still safe: it only touches isGlobal: true
    const names = formattedDrips.map((d) => d.name);
    const removed = await DripCampaign.deleteMany({
      isGlobal: true,
      name: { $nin: names },
    });

    return res.status(200).json({
      message: "Global prebuilt drips seeded safely",
      upserted,
      removedGlobalNotInPrebuilt: removed?.deletedCount || 0,
      note:
        "User/custom drips were not touched. This endpoint never wipes the collection.",
    });
  } catch (error: any) {
    console.error("[drips/seed] error", error);
    return res.status(500).json({ error: "Seeding failed" });
  }
}
