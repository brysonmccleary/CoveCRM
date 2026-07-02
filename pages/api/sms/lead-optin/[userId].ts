import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import SmsConsentEvidence from "@/models/SmsConsentEvidence";
import { buildLeadGenerationConsentText } from "@/lib/a2p/flowSelection";

const CONSENT_VERSION = "lead_generation_v1";

function getIp(req: NextApiRequest): string {
  const xfwd = req.headers["x-forwarded-for"];
  if (Array.isArray(xfwd)) return xfwd[0] || "";
  if (typeof xfwd === "string") return xfwd.split(",")[0]?.trim() || "";
  return req.socket?.remoteAddress || "";
}

function getBaseUrl(req: NextApiRequest): string {
  const env = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "";
  if (env) return (env.startsWith("http") ? env : `https://${env}`).replace(/\/$/, "");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "www.covecrm.com");
  const proto = String(req.headers["x-forwarded-proto"] || "https");
  return `${proto}://${host}`.replace(/\/$/, "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const userId = String(req.query.userId || "").trim();
  const firstName = String(req.body?.firstName || "").trim();
  const lastName = String(req.body?.lastName || "").trim();
  const phone = String(req.body?.phone || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const consentGiven = req.body?.consentGiven === true || req.body?.consentGiven === "true";

  if (!userId) return res.status(400).json({ ok: false, error: "Missing userId" });
  if (!firstName || !lastName || !phone) {
    return res.status(400).json({ ok: false, error: "First name, last name, and phone are required" });
  }
  // SMS consent is optional and not a condition of submitting the request.
  // consentGiven is recorded as-is in the evidence record below.

  await mongooseConnect();
  const user = await User.findById(userId).lean<any>();
  if (!user) return res.status(404).json({ ok: false, error: "Sender not found" });
  const a2p = await A2PProfile.findOne({ userId }).lean<any>();
  const consentText = buildLeadGenerationConsentText({
    contactFirstName: a2p?.contactFirstName,
    contactLastName: a2p?.contactLastName,
    businessName: a2p?.businessName || user?.name,
    campaignType: "final_expense",
  });

  const baseUrl = getBaseUrl(req);
  const pageUrl = `${baseUrl}/sms/lead-optin/${encodeURIComponent(userId)}`;
  const privacyUrl = `${baseUrl}/sms/lead-optin-privacy/${encodeURIComponent(userId)}`;
  const termsUrl = `${baseUrl}/sms/lead-optin-terms/${encodeURIComponent(userId)}`;

  const record = await SmsConsentEvidence.create({
    userId,
    userEmail: String(user.email || ""),
    flow: "lead_generation",
    firstName,
    lastName,
    phone,
    email,
    consentGiven,
    consentText,
    consentTextVersion: CONSENT_VERSION,
    pageUrl,
    privacyUrl,
    termsUrl,
    ip: getIp(req),
    userAgent: String(req.headers["user-agent"] || ""),
    submittedAt: new Date(),
  });

  return res.status(200).json({ ok: true, id: String(record._id) });
}
