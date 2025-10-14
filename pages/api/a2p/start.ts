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
  await (
    client.trusthub.v1.customerProfiles(customerProfileSid) as any
  ).entityAssignments.create({
    objectSid,
  });
}
async function assignEntityToTrustProduct(
  trustProductSid: string,
  objectSid: string,
) {
  await (
    client.trusthub.v1.trustProducts(trustProductSid) as any
  ).entityAssignments.create({
    objectSid,
  });
}
async function evaluateAndSubmitCustomerProfile(customerProfileSid: string) {
  try {
    await (
      client.trusthub.v1.customerProfiles(customerProfileSid) as any
    ).evaluations.create({});
  } catch {}
  try {
    await client.trusthub.v1.customerProfiles(customerProfileSid).update({
      status: "pending-review",
    } as any);
  } catch {}
}
async function evaluateAndSubmitTrustProduct(trustProductSid: string) {
  try {
    await (
      client.trusthub.v1.trustProducts(trustProductSid) as any
    ).evaluations.create({});
  } catch {}
  try {
    await client.trusthub.v1.trustProducts(trustProductSid).update({
      status: "pending-review",
    } as any);
  } catch {}
}

async function ensureMessagingServiceForUser(
  userId: string,
  userEmail: string,
): Promise<string> {
  const a2p = await A2PProfile.findOne({ userId }).lean<IA2PProfile | null>();
  if (a2p?.messagingServiceSid) return a2p.messagingServiceSid;

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
      // ✅ NEW optional links
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

    // Upsert local A2PProfile
    const userId = String(user._id);
    const existing = await A2PProfile.findOne({
      userId,
    }).lean<IA2PProfile | null>();
    const now = new Date();

    const setPayload: Partial<IA2PProfile> & { userId: string } = {
      userId,
      businessName: String(businessName),
      ein: String(ein),
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
      // ✅ persist optional artifacts & campaign choice
      landingOptInUrl: (landingOptInUrl as string) || "",
      landingTosUrl: (landingTosUrl as string) || "",
      landingPrivacyUrl: (landingPrivacyUrl as string) || "",
      usecaseCode: (usecaseCode as string) || "LOW_VOLUME",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    // Use a narrowed local for fields needed as strict strings later
    const messageFlowText: string = setPayload.optInDetails!;

    const a2p = await A2PProfile.findOneAndUpdate<IA2PProfile>(
      { userId },
      { $set: setPayload },
      { upsert: true, returnDocument: "after" },
    );
    if (!a2p) throw new Error("Failed to upsert A2P profile");

    // Ensure per-user Messaging Service
    const messagingServiceSid = await ensureMessagingServiceForUser(
      userId,
      user.email,
    );

    // Idempotent short-circuit
    if ((a2p as any).brandSid && (a2p as any).usa2pSid) {
      return res.status(200).json({
        message: "A2P already created for this user.",
        messagingServiceSid,
        brandSid: (a2p as any).brandSid,
        usa2pSid: (a2p as any).usa2pSid,
      });
    }

    // 1) Secondary Customer Profile (BU...) if missing
    let secondaryProfileSid: string | undefined = (a2p as any).profileSid;
    if (!secondaryProfileSid) {
      const created = await client.trusthub.v1.customerProfiles.create({
        friendlyName: `${setPayload.businessName} – Secondary Customer Profile`,
        email: process.env.A2P_NOTIFICATIONS_EMAIL || "a2p@yourcompany.com",
        policySid: SECONDARY_PROFILE_POLICY_SID,
        statusCallback: STATUS_CB,
      });
      secondaryProfileSid = created.sid;

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { profileSid: secondaryProfileSid } },
      );
    }

    // 1.2) EndUser: business information + attach
    if (!(a2p as any).businessEndUserSid) {
      const businessEU = await client.trusthub.v1.endUsers.create({
        type: "customer_profile_business_information",
        friendlyName: `${setPayload.businessName} – Business Info`,
        attributes: {
          business_identity: "BUSINESS",
          business_industry: "OTHER",
          business_name: setPayload.businessName,
          business_regions_of_operation: ["US"],
          business_registration_identifier: "EIN",
          business_registration_number: setPayload.ein,
          business_type: "LLC",
          website_url: setPayload.website,
          social_media_profile_urls: [],
        } as any,
      });

      await assignEntityToCustomerProfile(secondaryProfileSid!, businessEU.sid);

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { businessEndUserSid: businessEU.sid } },
      );
    }

    // 1.4) Authorized representative + attach
    if (!(a2p as any).authorizedRepEndUserSid) {
      const repEU = await client.trusthub.v1.endUsers.create({
        type: "authorized_representative_1",
        friendlyName: `${setPayload.businessName} – Authorized Rep`,
        attributes: {
          first_name: setPayload.contactFirstName,
          last_name: setPayload.contactLastName,
          email: setPayload.email,
          phone_number: setPayload.phone,
          job_title: setPayload.contactTitle,
        } as any,
      });

      await assignEntityToCustomerProfile(secondaryProfileSid!, repEU.sid);

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { authorizedRepEndUserSid: repEU.sid } },
      );
    }

    // 1.9) Assign Secondary to Primary (ISV)
    if (!(a2p as any).assignedToPrimary) {
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

    // 2) TrustProduct (A2P) if missing
    let trustProductSid: string | undefined = (a2p as any).trustProductSid;
    if (!trustProductSid) {
      const tp = await client.trusthub.v1.trustProducts.create({
        friendlyName: `${setPayload.businessName} – A2P Trust Product`,
        email: process.env.A2P_NOTIFICATIONS_EMAIL || "a2p@yourcompany.com",
        policySid: A2P_TRUST_PRODUCT_POLICY_SID,
        statusCallback: STATUS_CB,
      });
      trustProductSid = tp.sid;

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { trustProductSid } },
      );
    }

    // 2.2) EndUser: us_a2p_messaging_profile_information + attach to TrustProduct (+ attach Secondary)
    if (!(a2p as any).a2pProfileEndUserSid) {
      const a2pEU = await client.trusthub.v1.endUsers.create({
        type: "us_a2p_messaging_profile_information",
        friendlyName: `${setPayload.businessName} – A2P Messaging Profile`,
        attributes: {
          description: `A2P messaging for ${setPayload.businessName}`,
          message_samples: samples,
          message_flow: messageFlowText,
          message_volume: setPayload.volume || "Low",
          has_embedded_links: true,
          has_embedded_phone: false,
          subscriber_opt_in: true,
        } as any,
      });

      await assignEntityToTrustProduct(trustProductSid!, a2pEU.sid);
      await assignEntityToTrustProduct(trustProductSid!, secondaryProfileSid!);

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { a2pProfileEndUserSid: a2pEU.sid } },
      );
    }

    // Evaluate + submit TrustProduct
    await evaluateAndSubmitTrustProduct(trustProductSid!);

    // 3) BrandRegistration (BN...) if missing
    let brandSid: string | undefined = (a2p as any).brandSid;
    if (!brandSid) {
      const brand = await client.messaging.v1.brandRegistrations.create({
        customerProfileBundleSid: secondaryProfileSid!,
        a2PProfileBundleSid: trustProductSid!,
        brandType: "STANDARD",
      });
      brandSid = brand.sid;

      await A2PProfile.updateOne({ _id: a2p._id }, { $set: { brandSid } });
    }

    // 4) Messaging Service already ensured

    // 5) Campaign (Usa2p QE...) if missing
    let usa2pSid: string | undefined = (a2p as any).usa2pSid;
    if (!usa2pSid) {
      const code = (usecaseCode as string) || "LOW_VOLUME";

      const usa2p = await client.messaging.v1
        .services(messagingServiceSid)
        .usAppToPerson.create({
          brandRegistrationSid: brandSid!,
          usAppToPersonUsecase: code,
          description: `Campaign for ${setPayload.businessName} (${code})`,
          messageFlow: messageFlowText, // <- narrowed to string
          messageSamples: samples,
          hasEmbeddedLinks: true,
          hasEmbeddedPhone: false,
          subscriberOptIn: true,
          ageGated: false,
          directLending: false,
        });

      usa2pSid = usa2p.sid;

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
    console.error("A2P start error:", err);
    return res.status(500).json({
      message: err?.message || "Failed to start A2P flow",
    });
  }
}
