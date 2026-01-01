// /pages/api/a2p/submit-campaign.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import type { IA2PProfile } from "@/models/A2PProfile";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const baseUrl =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000";

const BRAND_OK_FOR_CAMPAIGN = new Set([
  "APPROVED",
  "ACTIVE",
  "IN_USE",
  "REGISTERED",
]);

function log(...args: any[]) {
  console.log("[A2P submit-campaign]", ...args);
}

function isSidLike(v: any, prefix: string) {
  return typeof v === "string" && v.startsWith(prefix);
}

function isTwilioNotFound(err: any): boolean {
  const code = Number(err?.code);
  const status = Number(err?.status);
  const message = String(err?.message || "");
  return (
    code === 20404 ||
    status === 404 ||
    /20404/.test(message) ||
    /not found/i.test(message)
  );
}

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

function parseSamplesFromProfile(a2p: IA2PProfile): string[] {
  if (Array.isArray(a2p.sampleMessagesArr) && a2p.sampleMessagesArr.length) {
    return a2p.sampleMessagesArr.map((s) => String(s).trim()).filter(Boolean);
  }
  const raw = String(a2p.sampleMessages || "");
  const samples = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  // You were joining them with \n\n in start.ts; this keeps it tolerant.
  return samples.length >= 2 ? samples : raw.split("\n\n").map((s) => s.trim()).filter(Boolean);
}

async function ensureMessagingService(args: {
  client: any;
  userId: string;
  userEmail: string;
  a2pId: string;
}): Promise<string> {
  const { client, userId, userEmail, a2pId } = args;

  const live = await A2PProfile.findOne({ userId }).lean<any>();
  if (live?.messagingServiceSid) {
    try {
      await client.messaging.v1.services(live.messagingServiceSid).fetch();
      return live.messagingServiceSid;
    } catch (err: any) {
      if (!isTwilioNotFound(err)) throw err;
      await A2PProfile.updateOne(
        { _id: a2pId },
        { $unset: { messagingServiceSid: 1 } },
      );
    }
  }

  const ms = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM Service – ${userEmail}`,
    inboundRequestUrl: `${baseUrl}/api/twilio/inbound-sms`,
    statusCallback: `${baseUrl}/api/twilio/status-callback`,
  });

  await A2PProfile.updateOne(
    { _id: a2pId },
    { $set: { messagingServiceSid: ms.sid } },
  );

  return ms.sid;
}

export async function submitCampaignIfReadyForUserEmail(userEmail: string) {
  await mongooseConnect();

  const user = await User.findOne({ email: userEmail });
  if (!user) throw new Error("User not found");

  const userId = String(user._id);
  const a2p = await A2PProfile.findOne({ userId }).lean<IA2PProfile | null>();
  if (!a2p) {
    return { ok: false, reason: "no_a2p_profile" as const };
  }

  const a2pId = String((a2p as any)._id);

  const resolved = await getClientForUser(userEmail);
  const client = resolved.client;
  const twilioAccountSidUsed = resolved.accountSid;

  // If we already have a campaign SID, verify it exists, else unset it.
  if (a2p.usa2pSid && a2p.messagingServiceSid) {
    try {
      const svc: any = client.messaging.v1.services(a2p.messagingServiceSid);
      const sub =
        svc?.usAppToPerson && typeof svc.usAppToPerson === "function"
          ? svc.usAppToPerson(a2p.usa2pSid)
          : null;

      if (sub?.fetch) {
        await sub.fetch();
        return {
          ok: true,
          didCreate: false,
          usa2pSid: a2p.usa2pSid,
          twilioAccountSidUsed,
        };
      }
    } catch (err: any) {
      if (!isTwilioNotFound(err)) throw err;
      await A2PProfile.updateOne(
        { _id: a2pId },
        { $unset: { usa2pSid: 1, campaignSid: 1 } },
      );
    }
  }

  if (!a2p.brandSid) return { ok: false, reason: "missing_brandSid" as const };
  if (!a2p.profileSid) return { ok: false, reason: "missing_profileSid" as const };
  if (!a2p.trustProductSid) return { ok: false, reason: "missing_trustProductSid" as const };

  // Fetch brand status live
  const brand: any = await client.messaging.v1
    .brandRegistrations(a2p.brandSid)
    .fetch();

  const brandStatus = String(brand?.status || "").toUpperCase();
  const canCreateCampaign = BRAND_OK_FOR_CAMPAIGN.has(brandStatus);

  await A2PProfile.updateOne(
    { _id: a2pId },
    {
      $set: {
        brandStatus: brand?.status || undefined,
        brandFailureReason: brand?.failureReason || undefined,
        lastSyncedAt: new Date(),
        twilioAccountSidLastUsed: twilioAccountSidUsed,
        ...(brandStatus === "FAILED"
          ? {
              registrationStatus: "rejected",
              applicationStatus: "declined",
              declinedReason: String(brand?.failureReason || "Brand FAILED"),
              messagingReady: false,
              lastError: String(brand?.failureReason || "Brand FAILED"),
            }
          : {}),
      } as any,
    },
  );

  if (!canCreateCampaign) {
    return {
      ok: false,
      reason: "brand_not_ready" as const,
      brandStatus,
      twilioAccountSidUsed,
    };
  }

  // Ensure messaging service exists
  const messagingServiceSid = await ensureMessagingService({
    client,
    userId,
    userEmail,
    a2pId,
  });

  const samples = parseSamplesFromProfile(a2p);
  if (samples.length < 2) {
    throw new Error("A2P profile is missing sample messages (need at least 2).");
  }

  const useCaseCode = String((a2p as any).usecaseCode || "LOW_VOLUME");
  const messageFlowText = String(a2p.optInDetails || "");

  const description = buildCampaignDescription({
    businessName: a2p.businessName || "",
    useCase: useCaseCode,
    messageFlow: messageFlowText,
  });

  const createPayload: any = {
    brandRegistrationSid: a2p.brandSid,
    usAppToPersonUsecase: useCaseCode,
    description,
    messageFlow: messageFlowText,
    messageSamples: samples,
    hasEmbeddedLinks: true,
    hasEmbeddedPhone: false,
    subscriberOptIn: true,
    ageGated: false,
    directLending: false,
  };

  log("creating usa2p campaign", {
    userEmail,
    messagingServiceSid,
    brandSid: a2p.brandSid,
    useCaseCode,
    samplesCount: samples.length,
    twilioAccountSidUsed,
  });

  const usa2p = await client.messaging.v1
    .services(messagingServiceSid)
    .usAppToPerson.create(createPayload);

  const usa2pSid = (usa2p as any)?.sid;
  if (!isSidLike(usa2pSid, "QE")) {
    throw new Error(
      `usAppToPerson.create did not return a QE sid. Body: ${JSON.stringify(
        usa2p,
      )}`,
    );
  }

  await A2PProfile.updateOne(
    { _id: a2pId },
    {
      $set: {
        usa2pSid,
        campaignSid: usa2pSid,
        messagingServiceSid,
        registrationStatus: "ready",
        applicationStatus: "approved",
        messagingReady: true,
        lastSyncedAt: new Date(),
        twilioAccountSidLastUsed: twilioAccountSidUsed,
      } as any,
      $push: {
        approvalHistory: {
          stage: "campaign_submitted",
          at: new Date(),
          note: "Campaign auto-submitted after brand approval",
        },
      },
    },
  );

  return {
    ok: true,
    didCreate: true,
    usa2pSid,
    messagingServiceSid,
    brandStatus,
    twilioAccountSidUsed,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email)
      return res.status(401).json({ message: "Unauthorized" });

    const result = await submitCampaignIfReadyForUserEmail(session.user.email);
    return res.status(200).json({ ok: true, result });
  } catch (err: any) {
    console.error("[A2P submit-campaign] error:", err);
    return res.status(500).json({
      ok: false,
      message: "Submit campaign failed",
      error: err?.message || String(err),
    });
  }
}
