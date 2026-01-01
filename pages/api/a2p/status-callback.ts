// /pages/api/a2p/status-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import {
  sendA2PApprovedEmail,
  sendA2PDeclinedEmail,
} from "@/lib/a2p/notifications";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  // ✅ hard fallback so Twilio URLs never become relative
  "https://www.covecrm.com"
).replace(/\/$/, "");

const APPROVED = new Set([
  "approved",
  "verified",
  "active",
  "in_use",
  "registered",
  "campaign_approved",
]);

const DECLINED_MATCH = /(reject|denied|declined|failed|error)/i;

const lc = (v: any) =>
  typeof v === "string" ? v.toLowerCase() : String(v ?? "").toLowerCase();

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

function getSamplesFromProfile(a2p: any): string[] {
  if (
    Array.isArray(a2p.lastSubmittedSampleMessages) &&
    a2p.lastSubmittedSampleMessages.length > 0
  ) {
    return a2p.lastSubmittedSampleMessages
      .map((s: any) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  if (Array.isArray(a2p.sampleMessagesArr) && a2p.sampleMessagesArr.length > 0) {
    return a2p.sampleMessagesArr
      .map((s: any) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  const raw = String(a2p.sampleMessages || "");
  return raw
    .split(/\n{2,}|\r?\n\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function getMessageFlowFromProfile(a2p: any): string {
  return String(
    a2p.lastSubmittedOptInDetails || a2p.optInDetails || a2p.messageFlow || "",
  ).trim();
}

function getUseCaseFromProfile(a2p: any): string {
  return String(
    a2p.lastSubmittedUseCase || a2p.useCase || a2p.usecaseCode || "LOW_VOLUME",
  )
    .trim()
    .toUpperCase();
}

function hasEmbeddedLinksFromText(flow: string, samples: string[]): boolean {
  const text = [flow, ...samples].join(" ");
  return /https?:\/\//i.test(text);
}

function hasEmbeddedPhoneFromText(flow: string, samples: string[]): boolean {
  const text = [flow, ...samples].join(" ");
  return (
    /\+\d{7,}/.test(text) || /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(text)
  );
}

async function ensureTenantMessagingServiceForProfile(args: {
  client: any;
  a2pId: string;
  userLabel: string | undefined;
  existingMsSid?: string;
}) {
  const { client, a2pId, userLabel, existingMsSid } = args;

  const inboundRequestUrl = `${BASE_URL}/api/twilio/inbound-sms`;
  const statusCallback = `${BASE_URL}/api/twilio/status-callback`;

  // ✅ If we have an existing service sid, verify/update it. If it’s stale, create a fresh one.
  if (existingMsSid) {
    try {
      await client.messaging.v1.services(existingMsSid).fetch();
      await client.messaging.v1.services(existingMsSid).update({
        friendlyName: `CoveCRM – ${userLabel || a2pId}`,
        inboundRequestUrl,
        statusCallback,
      });
      return existingMsSid;
    } catch (e: any) {
      console.warn("status-callback: existing Messaging Service SID invalid; recreating", {
        existingMsSid,
        message: e?.message,
        code: e?.code,
        status: e?.status,
      });
      // fall through to create
    }
  }

  const svc = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${userLabel || a2pId}`,
    inboundRequestUrl,
    statusCallback,
  });

  await A2PProfile.updateOne(
    { _id: a2pId },
    { $set: { messagingServiceSid: svc.sid } },
  );
  return svc.sid;
}

/**
 * ✅ Correct “21712 number already in a Messaging Service” handling:
 * - We must remove the *service association* SID (not the IncomingPhoneNumber SID).
 */
async function detachNumberFromAllServices(args: {
  client: any;
  numberSid: string;
}) {
  const { client, numberSid } = args;

  const services = await client.messaging.v1.services.list({ limit: 200 });

  for (const svc of services) {
    try {
      const attached = await client.messaging.v1
        .services(svc.sid)
        .phoneNumbers.list({ limit: 200 });

      for (const assoc of attached) {
        const assocIncomingSid =
          (assoc as any).phoneNumberSid || (assoc as any).phone_number_sid;

        if (String(assocIncomingSid || "") === String(numberSid)) {
          const assocSid = (assoc as any).sid; // ✅ association SID
          if (assocSid) {
            await client.messaging.v1
              .services(svc.sid)
              .phoneNumbers(assocSid)
              .remove();
          }
        }
      }
    } catch {
      // ignore per-service failures (best effort)
    }
  }
}

async function addNumberToMessagingService(args: {
  client: any;
  serviceSid: string;
  numberSid: string;
}) {
  const { client, serviceSid, numberSid } = args;

  try {
    await client.messaging.v1
      .services(serviceSid)
      .phoneNumbers.create({ phoneNumberSid: numberSid });
  } catch (err: any) {
    // 21712 = number already associated with a messaging service
    if (err?.code === 21712) {
      await detachNumberFromAllServices({ client, numberSid });
      await client.messaging.v1
        .services(serviceSid)
        .phoneNumbers.create({ phoneNumberSid: numberSid });
      return;
    }
    throw err;
  }
}

async function ensureCampaignForProfile(args: {
  client: any;
  a2p: any;
  messagingServiceSid: string;
  brandSid: string | undefined;
}) {
  const { client, a2p, messagingServiceSid, brandSid } = args;

  if (!brandSid) return;
  if (a2p.usa2pSid) return;

  const useCaseCode = getUseCaseFromProfile(a2p);
  const messageFlowText = getMessageFlowFromProfile(a2p);
  const samples = getSamplesFromProfile(a2p);

  if (!samples.length) {
    await A2PProfile.updateOne(
      { _id: a2p._id },
      {
        $set: {
          lastError:
            "A2P status callback: unable to create campaign - no sample messages on profile.",
        },
      },
    );
    return;
  }

  const description = buildCampaignDescription({
    businessName: String(a2p.businessName || ""),
    useCase: useCaseCode,
    messageFlow: messageFlowText,
  });

  const embeddedLinks = hasEmbeddedLinksFromText(messageFlowText, samples);
  const embeddedPhone = hasEmbeddedPhoneFromText(messageFlowText, samples);

  const createPayload: any = {
    brandRegistrationSid: brandSid,
    usAppToPersonUsecase: useCaseCode,
    description,
    messageFlow: messageFlowText,
    messageSamples: samples,
    hasEmbeddedLinks: embeddedLinks,
    hasEmbeddedPhone: embeddedPhone,
    subscriberOptIn: true,
    ageGated: false,
    directLending: false,
  };

  try {
    const usa2p = await client.messaging.v1
      .services(messagingServiceSid)
      .usAppToPerson.create(createPayload);

    const usa2pSid =
      (usa2p as any).sid ||
      (usa2p as any).campaignId ||
      (usa2p as any).campaign_id;

    await A2PProfile.updateOne(
      { _id: a2p._id },
      {
        $set: {
          usa2pSid,
          registrationStatus: "campaign_submitted",
          lastError: undefined,
        },
        $push: {
          approvalHistory: {
            stage: "campaign_submitted",
            at: new Date(),
            note: "A2P campaign auto-created from status callback",
          },
        },
      },
    );
  } catch (err: any) {
    console.warn("A2P status-callback: campaign create failed:", {
      message: err?.message,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
    });
    await A2PProfile.updateOne(
      { _id: a2p._id },
      { $set: { lastError: `campaign_create: ${err?.message || err}` } },
    );
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const debugEnabled = String(req.query.debug ?? "") === "1";
  const debug: Record<string, any> = {};

  try {
    await mongooseConnect();

    const body: any = req.body || {};
    const statusRaw = lc(body.Status || body.status || "");
    const eventType = String(body.EventType || body.Event || body.Type || "");

    const anySid: string | undefined =
      body.ObjectSid ||
      body.ResourceSid ||
      body.customerProfileSid ||
      body.trustProductSid ||
      body.brandSid ||
      body.BrandSid ||
      body.campaignSid ||
      body.messagingServiceSid;

    if (debugEnabled) {
      debug.parsed = {
        ...(body.Status ? { Status: body.Status } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(eventType ? { EventType: eventType } : {}),
        ...(anySid ? { anySid } : {}),
      };
      debug.statusRaw = statusRaw;
      debug.baseUrl = BASE_URL;
    }

    if (!anySid)
      return res.status(200).json({ ok: true, ...(debugEnabled ? { debug } : {}) });

    const a2p = await A2PProfile.findOne({
      $or: [
        { profileSid: anySid },
        { trustProductSid: anySid },
        { brandSid: anySid },
        { campaignSid: anySid },
        { usa2pSid: anySid },
        { messagingServiceSid: anySid },
      ],
    }).lean();

    if (!a2p)
      return res.status(200).json({ ok: true, ...(debugEnabled ? { debug } : {}) });

    const user = a2p.userId ? await User.findById(a2p.userId).lean<any>() : null;
    if (!user?.email)
      return res.status(200).json({ ok: true, ...(debugEnabled ? { debug } : {}) });

    let resolved: any = null;
    try {
      resolved = await getClientForUser(String(user.email));
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn("A2P status-callback: getClientForUser failed (non-fatal)", {
        userEmail: user?.email,
        message: msg,
      });

      if (debugEnabled) {
        debug.error = msg;
        debug.userEmail = user?.email;
      }

      return res.status(200).json({ ok: true, ...(debugEnabled ? { debug } : {}) });
    }

    const client = resolved.client;

    if (debugEnabled) {
      debug.twilio = {
        usingPersonal: resolved.usingPersonal,
        resolvedAccountSid: resolved.accountSid,
      };
    }

    // APPROVED-ish
    if (statusRaw && APPROVED.has(statusRaw)) {
      let brandSid: string | undefined =
        body.brandSid || body.BrandSid || (a2p as any).brandSid || undefined;

      let brandStatus: string | undefined;
      let brandFailureReason: string | undefined;

      if (brandSid) {
        try {
          const brand: any = await client.messaging.v1
            .brandRegistrations(brandSid)
            .fetch();
          brandStatus = brand?.status || brand?.state;

          const rawFailure =
            brand?.failureReason ||
            brand?.failureReasons ||
            brand?.errorCodes ||
            undefined;

          if (!rawFailure) brandFailureReason = undefined;
          else if (typeof rawFailure === "string") brandFailureReason = rawFailure;
          else if (Array.isArray(rawFailure)) brandFailureReason = rawFailure.join("; ");
          else {
            try {
              brandFailureReason = JSON.stringify(rawFailure);
            } catch {
              brandFailureReason = String(rawFailure);
            }
          }
        } catch (err: any) {
          console.warn("A2P status-callback: brand fetch failed:", {
            brandSid,
            message: err?.message,
            code: err?.code,
          });
        }
      }

      const normalBrandStatus = lc(brandStatus || "");
      const brandIsApproved = !!normalBrandStatus && APPROVED.has(normalBrandStatus);

      let msSid: string | undefined;
      try {
        msSid = await ensureTenantMessagingServiceForProfile({
          client,
          a2pId: String(a2p._id),
          userLabel: user?.name || user?.email,
          existingMsSid: (a2p as any).messagingServiceSid,
        });
      } catch (e: any) {
        console.warn("MS ensure failed in status-callback (non-fatal):", e?.message || e);
      }

      if (brandIsApproved && msSid) {
        await ensureCampaignForProfile({
          client,
          a2p,
          messagingServiceSid: msSid,
          brandSid,
        });
      }

      const updatedAfterCampaign = await A2PProfile.findById(a2p._id).lean<any>();
      const hasCampaign = Boolean(
        updatedAfterCampaign?.usa2pSid || (a2p as any).usa2pSid,
      );

      try {
        if (user?._id && msSid) {
          const owned = await PhoneNumber.find({ userId: user._id }).lean<any[]>();
          for (const num of owned) {
            const numSid = (num as any).twilioSid as string | undefined;
            if (!numSid) continue;
            try {
              await addNumberToMessagingService({
                client,
                serviceSid: msSid,
                numberSid: numSid,
              });
              if ((num as any).messagingServiceSid !== msSid) {
                await PhoneNumber.updateOne(
                  { _id: (num as any)._id },
                  { $set: { messagingServiceSid: msSid } },
                );
              }
            } catch (e) {
              console.warn(`Attach failed for ${num.phoneNumber} → ${msSid}:`, e);
            }
          }
        }
      } catch (e: any) {
        console.warn("Attach numbers failed in status-callback (non-fatal):", e?.message || e);
      }

      const registrationStatus =
        updatedAfterCampaign?.registrationStatus === "brand_submitted"
          ? "brand_approved"
          : updatedAfterCampaign?.registrationStatus === "campaign_submitted"
          ? "campaign_approved"
          : hasCampaign
          ? "ready"
          : updatedAfterCampaign?.registrationStatus || "brand_approved";

      const messagingReady = hasCampaign && brandIsApproved;

      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            messagingReady,
            applicationStatus: messagingReady ? "approved" : "pending",
            registrationStatus,
            brandStatus: brandStatus || updatedAfterCampaign?.brandStatus,
            brandFailureReason:
              brandFailureReason || updatedAfterCampaign?.brandFailureReason,
            lastSyncedAt: new Date(),
          },
          $unset: { lastError: 1, declinedReason: 1 },
          $push: {
            approvalHistory: {
              stage: messagingReady ? "campaign_approved" : "brand_approved",
              at: new Date(),
              note: messagingReady
                ? "Brand approved & campaign ready via callback"
                : "Brand approved via callback",
            },
          },
        },
      );

      try {
        const userDoc = await User.findById(user._id);
        if (userDoc) {
          (userDoc as any).a2p = (userDoc as any).a2p || {};
          const ua2p = (userDoc as any).a2p as any;

          ua2p.messagingReady = messagingReady;
          if (msSid) ua2p.messagingServiceSid = msSid;
          if (brandSid) ua2p.brandSid = brandSid;
          if (updatedAfterCampaign?.usa2pSid || (a2p as any).usa2pSid) {
            ua2p.usa2pSid =
              updatedAfterCampaign?.usa2pSid || (a2p as any).usa2pSid;
          }
          if (updatedAfterCampaign?.profileSid || (a2p as any).profileSid) {
            ua2p.profileSid =
              updatedAfterCampaign?.profileSid || (a2p as any).profileSid;
          }
          ua2p.registrationStatus = registrationStatus;
          ua2p.applicationStatus = messagingReady ? "approved" : "pending";
          ua2p.lastSyncedAt = new Date();

          await userDoc.save();
        }
      } catch (e: any) {
        console.warn(
          "A2P status-callback: failed to mirror A2P state into User.a2p:",
          e?.message || e,
        );
      }

      try {
        if (messagingReady && !updatedAfterCampaign?.approvalNotifiedAt) {
          await sendA2PApprovedEmail({
            to: user.email,
            name: user.name || undefined,
            dashboardUrl: `${BASE_URL}/settings/messaging`,
          });
          await A2PProfile.updateOne(
            { _id: a2p._id },
            { $set: { approvalNotifiedAt: new Date() } },
          );
        }
      } catch (e: any) {
        console.warn("A2P approved email failed:", e?.message || e);
        await A2PProfile.updateOne(
          { _id: a2p._id },
          { $set: { lastError: `notify: ${e?.message || e}` } },
        );
      }

      return res.status(200).json({ ok: true, messagingReady, ...(debugEnabled ? { debug } : {}) });
    }

    // DECLINED / FAILED
    if (DECLINED_MATCH.test(statusRaw)) {
      const declinedReason = String(
        body.Reason || body.reason || body.Error || "Rejected by reviewers",
      );

      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            messagingReady: false,
            applicationStatus: "declined",
            registrationStatus: "rejected",
            declinedReason,
            lastSyncedAt: new Date(),
            brandStatus: "FAILED",
            brandFailureReason: declinedReason,
          },
          $push: {
            approvalHistory: {
              stage: "rejected",
              at: new Date(),
              note: declinedReason,
            },
          },
        },
      );

      try {
        const userDoc = await User.findById(user._id);
        if (userDoc) {
          (userDoc as any).a2p = (userDoc as any).a2p || {};
          const ua2p = (userDoc as any).a2p as any;
          ua2p.messagingReady = false;
          ua2p.applicationStatus = "declined";
          ua2p.registrationStatus = "rejected";
          ua2p.declinedReason = declinedReason;
          ua2p.lastSyncedAt = new Date();
          await userDoc.save();
        }
      } catch (e: any) {
        console.warn("A2P declined mirror to User.a2p failed:", e?.message || e);
      }

      let shouldNotify = false;
      try {
        const newlyFlagged = await A2PProfile.findOneAndUpdate(
          { _id: a2p._id, declineNotifiedAt: { $exists: false } },
          { $set: { declineNotifiedAt: new Date() } },
          { new: true },
        ).lean();
        shouldNotify = !!newlyFlagged;
      } catch (e: any) {
        console.warn("A2P declined: failed to set declineNotifiedAt:", e?.message || e);
      }

      if (shouldNotify) {
        try {
          await sendA2PDeclinedEmail({
            to: user.email,
            name: user.name || undefined,
            reason: declinedReason,
            helpUrl: `${BASE_URL}/help/a2p-checklist`,
          });
        } catch (e: any) {
          console.warn("A2P declined email failed:", e?.message || e);
          await A2PProfile.updateOne(
            { _id: a2p._id },
            { $set: { lastError: `notify: ${e?.message || e}` } },
          );
        }
      }

      return res.status(200).json({ ok: true, messagingReady: false, ...(debugEnabled ? { debug } : {}) });
    }

    await A2PProfile.updateOne(
      { _id: a2p._id },
      { $set: { lastSyncedAt: new Date() } },
    );
    return res.status(200).json({ ok: true, ...(debugEnabled ? { debug } : {}) });
  } catch (err: any) {
    console.error("A2P status-callback error:", err);
    return res.status(200).json({
      ok: true,
      error: err?.message || String(err),
      ...(debugEnabled ? { debug } : {}),
    });
  }
}
