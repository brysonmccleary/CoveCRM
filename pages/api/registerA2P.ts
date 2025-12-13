// /pages/api/registerA2P.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import type { IA2PProfile } from "@/models/A2PProfile";
import User from "@/models/User";

/**
 * Orchestrates:
 * - POST /api/a2p/start
 * - (if eligible) POST /api/a2p/submit-campaign
 *
 * MUST forward cookies
 * MUST fail loudly if Twilio didn't actually create/update SIDs.
 */

// 🔧 CHANGED: mutable; set per-request to match origin (local/ngrok/vercel)
let BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000";

function getRequestBaseUrl(req: NextApiRequest): string {
  const xfProto = (req.headers["x-forwarded-proto"] as string) || "";
  const xfHost = (req.headers["x-forwarded-host"] as string) || "";
  const host = xfHost || (req.headers.host as string) || "";
  const proto =
    xfProto.split(",")[0]?.trim() ||
    ((host.includes("localhost") || host.includes("127.0.0.1")) ? "http" : "https");
  if (!host) return BASE_URL;
  return `${proto}://${host}`;
}

const BRAND_OK_FOR_CAMPAIGN = new Set([
  "APPROVED",
  "VERIFIED",
  "ACTIVE",
  "IN_USE",
  "REGISTERED",
]);

const US_STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

type BodyIn = {
  businessName?: string;
  ein?: string;
  website?: string;

  address?: string;
  addressLine2?: string;
  addressCity?: string;
  addressState?: string;
  addressPostalCode?: string;
  addressCountry?: string;

  email?: string;
  phone?: string;
  contactTitle?: string;
  contactFirstName?: string;
  contactLastName?: string;

  usecaseCode?: string;
  useCase?: string;

  sampleMessages?: string;
  sampleMessage1?: string;
  sampleMessage2?: string;
  sampleMessage3?: string;

  optInDetails?: string;
  volume?: string;

  optInScreenshotUrl?: string | null;
  landingOptInUrl?: string;
  landingTosUrl?: string;
  landingPrivacyUrl?: string;
};

type ValidationErrors = {
  businessName?: string;
  ein?: string;
  website?: string;
  address?: string;
  addressCity?: string;
  addressState?: string;
  addressPostalCode?: string;
  addressCountry?: string;
  email?: string;
  phone?: string;
  contactFirstName?: string;
  contactLastName?: string;
  optInDetails?: string;
  volume?: string;
  sampleMessage1?: string;
  sampleMessage2?: string;
  sampleMessage3?: string;
};

function isUsState(value: string | undefined): boolean {
  if (!value) return false;
  return US_STATE_CODES.includes(value.trim().toUpperCase());
}

function isUsCountry(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toUpperCase();
  return v === "US" || v === "USA" || v === "UNITED STATES" || v === "UNITED STATES OF AMERICA";
}

function isValidHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!/^https:\/\//i.test(v)) return false;
  try {
    const u = new URL(v);
    if (!u.hostname || !u.hostname.includes(".")) return false;
    if (/localhost|127\.0\.0\.1/i.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function isValidEmail(value: string | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidPhone(value: string | undefined): boolean {
  if (!value) return false;
  return /^\d{10}$/.test(value.trim());
}

function isValidZip(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9]{5}(-[0-9]{4})?$/.test(value.trim());
}

function ensureHasStopLanguage(text: string): boolean {
  return /reply\s+stop/i.test(text) || /text\s+stop/i.test(text);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  BASE_URL = getRequestBaseUrl(req);

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const body = (req.body || {}) as BodyIn;
  const errors: ValidationErrors = {};

  const {
    businessName,
    ein,
    website,
    address,
    addressCity,
    addressState,
    addressPostalCode,
    addressCountry,
    email,
    phone,
    contactFirstName,
    contactLastName,
    optInDetails,
    volume,
  } = body;

  if (!businessName || !businessName.trim()) errors.businessName = "Business name is required.";
  else if (businessName.trim().length < 3) errors.businessName = "Business name must be at least 3 characters.";

  let normalizedEin = "";
  if (!ein || !ein.trim()) errors.ein = "EIN is required.";
  else {
    normalizedEin = ein.replace(/[^\d]/g, "");
    if (normalizedEin.length !== 9) errors.ein = 'EIN must be 9 digits, e.g. "12-3456789".';
  }

  if (!address || !address.trim()) errors.address = "Street address is required.";
  if (!addressCity || !addressCity.trim()) errors.addressCity = "City is required.";

  if (!addressState || !addressState.trim()) errors.addressState = "State is required.";
  else if (!isUsState(addressState)) errors.addressState = "Enter a valid 2-letter US state code (e.g., CA, TX).";

  if (!addressPostalCode || !addressPostalCode.trim()) errors.addressPostalCode = "ZIP / postal code is required.";
  else if (!isValidZip(addressPostalCode)) errors.addressPostalCode = "Enter a valid US ZIP code (12345 or 12345-6789).";

  if (!addressCountry || !addressCountry.trim()) errors.addressCountry = "Country is required.";
  else if (!isUsCountry(addressCountry)) errors.addressCountry = "A2P 10DLC only supports US-based brands. Enter 'US'.";

  if (!website || !website.trim()) errors.website = "Website URL is required.";
  else if (!isValidHttpsUrl(website)) errors.website = 'Website must be a real, public HTTPS URL starting with "https://".';

  if (!email || !email.trim()) errors.email = "Business email is required.";
  else if (!isValidEmail(email)) errors.email = "Enter a valid email address.";

  if (!phone || !phone.trim()) errors.phone = "Business / authorized rep phone is required.";
  else if (!isValidPhone(phone)) errors.phone = "Phone must be exactly 10 digits. Example: 5551234567.";

  if (!contactFirstName || !contactFirstName.trim()) errors.contactFirstName = "Contact first name is required.";
  if (!contactLastName || !contactLastName.trim()) errors.contactLastName = "Contact last name is required.";

  const samplesFromBlob = (body.sampleMessages || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const samplesFromFieldsRaw = [body.sampleMessage1, body.sampleMessage2, body.sampleMessage3] as (string | undefined)[];
  const samplesFromFields = samplesFromFieldsRaw.map((s) => (s || "").trim()).filter(Boolean);

  const finalSamples = (samplesFromFields.length ? samplesFromFields : samplesFromBlob).filter(Boolean);

  if (finalSamples.length < 2) {
    errors.sampleMessage1 =
      "At least 2 sample messages are required. Provide Sample Message #1 and #2 (and #3 if desired).";
  }

  const messageKeys: (keyof ValidationErrors)[] = ["sampleMessage1", "sampleMessage2", "sampleMessage3"];
  samplesFromFieldsRaw.forEach((raw, idx) => {
    const key = messageKeys[idx];
    if (!key) return;
    const trimmed = (raw || "").trim();
    if (!trimmed) {
      if (idx < 2) errors[key] = `Sample message #${idx + 1} is required.`;
      return;
    }
    if (trimmed.length < 20 || trimmed.length > 320) errors[key] = "Sample messages must be between 20 and 320 characters.";
    if (!ensureHasStopLanguage(trimmed)) errors[key] = 'Sample messages must include opt-out language like "Reply STOP to opt out".';
  });

  const optIn = (optInDetails || "").trim();
  if (!optIn) errors.optInDetails = "Opt-in details are required.";
  else if (optIn.length < 300) errors.optInDetails = "Opt-in description must be detailed (at least a few full sentences).";
  else if (!/consent/i.test(optIn) || !/(by clicking|by entering)/i.test(optIn)) {
    errors.optInDetails =
      'Opt-in description must clearly state consent by clicking/entering their info (e.g., "By entering your information and clicking... you consent...").';
  }

  const volDigits = (volume || "").replace(/[^\d]/g, "");
  if (!volDigits) errors.volume = "Estimated monthly volume is required (e.g., 500).";
  else {
    const num = parseInt(volDigits, 10);
    if (!Number.isFinite(num) || num <= 0) errors.volume = "Monthly volume must be a positive number.";
    else if (num > 250000) errors.volume = "Monthly volume must be realistic for review (<= 250,000).";
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      message: "Submission contains missing or invalid fields.",
      errors,
    });
  }

  await mongooseConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ message: "User not found" });

  const userId = String(user._id);
  const existingA2P = await A2PProfile.findOne({ userId }).lean<IA2PProfile | null>();

  const existingBrandStatus = String(existingA2P?.brandStatus || "").toUpperCase();
  const hasExistingFailedBrand = !!(existingA2P as any)?.brandSid && existingBrandStatus === "FAILED";
  const resubmit = hasExistingFailedBrand;

  const normalizedUseCase = body.useCase || body.usecaseCode || "LOW_VOLUME";
  const normalizedState = addressState!.trim().toUpperCase();
  const normalizedCountry = addressCountry!.trim().toUpperCase();
  const normalizedPhone = phone!.trim();

  const startPayload: Record<string, any> = {
    businessName: businessName!.trim(),
    ein: normalizedEin,
    website: website!.trim(),

    address: address!.trim(),
    addressLine2: (body.addressLine2 || "").trim() || undefined,
    addressCity: addressCity!.trim(),
    addressState: normalizedState,
    addressPostalCode: addressPostalCode!.trim(),
    addressCountry: normalizedCountry,

    email: email!.trim(),
    phone: normalizedPhone,
    contactTitle: (body.contactTitle || "Owner").trim(),
    contactFirstName: contactFirstName!.trim(),
    contactLastName: contactLastName!.trim(),

    usecaseCode: normalizedUseCase,

    sampleMessages: finalSamples.join("\n\n"),
    sampleMessage1: finalSamples[0],
    sampleMessage2: finalSamples[1],
    sampleMessage3: finalSamples[2],

    optInDetails: optInDetails!,
    volume: volDigits,

    resubmit,

    ...(body.optInScreenshotUrl ? { optInScreenshotUrl: body.optInScreenshotUrl } : {}),
    ...(body.landingOptInUrl ? { landingOptInUrl: body.landingOptInUrl } : {}),
    ...(body.landingTosUrl ? { landingTosUrl: body.landingTosUrl } : {}),
    ...(body.landingPrivacyUrl ? { landingPrivacyUrl: body.landingPrivacyUrl } : {}),
  };

  const profileSelector = existingA2P ? { _id: (existingA2P as any)._id } : { userId };

  const persistLastSubmitted = async () => {
    try {
      await A2PProfile.updateOne(
        profileSelector,
        {
          $set: {
            lastSubmittedUseCase: normalizedUseCase,
            lastSubmittedSampleMessages: finalSamples,
            lastSubmittedOptInDetails: optInDetails!,
            useCase: normalizedUseCase,
            usecaseCode: normalizedUseCase,
            sampleMessages: finalSamples.join("\n\n"),
            sampleMessagesArr: finalSamples,
            sampleMessage1: finalSamples[0],
            sampleMessage2: finalSamples[1],
            sampleMessage3: finalSamples[2],
            optInDetails: optInDetails!,
            volume: volDigits,
          },
        },
        { upsert: true },
      );
    } catch (e) {
      console.error("A2P persistLastSubmitted error:", e);
    }
  };

  const cookie = req.headers.cookie || "";
  const commonHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (cookie) commonHeaders["Cookie"] = cookie;

  try {
    const startUrl = `${BASE_URL}/api/a2p/start`;
    const startRes = await fetch(startUrl, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify(startPayload),
    });

    const startData = await startRes.json().catch(() => ({}));
    console.log("[registerA2P] start", {
      status: startRes.status,
      url: startUrl,
      twilioAccountSidUsed: startData?.data?.twilioAccountSidUsed || startData?.twilioAccountSidUsed,
      brandSid: startData?.data?.brandSid || startData?.brandSid,
      messagingServiceSid: startData?.data?.messagingServiceSid || startData?.messagingServiceSid,
    });

    if (!startRes.ok) {
      return res.status(startRes.status).json({
        message: startData?.message || "A2P start failed",
        start: startData,
      });
    }

    const startInner = (startData && startData.data) || startData || {};

    // 🔧 NEW: Hard “did it hit Twilio?” sanity check
    // If start succeeded but didn’t return any SIDs, do not pretend success.
    const sanityBrandSid = startInner.brandSid || startData?.brandSid;
    const sanityMgSid = startInner.messagingServiceSid || startData?.messagingServiceSid;
    const sanityProfileSid = startInner.profileSid || startData?.profileSid;

    if (!sanityBrandSid && !sanityMgSid && !sanityProfileSid) {
      await A2PProfile.updateOne(
        profileSelector,
        {
          $set: {
            lastError:
              "registerA2P: /api/a2p/start returned OK but no Twilio SIDs were returned. Treating as failure to avoid false success.",
            lastSyncedAt: new Date(),
          },
        },
        { upsert: true },
      );

      return res.status(500).json({
        message:
          "A2P start returned success but no Twilio SIDs were created. Check server logs: Twilio calls likely failed or ran in wrong account.",
        start: startInner,
      });
    }

    await persistLastSubmitted();

    const rawBrandStatus =
      startData?.brandStatus || startInner.brandStatus || (startInner.brand && startInner.brand.status);
    const brandStatus = rawBrandStatus ? String(rawBrandStatus).toUpperCase() : undefined;

    const rawCanCreateCampaign =
      typeof startData?.canCreateCampaign === "boolean"
        ? startData.canCreateCampaign
        : typeof startInner?.canCreateCampaign === "boolean"
        ? startInner.canCreateCampaign
        : undefined;

    const canCreateCampaign =
      typeof rawCanCreateCampaign === "boolean"
        ? rawCanCreateCampaign
        : brandStatus
        ? BRAND_OK_FOR_CAMPAIGN.has(brandStatus)
        : undefined;

    const brandFailureReason =
      startData?.brandFailureReason || startInner.brandFailureReason || startInner.brandFailureReasons || undefined;

    if (canCreateCampaign === false) {
      const msg =
        brandStatus === "FAILED"
          ? "Brand FAILED. We saved your submission, but campaign cannot be created until brand issues are fixed."
          : "Brand not approved yet. We saved your submission; campaign will be created once approved.";
      return res.status(200).json({
        ok: true,
        message: msg,
        brandStatus,
        brandFailureReason,
        start: startInner,
      });
    }

    if (!canCreateCampaign) {
      return res.status(200).json({
        ok: true,
        message:
          "Brand submitted/updated. Once Twilio finishes review, we’ll auto-create your campaign and email you.",
        brandStatus,
        brandFailureReason,
        start: startInner,
      });
    }

    // Submit campaign alignment
    const submitPayload = {
      useCase: normalizedUseCase,
      messageFlow: optInDetails!,
      sampleMessages: finalSamples,
    };

    const submitUrl = `${BASE_URL}/api/a2p/submit-campaign`;
    const submitRes = await fetch(submitUrl, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify(submitPayload),
    });

    const submitData = await submitRes.json().catch(() => ({}));
    console.log("[registerA2P] submit-campaign", {
      status: submitRes.status,
      url: submitUrl,
      usa2pSid: submitData?.usa2pSid || submitData?.data?.usa2pSid,
    });

    if (!submitRes.ok) {
      return res.status(submitRes.status).json({
        message: submitData?.message || "Campaign submission failed",
        brandStatus,
        brandFailureReason,
        start: startInner,
        campaign: submitData,
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Submitted. We’ll email you when it’s approved or if reviewers need changes.",
      start: startInner,
      campaign: submitData,
      brandStatus,
    });
  } catch (e: any) {
    console.error("registerA2P error:", e);
    return res.status(500).json({ message: e?.message || "registerA2P failed" });
  }
}
