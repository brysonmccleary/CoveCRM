import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import FunnelSubmission from "@/models/FunnelSubmission";
import { checkDuplicate } from "@/lib/leads/checkDuplicate";
import { sendSms } from "@/lib/twilio/sendSMS";

const KAYLA_SIGNUP_URL =
  process.env.KAYLA_SIGNUP_URL ||
  "https://www.covecrm.com/signup?code=COVE50";
const KAYLA_COUPON_CODE = process.env.KAYLA_COUPON_CODE || "COVE50";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type SubmitResponse = {
  ok: boolean;
  callQueued: boolean;
  smsSent: boolean;
  message: string;
  reason?: string;
};

const KAYLA_LOCKED_OWNER_EMAIL = "bryson.mccleary1@gmail.com";

function getIp(req: NextApiRequest): string {
  const xfwd = req.headers["x-forwarded-for"];
  if (Array.isArray(xfwd)) return xfwd[0] || "";
  if (typeof xfwd === "string") return xfwd.split(",")[0]?.trim() || "";
  return req.socket?.remoteAddress || "";
}

function normalizePhoneForLead(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (/^\+1\d{10}$/.test(raw)) return raw;
  return "";
}

function splitFullName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function buildKaylaSms(firstName: string, attemptedCall: boolean) {
  const safeFirstName = firstName || "there";
  if (attemptedCall) {
    return `Hey ${safeFirstName}, it’s Kayla from CoveCRM. Here’s your private signup link and code: ${KAYLA_SIGNUP_URL} — use ${KAYLA_COUPON_CODE} to save $50/mo. After signup, open Ask Kayla in your dashboard and I can help you get set up. Reply STOP to opt out.`;
  }
  return `Hey ${safeFirstName}, it’s Kayla from CoveCRM. Here’s your private signup link and code: ${KAYLA_SIGNUP_URL} — use ${KAYLA_COUPON_CODE} to save $50/mo. After signup, open Ask Kayla in your dashboard and I can help you get set up. Reply STOP to opt out.`;
}

async function resolveOwnerUser() {
  return await User.findOne({ email: "bryson.mccleary1@gmail.com" });
}

async function resolveOwnerFolder(ownerEmail: string) {
  // Always locked to bryson.mccleary1@gmail.com — no global leak possible
  const LOCKED_EMAIL = "bryson.mccleary1@gmail.com";
  if (ownerEmail !== LOCKED_EMAIL) return null;

  // Try to find existing KAYLA LEADS folder
  let folder = await Folder.findOne({
    userEmail: ownerEmail,
    name: "KAYLA LEADS",
  }).lean<any>();

  // Auto-create if it doesn't exist yet
  if (!folder) {
    folder = await Folder.create({
      name: "KAYLA LEADS",
      userEmail: ownerEmail,
      assignedDrips: [],
      aiFirstCallEnabled: true,
      aiFirstCallDelayMinutes: 1,
    });
    console.info("[KAYLA] Auto-created KAYLA LEADS folder:", String((folder as any)._id));
  }

  // Ensure AI first call is enabled on the folder
  await Folder.updateOne(
    { _id: (folder as any)._id },
    { $set: { aiFirstCallEnabled: true, aiFirstCallDelayMinutes: 1 } }
  );

  return folder;
}

function resolveKaylaFromNumber(user: any) {
  const numbers = Array.isArray(user?.twilio?.phoneNumbers)
    ? user.twilio.phoneNumbers
    : Array.isArray(user?.numbers)
      ? user.numbers
      : [];
  const defaultSmsNumberId = String(user?.defaultSmsNumberId || "");
  const selected =
    (defaultSmsNumberId
      ? numbers.find((entry: any) => {
          const entryId = entry?._id ? String(entry._id) : "";
          return entryId === defaultSmsNumberId || String(entry?.sid || "") === defaultSmsNumberId;
        })
      : null) || numbers[0];

  const fromNumber = String(selected?.phoneNumber || selected?.number || "").trim();
  const owned = numbers.some((entry: any) => {
    const phone = String(entry?.phoneNumber || entry?.number || "").trim();
    return phone && phone === fromNumber;
  });

  if (!fromNumber || !owned) {
    throw new Error("Kayla owner outbound number is not assigned.");
  }

  return fromNumber;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SubmitResponse>,
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      callQueued: false,
      smsSent: false,
      message: "Method not allowed",
    });
  }

  const {
    fullName = "",
    workEmail = "",
    phone = "",
    utmSource = "",
    utmCampaign = "",
    utmMedium = "",
    referrer = "",
  } = req.body || {};

  const cleanFullName = String(fullName || "").trim();
  const cleanEmail = String(workEmail || "").trim().toLowerCase();
  const normalizedPhone = normalizePhoneForLead(String(phone || ""));

  if (!cleanFullName) {
    return res.status(400).json({
      ok: false,
      callQueued: false,
      smsSent: false,
      message: "Full name is required.",
    });
  }

  if (!EMAIL_RE.test(cleanEmail)) {
    return res.status(400).json({
      ok: false,
      callQueued: false,
      smsSent: false,
      message: "Enter a valid work email.",
    });
  }

  if (!normalizedPhone) {
    return res.status(400).json({
      ok: false,
      callQueued: false,
      smsSent: false,
      message: "Enter a valid phone number.",
    });
  }

  await mongooseConnect();

  const ownerUser = await resolveOwnerUser();
  const ownerEmail = String(ownerUser?.email || "").trim().toLowerCase();
  if (ownerEmail !== KAYLA_LOCKED_OWNER_EMAIL) {
    console.error("[KAYLA] owner verification failed");
    return res.status(500).json({
      ok: false,
      callQueued: false,
      smsSent: false,
      message: "Kayla owner configuration invalid.",
    });
  }
  console.info("[KAYLA] owner verified bryson.mccleary1@gmail.com");

  const ownerFolder = await resolveOwnerFolder(ownerEmail);
  if (!ownerFolder?._id) {
    console.error("[KAYLA] folder verification failed");
    return res.status(500).json({
      ok: false,
      callQueued: false,
      smsSent: false,
      message: "Kayla folder configuration invalid.",
    });
  }
  console.info(`[KAYLA] folder verified ${String(ownerFolder._id)}`);

  let fromNumber = "";
  try {
    fromNumber = resolveKaylaFromNumber(ownerUser);
  } catch (err: any) {
    console.error("[KAYLA] from number verification failed", err?.message || err);
    return res.status(500).json({
      ok: false,
      callQueued: false,
      smsSent: false,
      message: "Kayla outbound number configuration invalid.",
    });
  }

  const { firstName, lastName } = splitFullName(cleanFullName);
  const rawPayload = {
    fullName: cleanFullName,
    workEmail: cleanEmail,
    phone: normalizedPhone,
    utmSource: String(utmSource || "").trim(),
    utmCampaign: String(utmCampaign || "").trim(),
    utmMedium: String(utmMedium || "").trim(),
    referrer: String(referrer || "").trim(),
    campaignName: "Kayla Landing Page",
    sourceType: "kayla_landing_page",
    leadSource: "kayla_page",
  };

  let existingLeadId = "";
  let leadId = "";
  let callQueued = false;
  let smsSent = false;
  let reason = "";
  let attemptedCall = false;

  const dupCheck = await checkDuplicate(ownerEmail, normalizedPhone, cleanEmail);
  existingLeadId = dupCheck.existingLeadId || "";

  const submission = await FunnelSubmission.create({
    userId: ownerUser?._id || null,
    userEmail: ownerEmail || "",
    slug: "kayla",
    leadType: "kayla_page",
    firstName,
    lastName,
    phone: normalizedPhone,
    email: cleanEmail,
    rawPayload,
    wasDuplicate: !!existingLeadId,
    ipAddress: getIp(req),
    userAgent: String(req.headers["user-agent"] || ""),
  });

  if (existingLeadId) {
    leadId = existingLeadId;
    await Lead.updateOne(
      { _id: existingLeadId, userEmail: ownerEmail },
      {
        $set: {
          folderId: ownerFolder._id,
          folderName: "KAYLA LEADS",
        },
      },
    );
  } else {
    const lead = await Lead.create({
      "First Name": firstName,
      "Last Name": lastName,
      Email: cleanEmail,
      email: cleanEmail,
      Phone: normalizedPhone,
      phoneLast10: normalizedPhone.replace(/\D/g, "").slice(-10),
      normalizedPhone: normalizedPhone, // E.164 from normalizePhoneForLead()
      userEmail: ownerEmail,
      folderId: ownerFolder._id,
      folderName: "KAYLA LEADS",
      status: "New",
      sourceType: "kayla_landing_page",
      leadSource: "kayla_page",
      realTimeEligible: true,
      landingPageSlug: "kayla",
      campaignName: "Kayla Landing Page",
      utmSource: rawPayload.utmSource,
      utmCampaign: rawPayload.utmCampaign,
      utmMedium: rawPayload.utmMedium,
      referrer: rawPayload.referrer,
      Notes: [
        "Source: Kayla Landing Page",
        rawPayload.utmSource ? `UTM Source: ${rawPayload.utmSource}` : "",
        rawPayload.utmCampaign ? `UTM Campaign: ${rawPayload.utmCampaign}` : "",
        rawPayload.utmMedium ? `UTM Medium: ${rawPayload.utmMedium}` : "",
        rawPayload.referrer ? `Referrer: ${rawPayload.referrer}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    leadId = String((lead as any)._id);
  }

  console.info("[KAYLA] lead routed to Kayla folder", {
    leadId,
    folderId: String(ownerFolder._id),
  });

  // TODO: enroll lead in Kayla nurture drip once a campaign is configured on the KAYLA LEADS folder.
  // Call enrollOnNewLeadIfWatched({ userEmail: ownerEmail, folderId: String(ownerFolder._id), leadId, startMode: "now" })
  // from lib/drips/enrollOnNewLeadIfWatched.ts once DripFolderEnrollment watcher exists.
  console.info("[KAYLA] drip enrollment skipped — no drip watcher configured on KAYLA LEADS folder yet", {
    leadId,
    folderId: String(ownerFolder._id),
  });

  await FunnelSubmission.updateOne(
    { _id: (submission as any)._id },
    { $set: { createdLeadId: leadId ? new mongoose.Types.ObjectId(leadId) : null } },
  );

  if (leadId) {
    try {
      const voiceServerUrl = process.env.AI_VOICE_SERVER_URL || "https://covecrm-ai-voice.onrender.com";
      const apiSecret = process.env.COVECRM_API_SECRET || "";

      const callRes = await fetch(`${voiceServerUrl}/trigger-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-secret": apiSecret,
        },
        body: JSON.stringify({
          userEmail: ownerEmail,
          leadId,
          leadPhone: normalizedPhone,
          scriptKey: "kayla_signup",
          voiceKey: "iris",
          fromNumber,
        }),
      });

      const callData = await callRes.json().catch(() => ({}));
      callQueued = callRes.ok && !!(callData as any)?.ok;
      attemptedCall = callQueued;
      if (!callQueued) {
        reason = `Direct call trigger failed: ${(callData as any)?.error || callRes.status}`;
      }
    } catch (err: any) {
      reason = `Direct call trigger error: ${err?.message || "unknown"}`;
    }
  }

  if (leadId) {
    try {
      await sendSms({
        to: normalizedPhone,
        body: buildKaylaSms(firstName, attemptedCall),
        userEmail: ownerEmail,
        leadId,
        source: "manual",
      });
      smsSent = true;
    } catch (err: any) {
      smsSent = false;
      reason = reason || `SMS send skipped: ${err?.message || "configuration blocked send"}`;
    }
  }

  const message = callQueued
    ? "Kayla has your info. Watch for her call first — then she can text you the private discount code."
    : "Kayla has your info. We saved your request, and she can text you the private discount code as soon as the account routing is ready.";

  return res.status(200).json({
    ok: true,
    callQueued,
    smsSent,
    message,
    ...(reason ? { reason } : {}),
  });
}
