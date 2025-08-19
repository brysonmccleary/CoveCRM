// /pages/api/drips/seed.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";
import { prebuiltDrips } from "@/utils/prebuiltDrips";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Optionally restrict to POST in prod
  // if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  await dbConnect();

  try {
    // Clear existing drips to avoid duplicates
    await DripCampaign.deleteMany({});

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
        time: "9:00 AM", // default send time
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
    }));

    // Insert all drips
    await DripCampaign.insertMany(formattedDrips);

    res.status(200).json({ message: "Seeded successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Seeding failed" });
  }
}
