// pages/api/a2p/start.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import twilio from "twilio";
import A2PProfile from "@/models/A2PProfile";
import type { IA2PProfile } from "@/models/A2PProfile";
import User from "@/models/User";

/**
 * Required ENV:
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_AUTH_TOKEN
 * - NEXT_PUBLIC_BASE_URL (or BASE_URL)
 * - A2P_PRIMARY_PROFILE_SID  // BU... of the ISV primary, already approved
 *
 * Optional:
 * - SECONDARY_PROFILE_POLICY_SID
 * - A2P_TRUST_PRODUCT_POLICY_SID
 * - A2P_STATUS_CALLBACK_URL
 * - A2P_NOTIFICATIONS_EMAIL
 */

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);

const SECONDARY_PROFILE_POLICY_SID =
  process.env.SECONDARY_PROFILE_POLICY_SID ||
  "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const A2P_TRUST_PRODUCT_POLICY_SID =
  process.env.A2P_TRUST_PRODUCT_POLICY_SID ||
  "RNb0d4771c2c98518d916a3d4cd70a8f8b";
const PRIMARY_PROFILE_SID = process.env.A2P_PRIMARY_PROFILE_SID!; // BU... (ISV)

const baseUrl =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000";
const STATUS_CB =
  process.env.A2P_STATUS_CALLBACK_URL || `${baseUrl}/api/a2p/status-callback`;

const NOTIFY_EMAIL =
  process.env.A2P_NOTIFICATIONS_EMAIL || "a2p@yourcompany.com";

function log(...args: any[]) {
  console.log("[A2P start]", ...args);
}

// ---------------- helpers ----------------
function required<T>(v: T, name: string): T {
  if (!v) throw new Error(`Missing required field: ${name}`);
  return v;
}

// Twilio's TS typings for TrustHub vary across SDK versions; cast at the boundary.
async function assignEntityToCustomerProfile(
  customerProfileSid: string,
  objectSid: string,
) {
  const cp = client.trusthub.v1.customerProfiles(customerProfileSid) as any;

  const assignments =
    cp.customerProfilesEntityAssignments || cp.entityAssignments;

  if (!assignments || typeof assignments.create !== "function") {
    console.error(
      "[A2P start] customerProfile entity assignments API missing",
      {
        hasCustomerProfilesEntityAssignments:
          !!cp.customerProfilesEntityAssignments,
        hasEntityAssignments: !!cp.entityAssignments,
      },
    );
    throw new Error(
      "Twilio SDK: customerProfile entity assignments API not available",
    );
  }

  log("step: entityAssignments.create (customerProfile)", {
    customerProfileSid,
    objectSid,
  });

  await assignments.create({ objectSid });
}

async function assignEntityToTrustProduct(
  trustProductSid: string,
  objectSid: string,
) {
  const tp = client.trusthub.v1.trustProducts(trustProductSid) as any;

  const assignments =
    tp.trustProductsEntityAssignments || tp.entityAssignments;

  if (!assignments || typeof assignments.create !== "function") {
    console.error(
      "[A2P start] trustProduct entity assignments API missing",
      {
        hasTrustProductsEntityAssignments:
          !!tp.trustProductsEntityAssignments,
        hasEntityAssignments: !!tp.entityAssignments,
      },
    );
    throw new Error(
      "Twilio SDK: trustProduct entity assignments API not available",
    );
  }

  log("step: entityAssignments.create (trustProduct)", {
    trustProductSid,
    objectSid,
  });

  await assignments.create({ objectSid });
}

async function evaluateAndSubmitCustomerProfile(customerProfileSid: string) {
  try {
    log("step: customerProfiles.evaluations.create", { customerProfileSid });
    await (
      client.trusthub.v1.customerProfiles(customerProfileSid) as any
    ).evaluations.create({});
  } catch (err: any) {
    log("warn: evaluations.create failed (customerProfile)", {
      customerProfileSid,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
      message: err?.message,
    });
  }
  try {
    log("step: customerProfiles.update(pending-review)", { customerProfileSid });
    await client.trusthub.v1.customerProfiles(customerProfileSid).update({
      status: "pending-review",
    } as any);
  } catch (err: any) {
    log("warn: customerProfiles.update failed", {
      customerProfileSid,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
      message: err?.message,
    });
  }
}

async function evaluateAndSubmitTrustProduct(trustProductSid: string) {
  try {
    log("step: trustProducts.evaluations.create", { trustProductSid });
    await (
      client.trusthub.v1.trustProducts(trustProductSid) as any
    ).evaluations.create({});
  } catch (err: any) {
    log("warn: evaluations.create failed (trustProduct)", {
      trustProductSid,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
      message: err?.message,
    });
  }
  try {
    log("step: trustProducts.update(pending-review)", { trustProductSid });
    await client.trusthub.v1.trustProducts(trustProductSid).update({
      status: "pending-review",
    } as any);
  } catch (err: any) {
    log("warn: trustProducts.update failed", {
      trustProductSid,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
      message: err?.message,
    });
  }
}

async function ensureMessagingServiceForUser(
  userId: string,
  userEmail: string,
): Promise<string> {
  const a2p = await A2PProfile.findOne({ userId }).lean<IA2PProfile | null>();
  if (a2p?.messagingServiceSid) return a2p.messagingServiceSid;

  log("step: messaging.services.create (per-user)", { userId, userEmail });

  const ms = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM Service – ${userEmail}`,
    inboundRequestUrl: `${baseUrl}/api/twilio/inbound-sms`,
    statusCallback: `${baseUrl}/api/twilio/status-callback`,
  });

  await A2PProfile.updateOne(
    { userId },
    { $set: { messagingServiceSid: ms.sid } },
    { upsert: true },
  );

  return ms.sid;
}

// ---------------- handler ----------------
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email)
      return res.status(401).json({ message: "Unauthorized" });

    await mongooseConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

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
      sampleMessages, // string | string[]
      optInDetails, // string
      volume, // string
      optInScreenshotUrl, // string (optional)
      usecaseCode, // string | undefined
      // optional links
      landingOptInUrl,
      landingTosUrl,
      landingPrivacyUrl,
    } = (req.body || {}) as Record<string, unknown>;

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

    // Normalize EIN: should already be 9 digits from registerA2P,
    // but we defensively clean it again here.
    const einDigits = String(ein)
      .replace(/[^\d]/g, "")
      .slice(0, 9);

    if (einDigits.length !== 9) {
      throw new Error(
        "EIN must be 9 digits (business_registration_number is invalid).",
      );
    }

    // Normalize sample messages
    const samples: string[] = Array.isArray(sampleMessages)
      ? (sampleMessages as string[]).map((s) => s.trim()).filter(Boolean)
      : typeof sampleMessages === "string"
        ? (sampleMessages as string)
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    if (samples.length < 2) {
      throw new Error(
        "Provide at least 2 sample messages (20–1024 chars each).",
      );
    }

    const userId = String(user._id);
    const existing = await A2PProfile.findOne({
      userId,
    }).lean<IA2PProfile | null>();
    const now = new Date();

    // Upsert local A2PProfile
    const setPayload: Partial<IA2PProfile> & { userId: string } = {
      userId,
      businessName: String(businessName),
      ein: einDigits,
      website: String(website),
      address: String(address),
      email: String(email),
      phone: String(phone),
      contactTitle: String(contactTitle),
      contactFirstName: String(contactFirstName),
      contactLastName: String(contactLastName),
      sampleMessages: samples.join("\n\n"),
      sampleMessagesArr: samples, // keep array form too
      optInDetails: String(optInDetails),
      volume: (volume as string) || "Low",
      optInScreenshotUrl: (optInScreenshotUrl as string) || "",
      landingOptInUrl: (landingOptInUrl as string) || "",
      landingTosUrl: (landingTosUrl as string) || "",
      landingPrivacyUrl: (landingPrivacyUrl as string) || "",
      usecaseCode: (usecaseCode as string) || "LOW_VOLUME",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const messageFlowText: string = setPayload.optInDetails!;

    const a2p = await A2PProfile.findOneAndUpdate<IA2PProfile>(
      { userId },
      { $set: setPayload },
      { upsert: true, returnDocument: "after" },
    );
    if (!a2p) throw new Error("Failed to upsert A2P profile");

    log("upserted A2PProfile", {
      userId,
      profileId: a2p._id.toString(),
      brandSid: (a2p as any).brandSid,
      usa2pSid: (a2p as any).usa2pSid,
    });

    // Ensure per-user Messaging Service
    const messagingServiceSid = await ensureMessagingServiceForUser(
      userId,
      user.email,
    );

    // Idempotent short-circuit
    if ((a2p as any).brandSid && (a2p as any).usa2pSid) {
      log("short-circuit: brand + usa2p already exist", {
        brandSid: (a2p as any).brandSid,
        usa2pSid: (a2p as any).usa2pSid,
        messagingServiceSid,
      });
      return res.status(200).json({
        message: "A2P already created for this user.",
        messagingServiceSid,
        brandSid: (a2p as any).brandSid,
        usa2pSid: (a2p as any).usa2pSid,
      });
    }

    // ---------------- 1) Secondary Customer Profile (BU...) ----------------
    let secondaryProfileSid: string | undefined = (a2p as any).profileSid;
    if (!secondaryProfileSid) {
      log("step: customerProfiles.create (secondary)", {
        email: NOTIFY_EMAIL,
        policySid: SECONDARY_PROFILE_POLICY_SID,
      });

      const created = await client.trusthub.v1.customerProfiles.create({
        friendlyName: `${setPayload.businessName} – Secondary Customer Profile`,
        email: NOTIFY_EMAIL,
        policySid: SECONDARY_PROFILE_POLICY_SID,
        statusCallback: STATUS_CB,
      });

      secondaryProfileSid = created.sid;
      log("created customerProfile (secondary)", { secondaryProfileSid });

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { profileSid: secondaryProfileSid } },
      );
    }

    // ---------------- 1.2) EndUser: business information + attach ----------------
    if (!(a2p as any).businessEndUserSid) {
      const rawWebsite = String(setPayload.website || "").trim();
      const websiteUrl = rawWebsite.startsWith("http://") ||
        rawWebsite.startsWith("https://")
        ? rawWebsite
        : `https://${rawWebsite}`;

      const businessAttributes = {
        business_name: setPayload.businessName,
        social_media_profile_urls: "",
        website_url: websiteUrl,
        business_regions_of_operation: "USA_AND_CANADA",
        business_type: "Limited Liability Corporation",
        business_registration_identifier: "EIN",
        business_identity: "isv_reseller_or_partner",
        business_industry: "INSURANCE",
        business_registration_number: einDigits,
      };

      log("step: endUsers.create (business_info)", {
        type: "customer_profile_business_information",
        friendlyName: `${setPayload.businessName} – Business Info`,
        attributesSummary: {
          keys: Object.keys(businessAttributes),
          length: JSON.stringify(businessAttributes).length,
        },
      });

      let businessEU;
      try {
        businessEU = await client.trusthub.v1.endUsers.create({
          type: "customer_profile_business_information",
          friendlyName: `${setPayload.businessName} – Business Info`,
          attributes: businessAttributes as any,
        });
      } catch (err: any) {
        console.error(
          "[A2P start] Twilio error at step: endUsers.create (business_info)",
          {
            code: err?.code,
            status: err?.status,
            moreInfo: err?.moreInfo,
            details: err?.details,
            message: err?.message,
            extra: {
              type: "customer_profile_business_information",
              friendlyName: `${setPayload.businessName} – Business Info`,
              attributesSummary: {
                keys: Object.keys(businessAttributes),
                length: JSON.stringify(businessAttributes).length,
              },
            },
          },
        );
        throw err;
      }

      await assignEntityToCustomerProfile(
        secondaryProfileSid!,
        businessEU.sid,
      );

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { businessEndUserSid: businessEU.sid } },
      );
    }

    // ---------------- 1.4) Authorized representative + attach ----------------
    if (!(a2p as any).authorizedRepEndUserSid) {
      const digitsOnlyPhone = String(setPayload.phone || "").replace(
        /[^\d]/g,
        "",
      );

      const repAttributes = {
        last_name: setPayload.contactLastName,
        first_name: setPayload.contactFirstName,
        email: setPayload.email,
        business_title: setPayload.contactTitle,
        job_position: "Director",
        phone_number: digitsOnlyPhone,
        country_code: "+1",
      };

      log("step: endUsers.create (authorized_rep)", {
        type: "authorized_representative_1",
        friendlyName: `${setPayload.businessName} – Authorized Rep`,
        attributesSummary: {
          keys: Object.keys(repAttributes),
          length: JSON.stringify(repAttributes).length,
        },
      });

      let repEU;
      try {
        repEU = await client.trusthub.v1.endUsers.create({
          type: "authorized_representative_1",
          friendlyName: `${setPayload.businessName} – Authorized Rep`,
          attributes: repAttributes as any,
        });
      } catch (err: any) {
        console.error(
          "[A2P start] Twilio error at step: endUsers.create (authorized_rep)",
          {
            code: err?.code,
            status: err?.status,
            moreInfo: err?.moreInfo,
            details: err?.details,
            message: err?.message,
          },
        );
        throw err;
      }

      await assignEntityToCustomerProfile(secondaryProfileSid!, repEU.sid);

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { authorizedRepEndUserSid: repEU.sid } },
      );
    }

    // ---------------- 1.9) Assign Secondary to Primary (ISV) ----------------
    if (!(a2p as any).assignedToPrimary) {
      log("step: assign secondary to primary", {
        primaryProfileSid: PRIMARY_PROFILE_SID,
        secondaryProfileSid,
      });

      await assignEntityToCustomerProfile(
        PRIMARY_PROFILE_SID,
        secondaryProfileSid!,
      );

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { assignedToPrimary: true } },
      );
    }

    // Evaluate + submit Secondary
    await evaluateAndSubmitCustomerProfile(secondaryProfileSid!);

    // ---------------- 2) TrustProduct (A2P) if missing ----------------
    let trustProductSid: string | undefined = (a2p as any).trustProductSid;
    if (!trustProductSid) {
      log("step: trustProducts.create (A2P)", {
        email: NOTIFY_EMAIL,
        policySid: A2P_TRUST_PRODUCT_POLICY_SID,
      });

      const tp = await client.trusthub.v1.trustProducts.create({
        friendlyName: `${setPayload.businessName} – A2P Trust Product`,
        email: NOTIFY_EMAIL,
        policySid: A2P_TRUST_PRODUCT_POLICY_SID,
        statusCallback: STATUS_CB,
      });
      trustProductSid = tp.sid;

      log("created trustProduct", { trustProductSid });

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { trustProductSid } },
      );
    }

    // 2.2) EndUser: us_a2p_messaging_profile_information + attach to TrustProduct (+ attach Secondary)
    if (!(a2p as any).a2pProfileEndUserSid) {
      const a2pAttributes = {
        description: `A2P messaging for ${setPayload.businessName}`,
        message_samples: samples,
        message_flow: messageFlowText,
        message_volume: setPayload.volume || "Low",
        has_embedded_links: true,
        has_embedded_phone: false,
        subscriber_opt_in: true,
      };

      log("step: endUsers.create (a2p_profile)", {
        type: "us_a2p_messaging_profile_information",
        friendlyName: `${setPayload.businessName} – A2P Messaging Profile`,
        attributesSummary: {
          keys: Object.keys(a2pAttributes),
          length: JSON.stringify(a2pAttributes).length,
        },
      });

      let a2pEU;
      try {
        a2pEU = await client.trusthub.v1.endUsers.create({
          type: "us_a2p_messaging_profile_information",
          friendlyName: `${setPayload.businessName} – A2P Messaging Profile`,
          attributes: a2pAttributes as any,
        });
      } catch (err: any) {
        console.error(
          "[A2P start] Twilio error at step: endUsers.create (a2p_profile)",
          {
            code: err?.code,
            status: err?.status,
            moreInfo: err?.moreInfo,
            details: err?.details,
            message: err?.message,
          },
        );
        throw err;
      }

      await assignEntityToTrustProduct(trustProductSid!, a2pEU.sid);
      await assignEntityToTrustProduct(trustProductSid!, secondaryProfileSid!);

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { a2pProfileEndUserSid: a2pEU.sid } },
      );
    }

    // Evaluate + submit TrustProduct
    await evaluateAndSubmitTrustProduct(trustProductSid!);

    // ---------------- 3) BrandRegistration (BN...) if missing ----------------
    let brandSid: string | undefined = (a2p as any).brandSid;
    if (!brandSid) {
      log("step: brandRegistrations.create", {
        customerProfileBundleSid: secondaryProfileSid,
        a2PProfileBundleSid: trustProductSid,
      });

      const brand = await client.messaging.v1.brandRegistrations.create({
        customerProfileBundleSid: secondaryProfileSid!,
        a2PProfileBundleSid: trustProductSid!,
        brandType: "STANDARD",
      });
      brandSid = brand.sid;

      log("created brandRegistration", { brandSid });

      await A2PProfile.updateOne({ _id: a2p._id }, { $set: { brandSid } });
    }

    // ---------------- 4) Messaging Service already ensured ----------------

    // ---------------- 5) Campaign (Usa2p QE...) if missing ----------------
    let usa2pSid: string | undefined = (a2p as any).usa2pSid;
    if (!usa2pSid) {
      const code = (usecaseCode as string) || "LOW_VOLUME";

      log("step: usAppToPerson.create (campaign)", {
        messagingServiceSid,
        brandSid,
        code,
      });

      const usa2p = await client.messaging.v1
        .services(messagingServiceSid)
        .usAppToPerson.create({
          brandRegistrationSid: brandSid!,
          usAppToPersonUsecase: code,
          description: `Campaign for ${setPayload.businessName} (${code})`,
          messageFlow: messageFlowText,
          messageSamples: samples,
          hasEmbeddedLinks: true,
          hasEmbeddedPhone: false,
          subscriberOptIn: true,
          ageGated: false,
          directLending: false,
        });

      usa2pSid = (usa2p as any).sid;

      log("created usa2p campaign", { usa2pSid });

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { usa2pSid, messagingServiceSid } },
      );
    }

    // Done
    const updated = await A2PProfile.findById(
      a2p._id,
    ).lean<IA2PProfile | null>();
    return res.status(200).json({
      message:
        "A2P registration started/submitted. We'll move to VERIFIED automatically when TCR approves.",
      data: {
        messagingServiceSid,
        profileSid: updated?.profileSid,
        trustProductSid: (updated as any)?.trustProductSid,
        brandSid: (updated as any)?.brandSid,
        usa2pSid: (updated as any)?.usa2pSid,
      },
    });
  } catch (err: any) {
    console.error("[A2P start] top-level error:", {
      message: err?.message,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
      details: err?.details,
    });
    return res.status(500).json({
      message: err?.message || "Failed to start A2P flow",
    });
  }
}
