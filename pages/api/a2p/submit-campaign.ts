// /pages/api/a2p/submit-campaign.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const APPROVED = new Set(["approved", "verified", "active", "in_use", "registered"]);

type Body = {
  useCase?: string; // e.g. "LOW_VOLUME" | "MIXED" | "MARKETING" ...
  messageFlow?: string; // override flow text (else use optInDetails)
  sampleMessages?: string[]; // override samples (else use stored)
  hasEmbeddedLinks?: boolean;
  hasEmbeddedPhone?: boolean;
  subscriberOptIn?: boolean;
  ageGated?: boolean;
  directLending?: boolean;
};

function buildCampaignDescription(opts: {
  businessName: string;
  useCase: string;
  messageFlow: string;
}): string {
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

  if (desc.length > 1024) desc = desc.slice(0, 1024);
  if (desc.length < 40) {
    desc +=
      " This campaign sends compliant follow-up and reminder messages to warm leads.";
  }

  return desc;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

    await mongooseConnect();

    const user = await User.findOne({ email: session.user.email }).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    const a2p = await A2PProfile.findOne({ userId: String((user as any)._id) });
    if (!a2p) {
      return res
        .status(400)
        .json({ message: "A2P profile not found—call /api/a2p/start first." });
    }

    if (!a2p.brandSid) return res.status(400).json({ message: "Brand not created yet." });
    if (!a2p.messagingServiceSid) {
      return res.status(400).json({ message: "Messaging Service missing. Re-run /api/a2p/start." });
    }

    // ✅ CRITICAL: use the user's scoped Twilio client (subaccount/personal/platform routing)
    let client: any;
    let twilioAccountSidUsed = "";
    try {
      const resolved = await getClientForUser(String((user as any).email));
      client = resolved.client as any;
      twilioAccountSidUsed = resolved.accountSid;
    } catch (e: any) {
      return res.status(400).json({
        message:
          e?.message ||
          "Twilio is not connected for this user. Missing subaccount SID or platform credentials.",
      });
    }

    const body = (req.body || {}) as Body;

    const useCase = body.useCase || (a2p as any).usecaseCode || "LOW_VOLUME";

    const storedSamples =
      (a2p as any).sampleMessagesArr && (a2p as any).sampleMessagesArr.length
        ? (a2p as any).sampleMessagesArr
        : String(a2p.sampleMessages || "")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);

    const messageSamples =
      body.sampleMessages && body.sampleMessages.length > 0 ? body.sampleMessages : storedSamples;

    if (!messageSamples || messageSamples.length < 2) {
      return res.status(400).json({ message: "Please provide at least 2 sample messages." });
    }

    const messageFlow =
      (body.messageFlow && body.messageFlow.trim()) || String(a2p.optInDetails || "").trim();

    if (!messageFlow) {
      return res.status(400).json({ message: "Missing message flow (opt-in details)." });
    }

    const description = buildCampaignDescription({
      businessName: String(a2p.businessName || ""),
      useCase,
      messageFlow,
    });

    const createPayload: any = {
      brandRegistrationSid: a2p.brandSid,
      usAppToPersonUsecase: useCase,
      description,
      messageFlow,
      messageSamples,
      hasEmbeddedLinks: typeof body.hasEmbeddedLinks === "boolean" ? body.hasEmbeddedLinks : true,
      hasEmbeddedPhone: typeof body.hasEmbeddedPhone === "boolean" ? body.hasEmbeddedPhone : false,
      subscriberOptIn: typeof body.subscriberOptIn === "boolean" ? body.subscriberOptIn : true,
      ageGated: typeof body.ageGated === "boolean" ? body.ageGated : false,
      directLending: typeof body.directLending === "boolean" ? body.directLending : false,
    };

    // ✅ Additive: persist last submitted campaign inputs for auditing/debug
    try {
      (a2p as any).lastSubmittedAt = new Date();
      (a2p as any).lastSubmittedUseCase = useCase;
      (a2p as any).lastSubmittedOptInDetails = messageFlow;
      (a2p as any).lastSubmittedSampleMessages = messageSamples;
      (a2p as any).twilioAccountSidUsed = twilioAccountSidUsed;
      (a2p as any).lastSyncedAt = new Date();
      await (a2p as any).save();
    } catch {
      // If schema is strict and drops fields, it's fine — core flow still works.
    }

    if ((a2p as any).usecaseCode !== useCase) {
      (a2p as any).usecaseCode = useCase;
      await (a2p as any).save();
    }

    let campaignSid = (a2p as any).usa2pSid || (a2p as any).campaignSid;

    if (campaignSid) {
      try {
        const updated = await (client as any).messaging.v1
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
          });

        const status = (updated as any).status || (updated as any).state || "unknown";
        (a2p as any).usa2pSid = campaignSid;
        (a2p as any).registrationStatus = APPROVED.has(String(status).toLowerCase())
          ? "campaign_approved"
          : "campaign_submitted";
        (a2p as any).messagingReady = APPROVED.has(String(status).toLowerCase());
        (a2p as any).lastSyncedAt = new Date();

        (a2p as any).sampleMessagesArr = messageSamples;
        (a2p as any).sampleMessages = messageSamples.join("\n\n");
        await (a2p as any).save();

        return res.status(200).json({
          ok: true,
          action: "updated",
          campaign: { sid: campaignSid, status },
          messagingReady: (a2p as any).messagingReady,
          twilioAccountSidUsed,
        });
      } catch (e) {
        campaignSid = undefined as any;
      }
    }

    const created = await (client as any).messaging.v1
      .services(a2p.messagingServiceSid)
      .usAppToPerson.create(createPayload);

    const newSid = (created as any).sid || (created as any).campaignId || (created as any).campaign_id;
    const status = (created as any).status || (created as any).state || "unknown";

    await A2PProfile.updateOne(
      { _id: (a2p as any)._id },
      {
        $set: {
          usa2pSid: newSid,
          messagingServiceSid: a2p.messagingServiceSid,
          registrationStatus: APPROVED.has(String(status).toLowerCase())
            ? "campaign_approved"
            : "campaign_submitted",
          messagingReady: APPROVED.has(String(status).toLowerCase()),
          lastSyncedAt: new Date(),
          sampleMessagesArr: messageSamples,
          sampleMessages: messageSamples.join("\n\n"),
          usecaseCode: useCase,

          // additive audit fields (safe even if schema drops them)
          lastSubmittedAt: new Date(),
          lastSubmittedUseCase: useCase,
          lastSubmittedOptInDetails: messageFlow,
          lastSubmittedSampleMessages: messageSamples,
          twilioAccountSidUsed,
        },
      }
    );

    return res.status(200).json({
      ok: true,
      action: "created",
      campaign: { sid: newSid, status },
      messagingReady: APPROVED.has(String(status).toLowerCase()),
      twilioAccountSidUsed,
    });
  } catch (err: any) {
    console.error("A2P submit-campaign error:", err);
    return res.status(500).json({ message: err?.message || "Failed to submit campaign" });
  }
}
