// pages/api/registerA2P.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

/**
 * This endpoint orchestrates the full A2P flow:
 * 1) POST /api/a2p/start (creates/links TrustHub entities, Brand, Messaging Service,
 *    and, if the Brand is already eligible, initial Campaign)
 * 2) POST /api/a2p/submit-campaign (idempotently aligns the campaign with latest
 *    use-case, flow, and samples WHEN the Brand is eligible)
 *
 * Notes:
 * - Screenshot + links are optional but recommended.
 * - Use-case comes from `useCase` or `usecaseCode` (either is accepted).
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

type BodyIn = {
  businessName?: string;
  ein?: string;
  website?: string;
  address?: string;
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

  // ---- basic validation (screenshot + links OPTIONAL) ----
  const missing: string[] = [];
  const requiredKeys: (keyof BodyIn)[] = [
    "businessName",
    "ein",
    "website",
    "address",
    "email",
    "phone",
    "contactFirstName",
    "contactLastName",
    "optInDetails",
    "volume",
  ];
  for (const k of requiredKeys) {
    if (!body[k] || String(body[k]).trim() === "") missing.push(k);
  }

  // EIN: must be 9 digits
  let normalizedEin = "";
  if (body.ein) {
    normalizedEin = String(body.ein).replace(/[^\d]/g, "");
    if (normalizedEin.length !== 9) {
      missing.push(
        'ein (must be a valid 9-digit EIN, e.g. "123456789" or "12-3456789")',
      );
    }
  }

  // messages: allow either 3 fields or a joined blob
  const samplesFromBlob = (body.sampleMessages || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const samplesFromFields = [
    body.sampleMessage1,
    body.sampleMessage2,
    body.sampleMessage3,
  ]
    .map((s) => (s || "").trim())
    .filter(Boolean);

  const finalSamples = (samplesFromFields.length
    ? samplesFromFields
    : samplesFromBlob
  ).filter(Boolean);

  if (finalSamples.length < 2)
    missing.push("sampleMessages (need at least 2 samples via blob or fields)");

  if (missing.length) {
    return res.status(400).json({
      message: `Missing or invalid required fields: ${missing.join(", ")}`,
    });
  }

  // ---- normalize payload for downstream endpoints ----
  const normalizedUseCase = body.useCase || body.usecaseCode || "LOW_VOLUME";

  const startPayload = {
    businessName: body.businessName!.trim(),
    ein: normalizedEin, // send cleaned 9-digit EIN
    website: body.website!.trim(),
    address: body.address!.trim(),
    email: body.email!.trim(),
    phone: body.phone!.trim(),
    contactTitle: (body.contactTitle || "Owner").trim(),
    contactFirstName: body.contactFirstName!.trim(),
    contactLastName: body.contactLastName!.trim(),

    // campaign selection
    usecaseCode: normalizedUseCase,

    // messages (send both joined + individual for compatibility)
    sampleMessages: finalSamples.join("\n\n"),
    sampleMessage1: finalSamples[0],
    sampleMessage2: finalSamples[1],
    sampleMessage3: finalSamples[2],

    // consent/volume
    optInDetails: body.optInDetails!,
    volume: body.volume || "Low",

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

    // Extract brand status + campaign eligibility from /api/a2p/start response
    const startInner = (startData && startData.data) || startData || {};
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

    // If brand is not in an approved/ready state, DO NOT create/submit a campaign.
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

    // 2) Ensure campaign reflects the latest info (idempotent),
    //    but only when the brand is in an allowed state.
    const submitPayload = {
      useCase: normalizedUseCase,
      messageFlow: body.optInDetails!,
      sampleMessages: finalSamples,
      // leave flags defaulted by the handler (hasEmbeddedLinks true, etc.)
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
