// /pages/api/registerA2P.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import type { IA2PProfile } from "@/models/A2PProfile";
import User from "@/models/User";

/**
 * This endpoint orchestrates the full A2P flow:
 * 1) POST /api/a2p/start (creates/links TrustHub entities, Brand, Messaging Service,
 *    and, if the Brand is already eligible, initial Campaign)
 * 2) POST /api/a2p/submit-campaign (idempotently aligns the campaign with latest
 *    use-case, flow, and samples WHEN the Brand is eligible)
 *
 * IMPORTANT:
 * - This version includes STRICT validation that mirrors the frontend form.
 * - If anything is not in the exact format Twilio/TCR expects, we return 400
 *   and DO NOT touch Twilio at all.
 * - After a successful /api/a2p/start, we persist the "last submitted" campaign
 *   data into A2PProfile so /api/a2p/sync can auto-create the campaign later
 *   as soon as the brand is approved.
 */

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000";

// Brand statuses that are safe to attach an A2P campaign to
const BRAND_OK_FOR_CAMPAIGN = new Set([
  "APPROVED",
  "VERIFIED",
  "ACTIVE",
  "IN_USE",
  "REGISTERED",
]);

const US_STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];

type BodyIn = {
  businessName?: string;
  ein?: string;
  website?: string;

  // address parts
  address?: string; // line 1
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

  // campaign type
  usecaseCode?: string; // e.g. "LOW_VOLUME"
  useCase?: string; // alias (will be normalized)

  // messages
  sampleMessages?: string; // joined blob
  sampleMessage1?: string;
  sampleMessage2?: string;
  sampleMessage3?: string;

  // consent + volume
  optInDetails?: string;
  volume?: string;

  // optional artifacts
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
  return (
    v === "US" ||
    v === "USA" ||
    v === "UNITED STATES" ||
    v === "UNITED STATES OF AMERICA"
  );
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

// 🔒 Phone must be EXACTLY 10 digits, no symbols, spaces, +1, etc.
function isValidPhone(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  return /^\d{10}$/.test(v);
}

function isValidZip(value: string | undefined): boolean {
  if (!value) return false;
  return /^[0-9]{5}(-[0-9]{4})?$/.test(value.trim());
}

function ensureHasStopLanguage(text: string): boolean {
  return /reply\s+stop/i.test(text) || /text\s+stop/i.test(text);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  // session check (aligns with your other handlers)
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const body = (req.body || {}) as BodyIn;
  const errors: ValidationErrors = {};

  // ---- basic required presence ----
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

  // Business name
  if (!businessName || !businessName.trim()) {
    errors.businessName = "Business name is required.";
  } else if (businessName.trim().length < 3) {
    errors.businessName = "Business name must be at least 3 characters.";
  }

  // EIN: must be 9 digits
  let normalizedEin = "";
  if (!ein || !ein.trim()) {
    errors.ein = "EIN is required.";
  } else {
    normalizedEin = ein.replace(/[^\d]/g, "");
    if (normalizedEin.length !== 9) {
      errors.ein =
        'EIN must be 9 digits, e.g. "12-3456789" or "123456789" (no letters or extra symbols).';
    }
  }

  // Address
  if (!address || !address.trim()) {
    errors.address = "Street address is required.";
  }
  if (!addressCity || !addressCity.trim()) {
    errors.addressCity = "City is required.";
  }
  if (!addressState || !addressState.trim()) {
    errors.addressState = "State is required.";
  } else if (!isUsState(addressState)) {
    errors.addressState =
      "Enter a valid 2-letter US state code (e.g., CA, TX).";
  }

  if (!addressPostalCode || !addressPostalCode.trim()) {
    errors.addressPostalCode = "ZIP / postal code is required.";
  } else if (!isValidZip(addressPostalCode)) {
    errors.addressPostalCode =
      "Enter a valid US ZIP code (12345 or 12345-6789).";
  }

  if (!addressCountry || !addressCountry.trim()) {
    errors.addressCountry = "Country is required.";
  } else if (!isUsCountry(addressCountry)) {
    errors.addressCountry =
      "A2P 10DLC only supports US-based brands. Enter 'US' for the country.";
  }

  // Website
  if (!website || !website.trim()) {
    errors.website = "Website URL is required.";
  } else if (!isValidHttpsUrl(website)) {
    errors.website =
      'Website must be a real, public HTTPS URL (starting with "https://").';
  }

  // Email
  if (!email || !email.trim()) {
    errors.email = "Business email is required.";
  } else if (!isValidEmail(email)) {
    errors.email = "Enter a valid email address (example@domain.com).";
  }

  // Phone
  if (!phone || !phone.trim()) {
    errors.phone = "Business / authorized rep phone is required.";
  } else if (!isValidPhone(phone)) {
    errors.phone =
      "Phone number must be exactly 10 digits with no spaces, dashes, or parentheses. Example: 5551234567.";
  }

  // Contact names
  if (!contactFirstName || !contactFirstName.trim()) {
    errors.contactFirstName = "Contact first name is required.";
  }
  if (!contactLastName || !contactLastName.trim()) {
    errors.contactLastName = "Contact last name is required.";
  }

  // messages: allow either 3 fields or a joined blob
  const samplesFromBlob = (body.sampleMessages || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const samplesFromFieldsRaw = [
    body.sampleMessage1,
    body.sampleMessage2,
    body.sampleMessage3,
  ] as (string | undefined)[];

  const samplesFromFields = samplesFromFieldsRaw
    .map((s) => (s || "").trim())
    .filter(Boolean);

  const finalSamples = (samplesFromFields.length
    ? samplesFromFields
    : samplesFromBlob
  ).filter(Boolean);

  if (finalSamples.length < 2) {
    // We still validate individual fields if present
    errors.sampleMessage1 =
      "At least 2 sample messages are required. Provide Sample Message #1 and #2 (and #3 if desired).";
  }

  // Per-sample validation (match frontend strict rules)
  const messageFields: (keyof ValidationErrors)[] = [
    "sampleMessage1",
    "sampleMessage2",
    "sampleMessage3",
  ];

  samplesFromFieldsRaw.forEach((raw, idx) => {
    const key = messageFields[idx];
    if (!key) return;
    const trimmed = (raw || "").trim();
    if (!trimmed) {
      // only mark error if field is present at all or if it's one of the first 2
      if (idx < 2) {
        errors[key] = `Sample message #${idx + 1} is required.`;
      }
      return;
    }
    if (trimmed.length < 20 || trimmed.length > 320) {
      errors[key] =
        "Sample messages must be between 20 and 320 characters.";
    }
    if (!ensureHasStopLanguage(trimmed)) {
      errors[key] =
        'Sample messages must include opt-out language like "Reply STOP to opt out".';
    }
  });

  // If samples were only provided via blob, still validate each one generically
  if (!samplesFromFieldsRaw[0] && finalSamples.length) {
    finalSamples.forEach((m, idx) => {
      if (m.length < 20 || m.length > 320) {
        // don't overwrite a more specific field error
        if (!errors.sampleMessage1) {
          errors.sampleMessage1 =
            "Sample messages must be between 20 and 320 characters.";
        }
      }
      if (!ensureHasStopLanguage(m)) {
        if (!errors.sampleMessage1) {
          errors.sampleMessage1 =
            'Sample messages must include opt-out language like "Reply STOP to opt out".';
        }
      }
    });
  }

  // Opt-in details
  const optIn = (optInDetails || "").trim();
  if (!optIn) {
    errors.optInDetails = "Opt-in details are required.";
  } else {
    if (optIn.length < 300) {
      errors.optInDetails =
        "Opt-in description must be detailed (at least a few full sentences describing the form, disclosure, and consent).";
    } else if (
      !/consent/i.test(optIn) ||
      !/(by clicking|by entering)/i.test(optIn)
    ) {
      errors.optInDetails =
        'Opt-in description must clearly state that the user gives consent by clicking/entering their information (e.g., "By entering your information and clicking this button, you consent to receive calls/texts...").';
    }
  }

  // Volume
  const volDigits = (volume || "").replace(/[^\d]/g, "");
  if (!volDigits) {
    errors.volume =
      "Estimated monthly volume is required as a number (e.g., 500).";
  } else {
    const num = parseInt(volDigits, 10);
    if (Number.isNaN(num) || num <= 0) {
      errors.volume = "Monthly volume must be a positive number.";
    } else if (num > 250000) {
      errors.volume =
        "Monthly volume must be realistic for review (<= 250,000 messages).";
    }
  }

  // If any errors exist, stop here and do NOT touch Twilio
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      message:
        "Submission contains missing or invalid fields. Please fix the highlighted issues and try again.",
      errors,
    });
  }

  // ---- determine if this should be treated as a resubmit ----
  await mongooseConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const userId = String(user._id);
  const existingA2P = await A2PProfile.findOne({
    userId,
  }).lean<IA2PProfile | null>();

  const existingBrandStatus = String(
    existingA2P?.brandStatus || "",
  ).toUpperCase();
  const hasExistingFailedBrand =
    !!existingA2P?.brandSid && existingBrandStatus === "FAILED";

  // If there is an existing FAILED brand for this bundle, automatically mark this as a resubmit.
  const resubmit = hasExistingFailedBrand;

  // ---- normalize payload for downstream endpoints ----
  const normalizedUseCase = body.useCase || body.usecaseCode || "LOW_VOLUME";

  const normalizedState = addressState!.trim().toUpperCase();
  const normalizedCountry = addressCountry!.trim().toUpperCase();

  // Phone is already validated as exactly 10 digits
  const normalizedPhone = phone!.trim();

  const finalSampleArray = finalSamples.length
    ? finalSamples
    : samplesFromFieldsRaw.map((s) => (s || "").trim()).filter(Boolean);

  const startPayload: Record<string, any> = {
    businessName: businessName!.trim(),
    ein: normalizedEin, // send cleaned 9-digit EIN
    website: website!.trim(),

    // address parts
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

    // campaign selection
    usecaseCode: normalizedUseCase,

    // messages (send both joined + individual for compatibility)
    sampleMessages: finalSampleArray.join("\n\n"),
    sampleMessage1: finalSampleArray[0],
    sampleMessage2: finalSampleArray[1],
    sampleMessage3: finalSampleArray[2],

    // consent/volume
    optInDetails: optInDetails!,
    volume: volDigits, // normalized numeric string

    // resubmit hint to /api/a2p/start
    resubmit,

    // optional artifacts (only include if present)
    ...(body.optInScreenshotUrl
      ? { optInScreenshotUrl: body.optInScreenshotUrl }
      : {}),
    ...(body.landingOptInUrl ? { landingOptInUrl: body.landingOptInUrl } : {}),
    ...(body.landingTosUrl ? { landingTosUrl: body.landingTosUrl } : {}),
    ...(body.landingPrivacyUrl
      ? { landingPrivacyUrl: body.landingPrivacyUrl }
      : {}),
  };

  // Selector + helper to persist last submitted values into A2PProfile
  const profileSelector = existingA2P
    ? { _id: existingA2P._id }
    : { userId };

  const persistLastSubmitted = async () => {
    try {
      await A2PProfile.updateOne(
        profileSelector,
        {
          $set: {
            lastSubmittedUseCase: normalizedUseCase,
            lastSubmittedSampleMessages: finalSampleArray,
            lastSubmittedOptInDetails: optInDetails!,
            // Keep simple normalized copies the sync job can also read
            useCase: normalizedUseCase,
            usecaseCode: normalizedUseCase,
            sampleMessages: finalSampleArray,
            sampleMessage1: finalSampleArray[0],
            sampleMessage2: finalSampleArray[1],
            sampleMessage3: finalSampleArray[2],
            optInDetails: optInDetails!,
            volume: volDigits,
          },
        },
        // We allow upsert in case /api/a2p/start created the profile
        // using the same userId key after we fetched existingA2P.
        { upsert: true },
      );
    } catch (e) {
      console.error("A2P persistLastSubmitted error:", e);
    }
  };

  // Forward the user's cookies so /api/a2p/* can see the same session
  const cookie = req.headers.cookie || "";
  const commonHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cookie) {
    commonHeaders["Cookie"] = cookie;
  }

  try {
    // 1) Start the A2P flow (creates/links everything, idempotent)
    const startRes = await fetch(`${BASE_URL}/api/a2p/start`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify(startPayload),
    });

    const startData = await startRes.json().catch(() => ({}));
    if (!startRes.ok) {
      return res.status(startRes.status).json({
        message: startData?.message || "A2P start failed",
      });
    }

    const startInner = (startData && startData.data) || startData || {};

    // Persist the latest submitted campaign details so that
    // /api/a2p/sync can auto-create a campaign as soon as the
    // brand is approved, even if there was no campaign at this time.
    await persistLastSubmitted();

    // Extract brand status + campaign eligibility from /api/a2p/start response
    const rawBrandStatus =
      startData?.brandStatus ||
      startInner.brandStatus ||
      (startInner.brand && startInner.brand.status);
    const brandStatus = rawBrandStatus
      ? String(rawBrandStatus).toUpperCase()
      : undefined;

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
      startData?.brandFailureReason ||
      startInner.brandFailureReason ||
      startInner.brandFailureReasons ||
      undefined;

    // If brand is not in an approved/ready state, DO NOT create/submit a campaign now.
    // Our /api/a2p/sync job will auto-create the campaign later once Twilio approves it.
    if (canCreateCampaign === false) {
      const msg =
        brandStatus === "FAILED"
          ? "Your brand registration is currently FAILED. We created/updated your A2P profile, but cannot create a campaign until Twilio approves your brand."
          : "Your brand registration is not yet approved. We created/updated your A2P profile; once Twilio approves your brand, we can create the campaign.";

      return res.status(200).json({
        ok: true,
        message: msg,
        brandStatus,
        brandFailureReason,
        start: startInner,
      });
    }

    // If for some reason we still don't think we can create a campaign,
    // just return success for the brand/profile and let the sync job
    // handle things later.
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

    // 2) Ensure campaign reflects the latest info (idempotent),
    //    but only when the brand is in an allowed state.
    const submitPayload = {
      useCase: normalizedUseCase,
      messageFlow: optInDetails!,
      sampleMessages: finalSampleArray,
      // flags defaulted by /api/a2p/submit-campaign
    };

    const submitRes = await fetch(`${BASE_URL}/api/a2p/submit-campaign`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify(submitPayload),
    });

    const submitData = await submitRes.json().catch(() => ({}));
    if (!submitRes.ok) {
      // Not fatal for brand/profile creation; return error for UI
      return res.status(submitRes.status).json({
        message: submitData?.message || "Campaign submission failed",
        brandStatus,
        brandFailureReason,
        start: startInner,
      });
    }

    return res.status(200).json({
      ok: true,
      message:
        "Submitted. We’ll email you when it’s approved or if reviewers need changes.",
      start: startInner,
      campaign: submitData,
      brandStatus,
    });
  } catch (e: any) {
    console.error("registerA2P error:", e);
    return res
      .status(500)
      .json({ message: e?.message || "registerA2P failed" });
  }
}
