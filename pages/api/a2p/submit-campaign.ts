// pages/api/a2p/submit-campaign.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import twilio from "twilio";
import User from "@/models/User";
import A2PProfile, { IA2PProfile } from "@/models/A2PProfile";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);

const CRON_SECRET = process.env.CRON_SECRET || process.env.CRON_KEY || "";

const APPROVED = new Set([
  "approved",
  "verified",
  "active",
  "in_use",
  "registered",
]);

type Body = {
  useCase?: string; // e.g. "LOW_VOLUME" | "MIXED" | "MARKETING" ...
  messageFlow?: string; // override flow text (else use optInDetails)
  sampleMessages?: string[]; // override samples (else use stored)
  hasEmbeddedLinks?: boolean;
  hasEmbeddedPhone?: boolean;
  subscriberOptIn?: boolean;
  ageGated?: boolean;
  directLending?: boolean;

  // --- INTERNAL (cron) fields: NOT exposed to frontend ---
  internalUserId?: string;
  internalA2PId?: string;
};

// Ensure campaign description meets Twilio min/max length requirements
function buildCampaignDescription(opts: {
  businessName: string;
  useCase: string;
  messageFlow: string;
}: string) {
  const businessName = (opts.businessName || "").trim() || "this business";
  const useCase = (opts.useCase || "").trim() || "LOW_VOLUME";

  let desc = `Life insurance lead follow-up and appointment reminder SMS campaign for ${businessName}. Use case: ${useCase}. `;

  const flowSnippet = (opts.messageFlow || "").replace(/\s+/g, " ").trim();
  if (flowSnippet) {
    desc += `Opt-in and message flow: ${flowSnippet.slice(0, 300)}`;
  } else {
    desc +=
      "Leads opt in via TCPA-compliant web forms and receive updates about their life insurance options and booked appointments.";
  }

  // Trim to Twilio's max (safe 1024 chars)
  if (desc.length > 1024) desc = desc.slice(0, 1024);

  // Guarantee at least 40 chars
  if (desc.length < 40) {
    desc +=
      " This campaign sends compliant follow-up and reminder messages to warm leads.";
  }

  return desc;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const body = (req.body || {}) as Body;

  // Internal cron / sync caller? (bypasses session, uses CRON_SECRET)
  const isInternalCron =
    CRON_SECRET && req.headers["x-cron-key"] === CRON_SECRET;

  try {
    await mongooseConnect();

    let a2p: IA2PProfile | null = null;

    if (isInternalCron) {
      // Called from /api/a2p/sync using CRON_SECRET
      const internalA2PId = body.internalA2PId?.trim();
      const internalUserId = body.internalUserId?.trim();

      if (internalA2PId) {
        a2p = await A2PProfile.findById(internalA2PId);
      } else if (internalUserId) {
        a2p = await A2PProfile.findOne({ userId: internalUserId });
      } else {
        return res.status(400).json({
          message:
            "Internal call requires internalUserId or internalA2PId in body.",
        });
      }

      if (!a2p) {
        return res
          .status(404)
          .json({ message: "A2P profile not found for internal call." });
      }
    } else {
      // Normal user-triggered call (from dashboard)
      const session = await getServerSession(req, res, authOptions);
      if (!session?.user?.email)
        return res.status(401).json({ message: "Unauthorized" });

      const user = await User.findOne({ email: session.user.email }).lean();
      if (!user)
        return res.status(404).json({ message: "User not found" });

      a2p = await A2PProfile.findOne({
        userId: String((user as any)._id),
      });

      if (!a2p) {
        return res.status(400).json({
          message: "A2P profile not found—call /api/a2p/start first.",
        });
      }
    }

    if (!a2p.brandSid)
      return res.status(400).json({ message: "Brand not created yet." });

    // Ensure Messaging Service exists (created by /api/a2p/start)
    if (!a2p.messagingServiceSid) {
      return res.status(400).json({
        message: "Messaging Service missing. Re-run /api/a2p/start.",
      });
    }

    // prefer explicit, then stored selection from /api/a2p/start, else LOW_VOLUME
    const useCase = body.useCase || a2p.usecaseCode || "LOW_VOLUME";

    const storedSamples =
      a2p.sampleMessagesArr && a2p.sampleMessagesArr.length
        ? a2p.sampleMessagesArr
        : (a2p.sampleMessages || "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);

    const messageSamples =
      body.sampleMessages && body.sampleMessages.length > 0
        ? body.sampleMessages
        : storedSamples;

    if (!messageSamples || messageSamples.length < 2) {
      return res.status(400).json({
        message: "Please provide at least 2 sample messages.",
      });
    }

    const messageFlow =
      (body.messageFlow && body.messageFlow.trim()) ||
      (a2p.optInDetails || "").trim();

    if (!messageFlow) {
      return res
        .status(400)
        .json({ message: "Missing message flow (opt-in details)." });
    }

    const description = buildCampaignDescription({
      businessName: a2p.businessName || "",
      useCase,
      messageFlow,
    });

    const createPayload: any = {
      brandRegistrationSid: a2p.brandSid,
      usAppToPersonUsecase: useCase,
      description,
      messageFlow,
      messageSamples,
      hasEmbeddedLinks:
        typeof body.hasEmbeddedLinks === "boolean"
          ? body.hasEmbeddedLinks
          : true,
      hasEmbeddedPhone:
        typeof body.hasEmbeddedPhone === "boolean"
          ? body.hasEmbeddedPhone
          : false,
      subscriberOptIn:
        typeof body.subscriberOptIn === "boolean"
          ? body.subscriberOptIn
          : true,
      ageGated:
        typeof body.ageGated === "boolean" ? body.ageGated : false,
      directLending:
        typeof body.directLending === "boolean"
          ? body.directLending
          : false,
    };

    // Persist chosen use case if changed (for dashboard visibility + consistency)
    if (a2p.usecaseCode !== useCase) {
      a2p.usecaseCode = useCase;
      await a2p.save();
    }

    // If a campaign exists, try to update; otherwise create
    let campaignSid = (a2p as any).usa2pSid || a2p.campaignSid;

    if (campaignSid) {
      try {
        const updated = await client.messaging.v1
          .services(a2p.messagingServiceSid)
          .usAppToPerson(campaignSid)
          .update({
            messageFlow,
            messageSamples,
            hasEmbeddedLinks: createPayload.hasEmbeddedLinks,
            hasEmbeddedPhone: createPayload.hasEmbeddedPhone,
            subscriberOptIn: createPayload.subscriberOptIn,
            ageGated: createPayload.ageGated,
            directLending: createPayload.directLending,
            description: createPayload.description,
          } as any);

        const status =
          (updated as any).status || (updated as any).state || "unknown";
        const lower = String(status).toLowerCase();

        a2p.usa2pSid = campaignSid;
        a2p.registrationStatus = APPROVED.has(lower)
          ? "campaign_approved"
          : "campaign_submitted";
        a2p.messagingReady = APPROVED.has(lower);
        a2p.lastSyncedAt = new Date();

        // Keep samples in both forms for UI/API parity
        a2p.sampleMessagesArr = messageSamples;
        a2p.sampleMessages = messageSamples.join("\n\n");
        await a2p.save();

        return res.status(200).json({
          ok: true,
          action: "updated",
          campaign: { sid: campaignSid, status },
          messagingReady: a2p.messagingReady,
        });
      } catch {
        // Fall back to create if Twilio doesn’t allow updates for some fields
        campaignSid = undefined;
      }
    }

    // Create fresh campaign
    const created = await client.messaging.v1
      .services(a2p.messagingServiceSid)
      .usAppToPerson.create(createPayload);

    const newSid = (created as any).sid;
    const status =
      (created as any).status || (created as any).state || "unknown";
    const lower = String(status).toLowerCase();
    const approved = APPROVED.has(lower);

    await A2PProfile.updateOne(
      { _id: a2p._id },
      {
        $set: {
          usa2pSid: newSid,
          messagingServiceSid: a2p.messagingServiceSid,
          registrationStatus: approved
            ? "campaign_approved"
            : "campaign_submitted",
          messagingReady: approved,
          lastSyncedAt: new Date(),
          // keep samples persisted in both forms
          sampleMessagesArr: messageSamples,
          sampleMessages: messageSamples.join("\n\n"),
          // ensure stored use case is current
          usecaseCode: useCase,
        },
      },
    );

    return res.status(200).json({
      ok: true,
      action: "created",
      campaign: { sid: newSid, status },
      messagingReady: approved,
    });
  } catch (err: any) {
    console.error("A2P submit-campaign error:", err);
    return res
      .status(500)
      .json({ message: err?.message || "Failed to submit campaign" });
  }
}
