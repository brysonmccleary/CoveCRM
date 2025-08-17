import dbConnect from "@/lib/dbConnect";
import DripCampaign from "@/models/DripCampaign";
import { prebuiltDrips } from "@/utils/prebuiltDrips";

export default async function handler(req, res) {
  await dbConnect();

  try {
    // Clear existing drips to avoid duplicates
    await DripCampaign.deleteMany({});

    // Transform each drip
    const formattedDrips = prebuiltDrips.map((drip) => ({
      name: drip.name,
      type: drip.type,
      isActive: true,
      assignedFolders: [],
      steps: drip.messages.map((msg) => ({
        text: msg.text,
        day: msg.day,
        time: "9:00 AM",       // Default
        calendarLink: "",      // Default
        views: 0,              // Default
        responses: 0           // Default
      })),
      analytics: {
        views: 0,
        clicks: 0,
        replies: 0,
        unsubscribes: 0
      },
      createdBy: "admin",
      comments: []
    }));

    // Insert all drips
    await DripCampaign.insertMany(formattedDrips);

    res.status(200).json({ message: "Seeded successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Seeding failed" });
  }
}
