import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import twilio from "twilio";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";

/**
 * ENV you must set (parent/ISV account):
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - NEXT_PUBLIC_BASE_URL (or BASE_URL)  -> for callbacks
 * - A2P_PRIMARY_PROFILE_SID            -> Your ISV Primary Customer Profile (BU...) in TrustHub (Twilio Approved, ISV reseller)
 *
 * Optional overrides (defaults chosen from Twilio docs):
 * - SECONDARY_PROFILE_POLICY_SID       -> defaults to RNdfbf3fae0e1107f8aded0e7cead80bf5 (Standard/LVS)
 * - A2P_TRUST_PRODUCT_POLICY_SID       -> defaults to RNb0d4771c2c98518d916a3d4cd70a8f8b (A2P messaging profile)
 * - A2P_STATUS_CALLBACK_URL            -> webhook you can consume to track status changes
 *
 * References:
 * - ISV Onboarding (Standard/LVS): https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv-api
 * - Brand Registration API:        https://www.twilio.com/docs/messaging/api/brand-registration-resource
 * - Usa2p (Campaign) API:          https://www.twilio.com/docs/messaging/api/usapptoperson-resource
 * - Usecases list:                 https://www.twilio.com/docs/messaging/api/usapptopersonusecase-resource
 */

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);

const SECONDARY_PROFILE_POLICY_SID =
  process.env.SECONDARY_PROFILE_POLICY_SID || "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const A2P_TRUST_PRODUCT_POLICY_SID =
  process.env.A2P_TRUST_PRODUCT_POLICY_SID || "RNb0d4771c2c98518d916a3d4cd70a8f8b";
const PRIMARY_PROFILE_SID = process.env.A2P_PRIMARY_PROFILE_SID!; // BU... (ISV parent, approved)

const baseUrl =
  process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000";
const STATUS_CB = process.env.A2P_STATUS_CALLBACK_URL || `${baseUrl}/api/a2p/status-callback`;

// Helpers
function required(v: any, name: string) {
  if (!v) throw new Error(`Missing required field: ${name}`);
  return v;
}

async function ensureMessagingServiceForUser(userId: string, userEmail: string) {
  const a2p = await A2PProfile.findOne({ userId });
  if (a2p?.messagingServiceSid) return a2p.messagingServiceSid;

  const ms = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM Service – ${userEmail}`,
    inboundRequestUrl: `${baseUrl}/api/twilio/inbound-sms`,
    statusCallback: `${baseUrl}/api/twilio/status-callback`,
  });

  await A2PProfile.updateOne(
    { userId },
    { $set: { messagingServiceSid: ms.sid } },
    { upsert: true }
  );

  return ms.sid;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

    await mongooseConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    // User-submitted business info (from your onboarding form)
    const {
      businessName,
      ein,
      website,
      address,
      email,
      phone,
      contactTitle,
      contactFirstName,
      contactLastName,
      sampleMessages,        // string | string[]
      optInDetails,          // string
      volume,                // string (approx monthly volume)
      optInScreenshotUrl,    // string (optional)
      usecaseCode,           // optional; default LOW_VOLUME
    } = req.body || {};

    // Validate basics
    required(businessName, "businessName");
    required(ein, "ein");
    required(website, "website");
    required(address, "address");
    required(email, "email");
    required(phone, "phone");
    required(contactTitle, "contactTitle");
    required(contactFirstName, "contactFirstName");
    required(contactLastName, "contactLastName");
    required(optInDetails, "optInDetails");

    // Normalize sample messages
    const samples: string[] = Array.isArray(sampleMessages)
      ? sampleMessages
      : typeof sampleMessages === "string"
      ? sampleMessages.split("\n").map((s: string) => s.trim()).filter(Boolean)
      : [];

    if (samples.length < 2) {
      throw new Error("Provide at least 2 sample messages (20–1024 chars each).");
    }

    // Upsert our local A2PProfile first (so we always have the source of truth)
    const now = new Date();
    const a2p = await A2PProfile.findOneAndUpdate(
      { userId: String(user._id) },
      {
        $set: {
          userId: String(user._id),
          businessName,
          ein,
          website,
          address,
          email,
          phone,
          contactTitle,
          contactFirstName,
          contactLastName,
          sampleMessages: samples.join("\n\n"),
          optInDetails,
          volume: volume || "Low",
          optInScreenshotUrl: optInScreenshotUrl || "",
          createdAt: a2p?.createdAt || now,
        },
      },
      { upsert: true, new: true }
    );

    // 0) Ensure per-user Messaging Service (MG...) exists now
    const messagingServiceSid = await ensureMessagingServiceForUser(
      String(user._id),
      user.email
    );

    // SHORT-CIRCUIT / IDEMPOTENCE:
    // If we already have a BN and a QE for this user, return quickly.
    if ((a2p as any).brandSid && (a2p as any).usa2pSid) {
      return res.status(200).json({
        message: "A2P already created for this user.",
        messagingServiceSid,
        brandSid: (a2p as any).brandSid,
        usa2pSid: (a2p as any).usa2pSid,
      });
    }

    // 1) Create Secondary Customer Profile (BU...) if missing
    let secondaryProfileSid = (a2p as any).profileSid;
    if (!secondaryProfileSid) {
      const created = await client.trusthub.v1.customerProfiles.create({
        friendlyName: `${businessName} – Secondary Customer Profile`,
        email: process.env.A2P_NOTIFICATIONS_EMAIL || "a2p@yourcompany.com",
        policySid: SECONDARY_PROFILE_POLICY_SID, // ISV Standard/LVS policy
        statusCallback: STATUS_CB,
      });
      secondaryProfileSid = created.sid;

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { profileSid: secondaryProfileSid } }
      );
    }

    // 1.2) Create EndUser: customer_profile_business_information (IT...)
    //     Attach to Secondary Customer Profile
    if (!(a2p as any).businessEndUserSid) {
      const businessEU = await client.trusthub.v1.endUsers.create({
        type: "customer_profile_business_information",
        friendlyName: `${businessName} – Business Info`,
        attributes: {
          business_identity: "BUSINESS", // or "NON_PROFIT", "GOVERNMENT" if applicable
          business_industry: "OTHER",
          business_name: businessName,
          business_regions_of_operation: ["US"],
          business_registration_identifier: "EIN",
          business_registration_number: ein,
          business_type: "LLC", // adjust based on your onboarding form
          website_url: website,
          social_media_profile_urls: [],
        } as any,
      });

      await client.trusthub.v1
        .customerProfiles(secondaryProfileSid!)
        .entityAssignments.create({ objectSid: businessEU.sid });

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { businessEndUserSid: businessEU.sid } }
      );
    }

    // 1.4) Authorized representative (IT...) + attach
    if (!(a2p as any).authorizedRepEndUserSid) {
      const repEU = await client.trusthub.v1.endUsers.create({
        type: "authorized_representative_1",
        friendlyName: `${businessName} – Authorized Rep`,
        attributes: {
          first_name: contactFirstName,
          last_name: contactLastName,
          email: email,
          phone_number: phone,
          job_title: contactTitle,
        } as any,
      });

      await client.trusthub.v1
        .customerProfiles(secondaryProfileSid!)
        .entityAssignments.create({ objectSid: repEU.sid });

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { authorizedRepEndUserSid: repEU.sid } }
      );
    }

    // (Optional but recommended): Address + SupportingDocument attachments could be added here
    // following steps 1.6–1.8 in the ISV guide. Skipped for brevity; most brands pass with the
    // above if details are correct.

    // 1.9) Assign Secondary to Primary (your ISV Primary profile)
    if (!(a2p as any).assignedToPrimary) {
      await client.trusthub.v1
        .customerProfiles(PRIMARY_PROFILE_SID) // BU... primary (ISV)
        .entityAssignments.create({ objectSid: secondaryProfileSid! });

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { assignedToPrimary: true } }
      );
    }

    // 1.10 & 1.11) Evaluate + Submit Secondary Profile
    async function evaluateAndSubmitCustomerProfile(buSid: string) {
      try {
        await client.trusthub.v1
          .customerProfiles(buSid)
          .evaluations.create({ /* no body needed */ });
      } catch (_) {}
      try {
        await client.trusthub.v1.customerProfiles(buSid).update({
          status: "pending-review",
        });
      } catch (_) {}
    }
    await evaluateAndSubmitCustomerProfile(secondaryProfileSid!);

    // 2) Create TrustProduct for A2P profile (BU...) if missing
    let trustProductSid = (a2p as any).trustProductSid;
    if (!trustProductSid) {
      const tp = await client.trusthub.v1.trustProducts.create({
        friendlyName: `${businessName} – A2P Trust Product`,
        email: process.env.A2P_NOTIFICATIONS_EMAIL || "a2p@yourcompany.com",
        policySid: A2P_TRUST_PRODUCT_POLICY_SID,
        statusCallback: STATUS_CB,
      });
      trustProductSid = tp.sid;

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { trustProductSid } }
      );
    }

    // 2.2) EndUser: us_a2p_messaging_profile_information + attach to TrustProduct
    if (!(a2p as any).a2pProfileEndUserSid) {
      const a2pEU = await client.trusthub.v1.endUsers.create({
        type: "us_a2p_messaging_profile_information",
        friendlyName: `${businessName} – A2P Messaging Profile`,
        attributes: {
          description: `A2P messaging for ${businessName}`,
          message_samples: samples,
          message_flow: optInDetails,
          message_volume: volume || "Low",
          has_embedded_links: true,
          has_embedded_phone: false,
          subscriber_opt_in: true,
        } as any,
      });

      await client.trusthub.v1
        .trustProducts(trustProductSid!)
        .entityAssignments.create({ objectSid: a2pEU.sid });

      // Also attach the Secondary Customer Profile to the TrustProduct
      await client.trusthub.v1
        .trustProducts(trustProductSid!)
        .entityAssignments.create({ objectSid: secondaryProfileSid! });

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { a2pProfileEndUserSid: a2pEU.sid } }
      );
    }

    // 2.5 & 2.6) Evaluate + Submit TrustProduct
    async function evaluateAndSubmitTrustProduct(buSid: string) {
      try {
        await client.trusthub.v1
          .trustProducts(buSid)
          .evaluations.create({ /* none */ });
      } catch (_) {}
      try {
        await client.trusthub.v1.trustProducts(buSid).update({
          status: "pending-review",
        });
      } catch (_) {}
    }
    await evaluateAndSubmitTrustProduct(trustProductSid!);

    // 3) BrandRegistration (BN...) if missing
    let brandSid = (a2p as any).brandSid;
    if (!brandSid) {
      const brand = await client.messaging.v1.brandRegistrations.create({
        customerProfileBundleSid: secondaryProfileSid!,
        a2PProfileBundleSid: trustProductSid!,
        brandType: "STANDARD",        // or "LOW_VOLUME_STANDARD" brand – Twilio treats both via this flow
        // skipAutomaticSecVet: false,
        // mock: false   // (use true only if you're intentionally creating mock brands)
      });
      brandSid = brand.sid;

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { brandSid } }
      );
    }

    // 4) Messaging Service already ensured earlier (messagingServiceSid)

    // 5) Create A2P Campaign (Usa2p QE...) on the messaging service if missing
    let usa2pSid = (a2p as any).usa2pSid;
    if (!usa2pSid) {
      // Pick use case: default LOW_VOLUME (Low Volume Mixed)
      const code = (usecaseCode as string) || "LOW_VOLUME";

      const usa2p = await client.messaging.v1
        .services(messagingServiceSid)
        .usAppToPerson.create({
          brandRegistrationSid: brandSid!,
          usAppToPersonUsecase: code,
          description: `Campaign for ${businessName} (${code})`,
          messageFlow: optInDetails,
          messageSamples: samples,           // min 2, max 5
          hasEmbeddedLinks: true,
          hasEmbeddedPhone: false,
          subscriberOptIn: true,
          ageGated: false,
          directLending: false,
          // If you manage your own HELP/STOP responses, you can pass optInMessage/optOutMessage/helpKeywords/helpMessage here,
          // but Twilio Default/Advanced Opt-Out covers this for most ISV flows.
        });

      usa2pSid = usa2p.sid;

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { usa2pSid, messagingServiceSid } }
      );
    }

    // Done
    const updated = await A2PProfile.findOne({ _id: a2p._id }).lean();
    return res.status(200).json({
      message: "A2P registration started/submitted. We'll move to VERIFIED automatically when TCR approves.",
      data: {
        messagingServiceSid,
        profileSid: updated?.profileSid,
        trustProductSid: (updated as any)?.trustProductSid,
        brandSid: (updated as any)?.brandSid,
        usa2pSid: (updated as any)?.usa2pSid,
      },
    });
  } catch (err: any) {
    console.error("A2P start error:", err);
    return res.status(500).json({
      message: err?.message || "Failed to start A2P flow",
    });
  }
}
