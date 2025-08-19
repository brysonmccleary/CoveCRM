// pages/api/a2p/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import twilio from "twilio";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);

const APPROVED = new Set([
  "approved",
  "verified",
  "active",
  "in_use",
  "registered",
]);
const PENDING = new Set([
  "pending",
  "submitted",
  "under_review",
  "pending-review",
  "in_progress",
]);

type NextAction =
  | "start_profile" // user hasn't started A2P flow
  | "submit_brand" // we have secondary profile, need brand
  | "brand_pending" // brand submitted, waiting
  | "submit_campaign" // brand approved, need campaign
  | "campaign_pending" // campaign submitted, waiting
  | "create_messaging_service" // approved but no MS yet (edge)
  | "ready"; // fully ready to send SMS

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  try {
    await mongooseConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const a2p = await A2PProfile.findOne({ userId: String(user._id) });
    if (!a2p) {
      return res.status(200).json({
        // No doc yet means they haven't started
        nextAction: "start_profile" as NextAction,
        messagingReady: false,
        registrationStatus: "not_started",
        brand: { sid: null, status: "unknown" },
        campaign: { sid: null, status: "unknown" },
        messagingServiceSid: null,
        canSendSms: false,
      });
    }

    // --- Pull fresh statuses from Twilio where possible ---
    let brandStatus = "unknown";
    if (a2p.brandSid) {
      try {
        const brand = await client.messaging.v1
          .brandRegistrations(a2p.brandSid)
          .fetch();
        brandStatus = (brand as any).status || brandStatus;
        if (APPROVED.has(brandStatus.toLowerCase())) {
          a2p.registrationStatus = "brand_approved";
        } else if (PENDING.has(brandStatus.toLowerCase())) {
          a2p.registrationStatus = "brand_submitted";
        }
      } catch {
        // keep previous status
      }
    }

    let campaignStatus = "unknown";
    const campaignSid = (a2p as any).usa2pSid || a2p.campaignSid;
    if (a2p.messagingServiceSid && campaignSid) {
      try {
        const camp = await client.messaging.v1
          .services(a2p.messagingServiceSid)
          .usAppToPerson(campaignSid)
          .fetch();
        campaignStatus =
          (camp as any).status || (camp as any).state || campaignStatus;

        if (APPROVED.has(String(campaignStatus).toLowerCase())) {
          a2p.registrationStatus = "campaign_approved";
          a2p.messagingReady = true;
        } else if (PENDING.has(String(campaignStatus).toLowerCase())) {
          a2p.registrationStatus = "campaign_submitted";
        }
      } catch {
        // leave as-is
      }
    }

    await a2p.save();

    // --- Decide nextAction for the UI ---
    let nextAction: NextAction = "ready";

    if (!a2p.profileSid) {
      nextAction = "start_profile";
    } else if (!a2p.brandSid) {
      nextAction = "submit_brand";
    } else if (a2p.brandSid && !APPROVED.has(brandStatus.toLowerCase())) {
      nextAction = "brand_pending";
    } else if (!campaignSid) {
      nextAction = "submit_campaign";
    } else if (
      campaignSid &&
      !APPROVED.has(String(campaignStatus).toLowerCase())
    ) {
      nextAction = "campaign_pending";
    } else if (!a2p.messagingServiceSid) {
      nextAction = "create_messaging_service";
    } else {
      nextAction = "ready";
    }

    const canSendSms = Boolean(a2p.messagingReady && a2p.messagingServiceSid);

    return res.status(200).json({
      nextAction,
      registrationStatus: a2p.registrationStatus || "unknown",
      messagingReady: Boolean(a2p.messagingReady),
      canSendSms,
      brand: { sid: a2p.brandSid || null, status: brandStatus },
      campaign: { sid: campaignSid || null, status: campaignStatus },
      messagingServiceSid: a2p.messagingServiceSid || null,
      // Optional hints your UI can show:
      hints: {
        hasProfile: Boolean(a2p.profileSid),
        hasBrand: Boolean(a2p.brandSid),
        hasCampaign: Boolean(campaignSid),
        hasMessagingService: Boolean(a2p.messagingServiceSid),
      },
    });
  } catch (err: any) {
    console.error("A2P status error:", err);
    return res
      .status(500)
      .json({ message: err?.message || "Failed to fetch A2P status" });
  }
}
