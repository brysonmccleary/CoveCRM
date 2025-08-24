// /pages/api/a2p/status.ts
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
  | "start_profile"
  | "submit_brand"
  | "brand_pending"
  | "submit_campaign"
  | "campaign_pending"
  | "create_messaging_service"
  | "ready";

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
        nextAction: "start_profile" as NextAction,
        messagingReady: false,
        registrationStatus: "not_started",
        brand: { sid: null, status: "unknown" },
        campaign: { sid: null, status: "unknown" },
        messagingServiceSid: null,
        canSendSms: false,
        senders: [],
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
        // keep previous
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

    // --- Fetch senders attached to the Messaging Service (phone numbers) ---
    let senders: Array<{
      phoneNumberSid: string;
      phoneNumber?: string | null;
      attached: boolean;
      a2pReady: boolean;
    }> = [];

    if (a2p.messagingServiceSid) {
      try {
        const attached = await client.messaging.v1
          .services(a2p.messagingServiceSid)
          .phoneNumbers.list({ limit: 100 });

        // Map PN sid → phone number string
        const pnSids = attached.map((p: any) => p.phoneNumberSid).filter(Boolean);
        if (pnSids.length) {
          // Fetch each IncomingPhoneNumber for its E.164 string
          const pnDetailPromises = pnSids.map((sid) =>
            client.incomingPhoneNumbers(sid).fetch().then(
              (d) => ({ sid, phoneNumber: (d as any).phoneNumber || null }),
              () => ({ sid, phoneNumber: null }),
            ),
          );
          const pnDetails = await Promise.all(pnDetailPromises);
          const phoneBySid = new Map(pnDetails.map((d) => [d.sid, d.phoneNumber]));

          senders = attached.map((p: any) => ({
            phoneNumberSid: p.phoneNumberSid,
            phoneNumber: phoneBySid.get(p.phoneNumberSid) ?? null,
            attached: true,
            a2pReady: Boolean(a2p.messagingReady),
          }));
        }
      } catch {
        // ignore
      }
    }

    a2p.lastSyncedAt = new Date();
    await a2p.save();

    // --- Decide next action ---
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
      senders,
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
