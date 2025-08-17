import "dotenv/config";
import dbConnect from "../lib/mongooseConnect";
import DripCampaign from "../models/DripCampaign";
import { prebuiltDrips } from "../utils/prebuiltDrips";

(async () => {
  try {
    await dbConnect();

    // Remove old drips
    await DripCampaign.deleteMany({ isGlobal: true });

    // Prepare formatted drips
    const formattedDrips = prebuiltDrips.map((drip) => ({
      name: drip.name,
      type: drip.type,
      isActive: true,
      assignedFolders: [],
      steps: drip.messages.map((msg) => ({
        text: msg.text,
        day: msg.day,
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
      user: "", // optional user-specific override
      isGlobal: true, // so we can easily differentiate global drips
    }));

    await DripCampaign.insertMany(formattedDrips);

    console.log("✅ Global drip campaigns updated successfully!");
    process.exit();
  } catch (error) {
    console.error("❌ Error updating global drip campaigns:", error);
    process.exit(1);
  }
})();
