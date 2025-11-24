// /pages/api/a2p/status-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import twilio from "twilio";
import {
  sendA2PApprovedEmail,
  sendA2PDeclinedEmail,
} from "@/lib/a2p/notifications";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  ""
).replace(/\/$/, "");

// statuses Twilio may use for “good / usable”
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

/** Build a campaign description that satisfies Twilio length constraints. */
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

/** Extract message samples from profile in a robust way. */
function getSamplesFromProfile(a2p: any): string[] {
  if (Array.isArray(a2p.sampleMessagesArr) && a2p.sampleMessagesArr.length > 0) {
    return a2p.sampleMessagesArr
      .map((s: any) => String(s || "").trim())
      .filter(Boolean);
  }
  const raw = String(a2p.sampleMessages || "");
  return raw
    .split(/\n{2,}|\r?\n\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Ensure Messaging Service exists for THIS profile. Uses updateOne (no .save / no validation). */
async function ensureTenantMessagingServiceForProfile(
  a2pId: string,
  userLabel: string | undefined,
  existingMsSid?: string,
) {
  if (existingMsSid) {
    await client.messaging.v1.services(existingMsSid).update({
      friendlyName: `CoveCRM – ${userLabel || a2pId}`,
      inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
    });
    return existingMsSid;
  }
  const svc = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${userLabel || a2pId}`,
    inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
    statusCallback: `${BASE_URL}/api/twilio/status-callback`,
  });
  await A2PProfile.updateOne(
    { _id: a2pId },
    { $set: { messagingServiceSid: svc.sid } },
  ); // no validation
  return svc.sid;
}

/** Add number to a Messaging Service. Handles 21712 unlink/reattach. */
async function addNumberToMessagingService(
  serviceSid: string,
  numberSid: string,
) {
  try {
    await client.messaging.v1
      .services(serviceSid)
      .phoneNumbers.create({ phoneNumberSid: numberSid });
  } catch (err: any) {
    if (err?.code === 21712) {
      const services = await client.messaging.v1.services.list({ limit: 100 });
      for (const svc of services) {
        try {
          await client.messaging.v1
            .services(svc.sid)
            .phoneNumbers(numberSid)
            .remove();
        } catch {
          // ignore
        }
      }
      await client.messaging.v1
        .services(serviceSid)
        .phoneNumbers.create({ phoneNumberSid: numberSid });
    } else {
      throw err;
    }
  }
}

/**
 * Ensure a Usa2p campaign exists for this tenant once the brand is approved.
 * Idempotent: if a2p.usa2pSid already exists, this is a no-op.
 */
async function ensureCampaignForProfile(
  a2p: any,
  messagingServiceSid: string,
  brandSid: string | undefined,
) {
  if (!brandSid) return;
  if (a2p.usa2pSid) return; // already have a campaign

  const useCaseCode = a2p.usecaseCode || "LOW_VOLUME";
  const messageFlowText = String(a2p.optInDetails || "");
  const samples = getSamplesFromProfile(a2p);

  if (!samples.length) {
    // don't throw; just record and bail
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

  const createPayload: any = {
    brandRegistrationSid: brandSid,
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

  try {
    const usa2p = await client.messaging.v1
      .services(messagingServiceSid)
      .usAppToPerson.create(createPayload);

    const usa2pSid = (usa2p as any).sid;

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
      {
        $set: {
          lastError: `campaign_create: ${err?.message || err}`,
        },
      },
    );
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const debugEnabled = String(req.query.debug ?? "") === "1";
  const debug: Record<string, any> = {
    hasTwilio: Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN,
    ),
  };

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
        ...(body.campaignSid ? { campaignSid: body.campaignSid } : {}),
        ...(body.messagingServiceSid ? { messagingServiceSid: body.messagingServiceSid } : {}),
        ...(body.brandSid ? { brandSid: body.brandSid } : {}),
        ...(body.BrandSid ? { BrandSid: body.BrandSid } : {}),
        ...(body.ResourceSid ? { ResourceSid: body.ResourceSid } : {}),
      };
      debug.statusRaw = statusRaw;
    }

    if (!anySid) {
      return res
        .status(200)
        .json({ ok: true, ...(debugEnabled ? { debug } : {}) });
    }

    // Find the existing A2P profile by any SID we recognize
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

    if (!a2p) {
      return res
        .status(200)
        .json({ ok: true, ...(debugEnabled ? { debug } : {}) });
    }

    // === APPROVED-ish path (brand / campaign / etc.) ===
    if (statusRaw && APPROVED.has(statusRaw)) {
      let brandSid: string | undefined =
        body.brandSid || body.BrandSid || (a2p as any).brandSid || undefined;
      let brandStatus: string | undefined;
      let brandFailureReason: string | undefined;

      // Refresh brand status from Twilio (if brandSid exists)
      if (brandSid) {
        try {
          const brand: any = await client.messaging.v1
            .brandRegistrations(brandSid)
            .fetch();
          brandStatus = brand?.status;

          const rawFailure =
            brand?.failureReason ||
            brand?.failureReasons ||
            brand?.errorCodes ||
            undefined;

          if (!rawFailure) {
            brandFailureReason = undefined;
          } else if (typeof rawFailure === "string") {
            brandFailureReason = rawFailure;
          } else if (Array.isArray(rawFailure)) {
            brandFailureReason = rawFailure.join("; ");
          } else {
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
            status: err?.status,
            moreInfo: err?.moreInfo,
          });
        }
      }

      const normalBrandStatus = lc(brandStatus || "");
      const brandIsApproved =
        !!normalBrandStatus && APPROVED.has(normalBrandStatus);

      // Ensure Messaging Service for this tenant
      let msSid: string | undefined;
      let user: any = null;

      try {
        user = a2p.userId ? await User.findById(a2p.userId).lean() : null;
        msSid = await ensureTenantMessagingServiceForProfile(
          String(a2p._id),
          user?.name || user?.email,
          a2p.messagingServiceSid,
        );
      } catch (e) {
        console.warn(
          "MS ensure failed in status-callback (non-fatal):",
          (e as any)?.message || e,
        );
      }

      // If brand is approved and we don't yet have a campaign, create one now (auto)
      if (brandIsApproved && msSid) {
        await ensureCampaignForProfile(a2p, msSid, brandSid);
      }

      // Refresh a2p snapshot (campaign might now exist)
      const updatedAfterCampaign = await A2PProfile.findById(
        a2p._id,
      ).lean();
      const hasCampaign =
        !!updatedAfterCampaign?.usa2pSid || !!(a2p as any).usa2pSid;

      // Attach all owned numbers (best effort) to Messaging Service
      try {
        if (user?._id && msSid) {
          const owned = await PhoneNumber.find({ userId: user._id }).lean();
          for (const num of owned) {
            const numSid = (num as any).twilioSid as string | undefined;
            if (!numSid) continue;
            try {
              await addNumberToMessagingService(msSid, numSid);
              if ((num as any).messagingServiceSid !== msSid) {
                await PhoneNumber.updateOne(
                  { _id: (num as any)._id },
                  { $set: { messagingServiceSid: msSid } },
                );
              }
            } catch (e) {
              console.warn(
                `Attach failed for ${num.phoneNumber} → ${msSid}:`,
                e,
              );
            }
          }
        }
      } catch (e) {
        console.warn(
          "Attach numbers failed in status-callback (non-fatal):",
          (e as any)?.message || e,
        );
      }

      // Flip flags WITHOUT validation
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

      // Notify once (best effort) – only when fully ready
      try {
        if (messagingReady && !updatedAfterCampaign?.approvalNotifiedAt) {
          const user2 = a2p.userId
            ? await User.findById(a2p.userId).lean()
            : null;
          if (user2?.email) {
            await sendA2PApprovedEmail({
              to: user2.email,
              name: user2.name || undefined,
              dashboardUrl: `${BASE_URL}/settings/messaging`,
            });
          }
          await A2PProfile.updateOne(
            { _id: a2p._id },
            { $set: { approvalNotifiedAt: new Date() } },
          );
        }
      } catch (e) {
        console.warn(
          "A2P approved email failed:",
          (e as any)?.message || e,
        );
        await A2PProfile.updateOne(
          { _id: a2p._id },
          {
            $set: {
              lastError: `notify: ${(e as any)?.message || e}`,
            },
          },
        );
      }

      const payload: any = { ok: true, messagingReady };
      if (debugEnabled) payload.debug = debug;
      return res.status(200).json(payload);
    }

    // === DECLINED / FAILED ===
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
        const user = a2p.userId ? await User.findById(a2p.userId).lean() : null;
        if (user?.email) {
          await sendA2PDeclinedEmail({
            to: user.email,
            name: user.name || undefined,
            reason: declinedReason,
            helpUrl: `${BASE_URL}/help/a2p-checklist`,
          });
        }
      } catch (e) {
        console.warn(
          "A2P declined email failed:",
          (e as any)?.message || e,
        );
        await A2PProfile.updateOne(
          { _id: a2p._id },
          {
            $set: {
              lastError: `notify: ${(e as any)?.message || e}`,
            },
          },
        );
      }

      const payload: any = { ok: true, messagingReady: false };
      if (debugEnabled) payload.debug = debug;
      return res.status(200).json(payload);
    }

    // === INTERMEDIATE / OTHER EVENTS ===
    await A2PProfile.updateOne(
      { _id: a2p._id },
      { $set: { lastSyncedAt: new Date() } },
    );
    const payload: any = { ok: true };
    if (debugEnabled) payload.debug = debug;
    return res.status(200).json(payload);
  } catch (err) {
    console.error("A2P status-callback error:", err);
    const payload: any = {
      ok: true,
      error: (err as any)?.message || String(err),
    };
    if (debugEnabled) payload.debug = debug;
    return res.status(200).json(payload);
  }
}
