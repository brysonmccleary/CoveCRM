// /pages/api/checkA2PStatus.ts
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
    const pendingVerifications = await A2PVerification.find({ status: "pending" });

    for (const verification of pendingVerifications) {
      const brandSid = verification.brandSid;
      const campaignSid = verification.campaignSid;

      // --- Brand status (TrustHub) ---
      let brandStatus = "unknown";
      try {
        const brand = await twilioClient.trusthub.v1
          .customerProfiles(brandSid)
          .fetch();
        brandStatus = (brand as any)?.status || "unknown";
      } catch (error) {
        console.error(`Error fetching brand ${brandSid}:`, error);
      }

      // --- Campaign status (Messaging) ---
      let campaignStatus = "unknown";
      try {
        // Access messaging v1 as any so TS won't block us on SDK internals
        const messagingV1: any = (twilioClient as any).messaging?.v1;

        // Most installs expose campaigns under messaging.v1.campaigns
        const campaign =
          (await messagingV1?.campaigns?.(campaignSid)?.fetch?.()) ??
          // Fallbacks if SDK shape differs
          (await messagingV1?.a2p?.campaigns?.(campaignSid)?.fetch?.()) ??
          (await messagingV1?.services?.(campaignSid)?.fetch?.());

        campaignStatus =
          campaign?.status || campaign?.state || campaign?.approvalStatus || "unknown";
      } catch (error) {
        console.error(`Error fetching campaign ${campaignSid}:`, error);
      }

      if (brandStatus.toLowerCase() === "approved" && campaignStatus.toLowerCase() === "approved") {
        verification.status = "approved";
      } else if (
        brandStatus.toLowerCase() === "rejected" ||
        campaignStatus.toLowerCase() === "rejected"
      ) {
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
