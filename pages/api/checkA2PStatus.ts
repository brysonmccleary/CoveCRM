import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import A2PVerification from "@/models/A2PVerification";
import { Twilio } from "twilio";

const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await dbConnect();
    const pendingVerifications = await A2PVerification.find({
      status: "pending",
    });

    for (const verification of pendingVerifications) {
      const brandSid = verification.brandSid;
      const campaignSid = verification.campaignSid;

      let brandStatus = "unknown";
      try {
        const brand = await twilioClient.trusthub.v1
          .customerProfiles(brandSid)
          .fetch();
        brandStatus = brand.status || "unknown";
      } catch (error) {
        console.error(`Error fetching brand ${brandSid}:`, error);
      }

      let campaignStatus = "unknown";
      try {
        const campaign = await twilioClient.messaging.v1.a2p
          .services(campaignSid)
          .fetch();
        campaignStatus = campaign.status || "unknown";
      } catch (error) {
        console.error(`Error fetching campaign ${campaignSid}:`, error);
      }

      if (brandStatus === "approved" && campaignStatus === "approved") {
        verification.status = "approved";
      } else if (brandStatus === "rejected" || campaignStatus === "rejected") {
        verification.status = "rejected";
      }

      verification.lastChecked = new Date();
      await verification.save();
    }

    res.status(200).json({ message: "Statuses checked and updated" });
  } catch (error) {
    console.error("Error checking A2P statuses:", error);
    res.status(500).json({ message: "Server error" });
  }
}
