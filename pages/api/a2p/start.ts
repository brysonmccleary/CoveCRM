// /pages/api/a2p/start.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { Buffer } from "buffer";
import A2PProfile from "@/models/A2PProfile";
import type { IA2PProfile } from "@/models/A2PProfile";
import User from "@/models/User";
import {
  getClientForUser,
  TwilioResolvedAuth,
} from "@/lib/twilio/getClientForUser";

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

// Brand statuses that are safe to attach an A2P campaign to
const BRAND_OK_FOR_CAMPAIGN = new Set([
  "APPROVED",
  "ACTIVE",
  "IN_USE",
  "REGISTERED",
]);

function log(...args: any[]) {
  console.log("[A2P start]", ...args);
}

// NOTE: We keep helper signatures unchanged (smallest-change).
// We set these per-request in the handler.
let client: any = null;
let twilioAccountSidUsed: string = "";

// ✅ NEW (additive): capture the exact auth used by getClientForUser so raw fetch
// can match tenant + auth mode correctly.
let twilioResolvedAuth: TwilioResolvedAuth | null = null;

// ---------------- helpers ----------------
function required<T>(v: T, name: string): T {
  if (!v) throw new Error(`Missing required field: ${name}`);
  return v;
}

// EIN helpers: store display format, send digits-only to Twilio
function normalizeEinDigits(raw: unknown): string {
  const einDigits = String(raw || "")
    .replace(/[^\d]/g, "")
    .slice(0, 9);
  if (einDigits.length !== 9) {
    throw new Error(
      "EIN must be 9 digits (business_registration_number is invalid).",
    );
  }
  return einDigits;
}

function formatEinDisplay(einDigits: string): string {
  // 00-0000000
  return `${einDigits.slice(0, 2)}-${einDigits.slice(2)}`;
}

// Ensure campaign description meets Twilio min/max length requirements
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

  // Trim to Twilio's max (safe 1024 chars)
  if (desc.length > 1024) desc = desc.slice(0, 1024);

  // Guarantee at least 40 chars
  if (desc.length < 40) {
    desc +=
      " This campaign sends compliant follow-up and reminder messages to warm leads.";
  }

  return desc;
}

function isSidLike(value: any, prefix: string) {
  return typeof value === "string" && value.startsWith(prefix);
}

// ✅ Added: deterministic Twilio "not found" detection
function isTwilioNotFound(err: any): boolean {
  const code = Number(err?.code);
  const status = Number(err?.status);
  const message = String(err?.message || "");
  return (
    code === 20404 ||
    status === 404 ||
    /20404/.test(message) ||
    /not found/i.test(message)
  );
}

// ✅ Added: unset stale SID(s) on profile and record lastError proof
async function clearStaleSidOnProfile(args: {
  a2pId: string;
  unset: Record<string, any>;
  reason: string;
  extra?: any;
}) {
  const { a2pId, unset, reason, extra } = args;
  log("recover: clearing stale Twilio SID(s) on A2PProfile", {
    a2pId,
    unset,
    reason,
    twilioAccountSidUsed,
    ...(extra ? { extra } : {}),
  });

  await A2PProfile.updateOne(
    { _id: a2pId },
    {
      $unset: unset,
      $set: {
        lastError: reason,
        lastSyncedAt: new Date(),
        twilioAccountSidLastUsed: twilioAccountSidUsed,
      } as any,
      $push: {
        approvalHistory: {
          stage: "recovered_stale_sid",
          at: new Date(),
          note: reason,
        },
      },
    },
  );
}

function toFormUrlEncoded(body: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) params.append(k, v);
  return params.toString();
}

function basicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

async function trusthubFetch(
  auth: TwilioResolvedAuth,
  method: "POST" | "GET",
  path: string,
  form?: Record<string, string>,
) {
  const url = `https://trusthub.twilio.com${path}`;

  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(auth.username, auth.password),
  };

  // ✅ CRITICAL: force tenant scope. This prevents “created under parent account” mistakes.
  // Using the same accountSid your client is scoped to.
  headers["X-Twilio-AccountSid"] = twilioAccountSidUsed;

  let body: string | undefined = undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = toFormUrlEncoded(form || {});
  }

  const resp = await fetch(url, { method, headers, body });

  const text = await resp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    const code = json?.code ?? resp.status;
    const message = json?.message ?? text ?? `HTTP ${resp.status}`;
    throw new Error(
      `TrustHub ${method} ${path} failed (${resp.status}) code=${code} message=${message}`,
    );
  }

  return json ?? text;
}

// ✅ FIXED: SupportingDocuments must prefer SDK when present; raw TrustHub fetch as fallback.
// Do NOT remove the raw fallback — we keep it for safety.
async function createSupportingDocumentRaw(args: {
  friendlyName: string;
  type: string;
  attributes: Record<string, any>;
}) {
  const { friendlyName, type, attributes } = args;

  // ---- Preferred: official SDK surface (your logs show this exists) ----
  const sdk = (client as any)?.trusthub?.v1?.supportingDocuments;
  if (sdk && typeof sdk.create === "function") {
    log("step: supportingDocuments.create SDK", {
      type,
      attributes,
      twilioAccountSidUsed,
    });

    const created = await sdk.create({
      friendlyName,
      type,
      attributes,
    });

    const sid = created?.sid || created?.Sid || created?.id;
    if (!sid || typeof sid !== "string") {
      throw new Error(
        `SupportingDocument SDK create did not return sid. Body: ${JSON.stringify(
          created,
        )}`,
      );
    }

    return { sid, raw: created };
  }

  // ---- Fallback: raw TrustHub host with tenant scope ----
  if (!twilioResolvedAuth) {
    throw new Error(
      "Missing twilioResolvedAuth (getClientForUser did not populate auth)",
    );
  }

  log("step: supportingDocuments.create RAW (trusthub.twilio.com)", {
    host: "trusthub.twilio.com",
    path: "/v1/SupportingDocuments",
    type,
    attributes,
    twilioAccountSidUsed,
    authMode: twilioResolvedAuth.mode,
    authUserMasked:
      twilioResolvedAuth.username?.slice(0, 4) +
      "…" +
      twilioResolvedAuth.username?.slice(-4),
  });

  // Twilio expects x-www-form-urlencoded with these exact keys.
  const created: any = await trusthubFetch(
    twilioResolvedAuth,
    "POST",
    "/v1/SupportingDocuments",
    {
      FriendlyName: friendlyName,
      Type: type,
      Attributes: JSON.stringify(attributes),
    },
  );

  const sid = created?.sid || created?.Sid || created?.id;
  if (!sid || typeof sid !== "string") {
    throw new Error(
      `SupportingDocument RAW create did not return sid. Body: ${JSON.stringify(
        created,
      )}`,
    );
  }

  // ✅ Optional but recommended: verify existence under same scope (catches wrong account instantly)
  try {
    await trusthubFetch(twilioResolvedAuth, "GET", `/v1/SupportingDocuments/${sid}`);
  } catch (e: any) {
    throw new Error(
      `SupportingDocument created but verification failed (likely wrong account scope). sid=${sid} error=${e?.message || String(e)}`,
    );
  }

  return { sid, raw: created };
}

// Twilio's TS typings for TrustHub vary across SDK versions; cast at the boundary.
async function assignEntityToCustomerProfile(
  customerProfileSid: string,
  objectSid: string,
) {
  log("step: entityAssignments.create (customerProfile)", {
    customerProfileSid,
    objectSid,
    twilioAccountSidUsed,
  });

  // CRITICAL CHECK:
  // - If the customerProfile is the PRIMARY and is already TWILIO_APPROVED, Twilio will reject adding new items.
  // - The PRIMARY_PROFILE_SID may exist only in master (not in subaccounts). If not accessible, skip safely.
  if (customerProfileSid === PRIMARY_PROFILE_SID) {
    try {
      const primary = await (client.trusthub.v1.customerProfiles(
        customerProfileSid,
      ) as any).fetch();
      const status = String(primary?.status || "").toUpperCase();

      if (status === "TWILIO_APPROVED") {
        log(
          "info: primary profile is TWILIO_APPROVED; skipping secondary assignment",
          {
            customerProfileSid,
            objectSid,
            status,
            twilioAccountSidUsed,
          },
        );
        return;
      }
    } catch (err: any) {
      log(
        "info: primary profile not accessible in this Twilio account; skipping secondary->primary assignment",
        {
          customerProfileSid,
          objectSid,
          twilioAccountSidUsed,
          code: err?.code,
          status: err?.status,
          message: err?.message,
        },
      );
      return;
    }
  }

  // Try SDK subresource first
  try {
    const cp: any = client.trusthub.v1.customerProfiles(
      customerProfileSid,
    ) as any;
    const sub =
      cp?.entityAssignments ||
      cp?.customerProfilesEntityAssignments ||
      cp?.customerProfilesEntityAssignment;

    if (sub && typeof sub.create === "function") {
      await sub.create({ objectSid });
      return;
    }

    log(
      "warn: customerProfiles entityAssignments subresource unavailable; falling back to raw request",
      { customerProfileSid, objectSid, twilioAccountSidUsed },
    );
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("TWILIO_APPROVED")) {
      log("info: bundle is TWILIO_APPROVED; skipping assignment", {
        customerProfileSid,
        objectSid,
        message: msg,
        twilioAccountSidUsed,
      });
      return;
    }
    log(
      "warn: error accessing customerProfiles entityAssignments; falling back to raw request",
      {
        customerProfileSid,
        message: err?.message,
        twilioAccountSidUsed,
      },
    );
  }

  // Fallback: direct HTTP call
  try {
    const url = `https://trusthub.twilio.com/v1/CustomerProfiles/${customerProfileSid}/EntityAssignments`;
    await (client as any).request({
      method: "POST",
      uri: url,
      formData: {
        ObjectSid: objectSid,
      },
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("TWILIO_APPROVED")) {
      log("info: bundle is TWILIO_APPROVED (fallback); skipping assignment", {
        customerProfileSid,
        objectSid,
        message: msg,
        twilioAccountSidUsed,
      });
      return;
    }
    throw err;
  }
}

// 🔧 TrustProduct entity assignment with SDK + raw fallback
async function assignEntityToTrustProduct(
  trustProductSid: string,
  objectSid: string,
) {
  log("step: entityAssignments.create (trustProduct)", {
    trustProductSid,
    objectSid,
    twilioAccountSidUsed,
  });

  // Try SDK subresource first (varies across SDK versions)
  try {
    const tp: any = client.trusthub.v1.trustProducts(trustProductSid) as any;
    const sub =
      tp?.entityAssignments ||
      tp?.trustProductsEntityAssignments ||
      tp?.trustProductsEntityAssignment;

    if (sub && typeof sub.create === "function") {
      await sub.create({ objectSid });
      return;
    }

    log(
      "warn: trustProducts entityAssignments subresource unavailable; falling back to raw request",
      { trustProductSid, objectSid, twilioAccountSidUsed },
    );
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("TWILIO_APPROVED")) {
      log("info: trustProduct is TWILIO_APPROVED; skipping assignment", {
        trustProductSid,
        objectSid,
        message: msg,
        twilioAccountSidUsed,
      });
      return;
    }
    log(
      "warn: error accessing trustProducts entityAssignments; falling back to raw request",
      {
        trustProductSid,
        message: err?.message,
        twilioAccountSidUsed,
      },
    );
  }

  // Fallback: direct HTTP call to TrustHub
  try {
    const url = `https://trusthub.twilio.com/v1/TrustProducts/${trustProductSid}/EntityAssignments`;
    await (client as any).request({
      method: "POST",
      uri: url,
      formData: {
        ObjectSid: objectSid,
      },
    });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("TWILIO_APPROVED")) {
      log("info: trustProduct TWILIO_APPROVED (fallback); skipping assignment", {
        trustProductSid,
        objectSid,
        message: msg,
        twilioAccountSidUsed,
      });
      return;
    }
    throw err;
  }
}

async function evaluateAndSubmitCustomerProfile(customerProfileSid: string) {
  try {
    log("step: customerProfiles.evaluations.create", {
      customerProfileSid,
      twilioAccountSidUsed,
    });
    const cp: any = client.trusthub.v1.customerProfiles(customerProfileSid);
    if ((cp as any).evaluations?.create) {
      await (cp as any).evaluations.create({});
    } else {
      throw new Error("evaluations subresource unavailable on SDK");
    }
  } catch (err: any) {
    log("warn: evaluations.create failed (customerProfile)", {
      customerProfileSid,
      twilioAccountSidUsed,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
      message: err?.message,
    });
  }
  try {
    log("step: customerProfiles.update(pending-review)", {
      customerProfileSid,
      twilioAccountSidUsed,
    });
    await client.trusthub.v1.customerProfiles(customerProfileSid).update({
      status: "pending-review",
    } as any);
  } catch (err: any) {
    log("warn: customerProfiles.update failed", {
      customerProfileSid,
      twilioAccountSidUsed,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
      message: err?.message,
    });
  }
}

async function evaluateAndSubmitTrustProduct(trustProductSid: string) {
  try {
    log("step: trustProducts.evaluations.create", {
      trustProductSid,
      twilioAccountSidUsed,
    });
    const tp: any = client.trusthub.v1.trustProducts(trustProductSid);
    if ((tp as any).evaluations?.create) {
      await (tp as any).evaluations.create({});
    } else {
      throw new Error("evaluations subresource unavailable on SDK");
    }
  } catch (err: any) {
    log("warn: evaluations.create failed (trustProduct)", {
      trustProductSid,
      twilioAccountSidUsed,
      code: err?.code,
      status: err?.status,
      moreInfo: err?.moreInfo,
      message: err?.message,
    });
  }
  try {
    log("step: trustProducts.update(pending-review)", {
      trustProductSid,
      twilioAccountSidUsed,
    });
    await client.trusthub.v1.trustProducts(trustProductSid).update({
      status: "pending-review",
    } as any);
  } catch (err: any) {
    log("warn: trustProducts.update failed", {
      trustProductSid,
      twilioAccountSidUsed,
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
  if (a2p?.messagingServiceSid) {
    // ✅ Added: verify stored Messaging Service still exists; recover if stale
    try {
      await client.messaging.v1.services(a2p.messagingServiceSid).fetch();
      return a2p.messagingServiceSid;
    } catch (err: any) {
      if (isTwilioNotFound(err)) {
        await clearStaleSidOnProfile({
          a2pId: String((a2p as any)._id),
          unset: { messagingServiceSid: 1 },
          reason: `Recovered stale messagingServiceSid (Twilio 20404): ${a2p.messagingServiceSid}`,
          extra: { sid: a2p.messagingServiceSid },
        });
      } else {
        throw err;
      }
    }
  }

  log("step: messaging.services.create (per-user)", {
    userId,
    userEmail,
    twilioAccountSidUsed,
  });

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

async function findExistingBrandForBundles(opts: {
  secondaryProfileSid: string;
  trustProductSid: string;
}) {
  try {
    const list = await (client.messaging.v1 as any).brandRegistrations.list({
      limit: 50,
    });

    const match = (list || []).find((b: any) => {
      const cp = b?.customerProfileBundleSid || b?.customerProfileSid;
      const tp =
        b?.a2PProfileBundleSid ||
        b?.a2pProfileBundleSid ||
        b?.a2PProfileSid;
      return cp === opts.secondaryProfileSid && tp === opts.trustProductSid;
    });

    const sid = match?.sid || match?.brandSid || match?.id;
    if (isSidLike(sid, "BN")) {
      return sid as string;
    }
    return undefined;
  } catch (e: any) {
    log("warn: could not list brandRegistrations to recover duplicate", {
      message: e?.message,
      code: e?.code,
      status: e?.status,
      twilioAccountSidUsed,
    });
    return undefined;
  }
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

    // ✅ Resolve the Twilio client in the *user subaccount* context (or self-billing creds).
    try {
      const resolved = await getClientForUser(session.user.email);
      client = resolved.client;
      twilioAccountSidUsed = resolved.accountSid;

      // ✅ NEW (additive): this is the auth we will use for TrustHub fetch fallback
      twilioResolvedAuth = resolved.auth;

      log("TrustHub SDK surface", {
        hasSupportingDocuments: Boolean(
          (client as any)?.trusthub?.v1?.supportingDocuments,
        ),
        trusthubV1Keys: Object.keys((client as any)?.trusthub?.v1 || {}),
      });
    } catch (e: any) {
      console.error("[A2P start] getClientForUser failed:", {
        email: session.user.email,
        message: e?.message,
      });
      return res.status(400).json({
        message:
          e?.message ||
          "Twilio is not connected for this user. Missing subaccount SID or platform credentials.",
      });
    }

    // Minimal, safe logging (no secrets)
    log("twilioAccountSidUsed", { twilioAccountSidUsed });

    // "twilio account in use" log must fetch the account matching twilioAccountSidUsed
    try {
      const acct = await client.api.v2010
        .accounts(twilioAccountSidUsed)
        .fetch();
      log("twilio account in use", {
        sid: acct?.sid,
        friendlyName: acct?.friendlyName,
      });
    } catch (e: any) {
      log("twilio account in use", {
        sid: twilioAccountSidUsed,
        message: e?.message,
      });
    }

    const {
      businessName,
      ein,
      website,

      // full address pieces from your A2P form
      address, // street line 1
      addressLine2,
      addressCity,
      addressState,
      addressPostalCode,
      addressCountry,

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

      // resubmit flag (when brand previously FAILED)
      resubmit,

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
    required(addressCity, "addressCity");
    required(addressState, "addressState");
    required(addressPostalCode, "addressPostalCode");
    required(addressCountry, "addressCountry");

    required(email, "email");
    required(phone, "phone");
    required(contactTitle, "contactTitle");
    required(contactFirstName, "contactFirstName");
    required(contactLastName, "contactLastName");
    required(optInDetails, "optInDetails");

    // Normalize EIN to digits for Twilio, but store human format 00-0000000
    const einDigits = normalizeEinDigits(ein);
    const einDisplay = formatEinDisplay(einDigits);

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
    const existing = await A2PProfile.findOne({ userId }).lean<
      IA2PProfile | null
    >();
    const now = new Date();

    const normalizedUseCase = String(usecaseCode || "LOW_VOLUME");

    // Upsert local A2PProfile
    const setPayload: Partial<IA2PProfile> & { userId: string } = {
      userId,
      businessName: String(businessName),
      ein: einDisplay, // stored with dash for UI
      website: String(website),

      address: String(address),
      addressLine2: addressLine2 ? String(addressLine2) : undefined,
      addressCity: String(addressCity),
      addressState: String(addressState),
      addressPostalCode: String(addressPostalCode),
      addressCountry: String(addressCountry),

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
      usecaseCode: normalizedUseCase,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSyncedAt: now,
    };

    // ✅ Additive: persist "last submitted" fields (schema may or may not include these)
    (setPayload as any).userEmail = user.email;
    (setPayload as any).lastSubmittedAt = now;
    (setPayload as any).lastSubmittedUseCase = normalizedUseCase;
    (setPayload as any).lastSubmittedOptInDetails = String(
      optInDetails || "",
    ).trim();
    (setPayload as any).lastSubmittedSampleMessages = samples;
    (setPayload as any).twilioAccountSidLastUsed = twilioAccountSidUsed;

    const messageFlowText: string = setPayload.optInDetails!;
    const useCaseCode: string =
      (setPayload.usecaseCode as string) || "LOW_VOLUME";

    const a2p = await A2PProfile.findOneAndUpdate<IA2PProfile>(
      { userId },
      { $set: setPayload as any },
      { upsert: true, returnDocument: "after" },
    );
    if (!a2p) throw new Error("Failed to upsert A2P profile");

    log("upserted A2PProfile", {
      userId,
      profileId: String((a2p as any)?._id),
      brandSid: (a2p as any).brandSid,
      usa2pSid: (a2p as any).usa2pSid,
      twilioAccountSidUsed,
    });

    // Ensure per-user Messaging Service
    const messagingServiceSid = await ensureMessagingServiceForUser(
      userId,
      user.email,
    );

    // Idempotent short-circuit (legacy path where brand + campaign already exist)
    if ((a2p as any).brandSid && (a2p as any).usa2pSid) {
      log("short-circuit: brand + usa2p already exist", {
        brandSid: (a2p as any).brandSid,
        usa2pSid: (a2p as any).usa2pSid,
        messagingServiceSid,
        twilioAccountSidUsed,
      });
      return res.status(200).json({
        message: "A2P already created for this user.",
        data: {
          messagingServiceSid,
          brandSid: (a2p as any).brandSid,
          usa2pSid: (a2p as any).usa2pSid,
          brandStatus: (a2p as any).brandStatus,
          canCreateCampaign: true,
          brandFailureReason: (a2p as any).brandFailureReason,
          twilioAccountSidUsed,
        },
      });
    }

    // ---------------- 1) Secondary Customer Profile (BU...) ----------------
    let secondaryProfileSid: string | undefined = (a2p as any).profileSid;

    // ✅ Added: recover if stored secondary profile SID is stale (20404)
    if (secondaryProfileSid) {
      try {
        await (
          client.trusthub.v1.customerProfiles(secondaryProfileSid) as any
        ).fetch();
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          await clearStaleSidOnProfile({
            a2pId: String(a2p._id),
            unset: {
              profileSid: 1,
              businessEndUserSid: 1,
              authorizedRepEndUserSid: 1,
              assignedToPrimary: 1,
              addressSid: 1,
              supportingDocumentSid: 1,
            },
            reason: `Recovered stale profileSid (Twilio 20404): ${secondaryProfileSid}`,
            extra: { profileSid: secondaryProfileSid },
          });
          secondaryProfileSid = undefined;
        } else {
          throw err;
        }
      }
    }

    if (!secondaryProfileSid) {
      log("step: customerProfiles.create (secondary)", {
        email: NOTIFY_EMAIL,
        policySid: SECONDARY_PROFILE_POLICY_SID,
        twilioAccountSidUsed,
      });

      const created = await client.trusthub.v1.customerProfiles.create({
        friendlyName: `${setPayload.businessName} – Secondary Customer Profile`,
        email: NOTIFY_EMAIL,
        policySid: SECONDARY_PROFILE_POLICY_SID,
        statusCallback: STATUS_CB,
      });

      secondaryProfileSid = created.sid;
      log("created customerProfile (secondary)", {
        secondaryProfileSid,
        twilioAccountSidUsed,
      });

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { profileSid: secondaryProfileSid } },
      );
    }

    // ---------------- 1.2) EndUser: business information + attach ----------------
    if (!(a2p as any).businessEndUserSid) {
      const rawWebsite = String(setPayload.website || "").trim();
      const websiteUrl =
        rawWebsite.startsWith("http://") || rawWebsite.startsWith("https://")
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
        // Twilio wants digits only here
        business_registration_number: einDigits,
      };

      log("step: endUsers.create (business_info)", {
        type: "customer_profile_business_information",
        friendlyName: `${setPayload.businessName} – Business Info`,
        attributesSummary: {
          keys: Object.keys(businessAttributes),
          length: JSON.stringify(businessAttributes).length,
        },
        twilioAccountSidUsed,
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
            twilioAccountSidUsed,
            code: err?.code,
            status: err?.status,
            moreInfo: err?.moreInfo,
            details: err?.details,
            message: err?.message,
          },
        );
        throw err;
      }

      await assignEntityToCustomerProfile(secondaryProfileSid!, businessEU.sid);

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { businessEndUserSid: businessEU.sid } },
      );
    }

    // ---------------- 1.4) Authorized representative + attach ----------------
    if (!(a2p as any).authorizedRepEndUserSid) {
      const rawPhone = String(setPayload.phone || "");
      const digitsOnlyPhone = rawPhone.replace(/[^\d]/g, "");

      if (digitsOnlyPhone.length < 10) {
        throw new Error(
          "Authorized representative phone must be a valid US number with 10 digits including area code.",
        );
      }

      // Use the last 10 digits as the US number and prepend +1 for E.164
      const last10 = digitsOnlyPhone.slice(-10);
      const repPhoneE164 = `+1${last10}`;

      const repAttributes = {
        last_name: setPayload.contactLastName,
        first_name: setPayload.contactFirstName,
        email: setPayload.email,
        business_title: setPayload.contactTitle,
        job_position: "Director",
        phone_number: repPhoneE164,
      };

      log("step: endUsers.create (authorized_rep)", {
        type: "authorized_representative_1",
        friendlyName: `${setPayload.businessName} – Authorized Rep`,
        attributesSummary: {
          keys: Object.keys(repAttributes),
          length: JSON.stringify(repAttributes).length,
        },
        twilioAccountSidUsed,
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
            twilioAccountSidUsed,
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

    // ---------------- 1.6) Address resource (Twilio Address) ----------------
    let addressSid: string | undefined = (a2p as any).addressSid;
    if (!addressSid) {
      log("step: addresses.create (mailing address)", {
        customerName: setPayload.businessName,
        twilioAccountSidUsed,
      });

      const addr = await client.addresses.create({
        customerName: String(setPayload.businessName),
        street: String(setPayload.address),
        streetSecondary: setPayload.addressLine2 || undefined,
        city: String(setPayload.addressCity),
        region: String(setPayload.addressState),
        postalCode: String(setPayload.addressPostalCode),
        isoCountry: String(setPayload.addressCountry || "US"),
      });

      addressSid = addr.sid;

      await A2PProfile.updateOne({ _id: a2p._id }, { $set: { addressSid } });
    }

    // ---------------- 1.7) SupportingDocument for address ----------------
    let supportingDocumentSid: string | undefined = (a2p as any)
      .supportingDocumentSid;
    if (!supportingDocumentSid && addressSid) {
      const attributes = {
        // leave as-is: your issue is 404/host routing, not attribute validation
        address_sids: addressSid,
      };

      log("step: supportingDocuments.create (customer_profile_address)", {
        attributes,
        twilioAccountSidUsed,
      });

      try {
        // ✅ FIXED: prefer SDK; fallback to TrustHub fetch w/ tenant scope + correct auth mode
        const sd = await createSupportingDocumentRaw({
          friendlyName: `${setPayload.businessName} – Address SupportingDocument`,
          type: "customer_profile_address",
          attributes,
        });

        supportingDocumentSid = sd.sid;

        await A2PProfile.updateOne(
          { _id: a2p._id },
          { $set: { supportingDocumentSid } },
        );
      } catch (err: any) {
        console.error("[A2P start] supportingDocuments RAW create failed", {
          twilioAccountSidUsed,
          code: err?.code,
          status: err?.status,
          message: err?.message,
          moreInfo: err?.moreInfo,
        });
        throw err;
      }
    }

    // ---------------- 1.8) Attach SupportingDocument to Secondary profile ----
    if (supportingDocumentSid) {
      await assignEntityToCustomerProfile(
        secondaryProfileSid!,
        supportingDocumentSid,
      );
    }

    // ---------------- 1.9) Assign Secondary to Primary (ISV) ----------------
    // CRITICAL CHECK:
    // If PRIMARY_PROFILE_SID cannot be fetched/used inside subaccounts, skip safely and continue.
    if (!(a2p as any).assignedToPrimary) {
      log("step: assign secondary to primary (attempt)", {
        primaryProfileSid: PRIMARY_PROFILE_SID,
        secondaryProfileSid,
        twilioAccountSidUsed,
      });

      await assignEntityToCustomerProfile(
        PRIMARY_PROFILE_SID,
        secondaryProfileSid!,
      );

      // Only mark assigned if the primary profile is accessible in this account.
      try {
        await (client.trusthub.v1.customerProfiles(
          PRIMARY_PROFILE_SID,
        ) as any).fetch();

        await A2PProfile.updateOne(
          { _id: a2p._id },
          { $set: { assignedToPrimary: true } },
        );
      } catch {
        log(
          "info: not marking assignedToPrimary because primary profile is not accessible in this account",
          { primaryProfileSid: PRIMARY_PROFILE_SID, twilioAccountSidUsed },
        );
      }
    }

    // Evaluate + submit Secondary
    await evaluateAndSubmitCustomerProfile(secondaryProfileSid!);

    // ---------------- 2) TrustProduct (A2P) if missing ----------------
    let trustProductSid: string | undefined = (a2p as any).trustProductSid;

    // ✅ Added: recover if stored trustProductSid is stale (20404)
    if (trustProductSid) {
      try {
        await (client.trusthub.v1.trustProducts(trustProductSid) as any).fetch();
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          await clearStaleSidOnProfile({
            a2pId: String(a2p._id),
            unset: {
              trustProductSid: 1,
              a2pProfileEndUserSid: 1,
            },
            reason: `Recovered stale trustProductSid (Twilio 20404): ${trustProductSid}`,
            extra: { trustProductSid },
          });
          trustProductSid = undefined;
        } else {
          throw err;
        }
      }
    }

    if (!trustProductSid) {
      log("step: trustProducts.create (A2P)", {
        email: NOTIFY_EMAIL,
        policySid: A2P_TRUST_PRODUCT_POLICY_SID,
        twilioAccountSidUsed,
      });

      const tp = await client.trusthub.v1.trustProducts.create({
        friendlyName: `${setPayload.businessName} – A2P Trust Product`,
        email: NOTIFY_EMAIL,
        policySid: A2P_TRUST_PRODUCT_POLICY_SID,
        statusCallback: STATUS_CB,
      });

      trustProductSid = tp.sid;

      log("created trustProduct", { trustProductSid, twilioAccountSidUsed });

      await A2PProfile.updateOne(
        { _id: a2p._id },
        { $set: { trustProductSid } },
      );
    }

    // ---------------- 2.2) EndUser: us_a2p_messaging_profile_information ----------------
    if (!(a2p as any).a2pProfileEndUserSid) {
      // Minimal, JSON-safe attributes Twilio accepts
      const a2pAttributes = {
        company_type: "PRIVATE_PROFIT",
        brand_contact_email: String(email),
      };

      log("step: endUsers.create (a2p_profile)", {
        type: "us_a2p_messaging_profile_information",
        friendlyName: `${setPayload.businessName} – A2P Messaging Profile`,
        attributesSummary: {
          keys: Object.keys(a2pAttributes),
          length: JSON.stringify(a2pAttributes).length,
        },
        twilioAccountSidUsed,
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
            twilioAccountSidUsed,
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

    // ---------------- 3) BrandRegistration (BN...) with resubmit logic -------
    let storedBrandStatus = (a2p as any).brandStatus as string | undefined;
    let brandSid: string | undefined = (a2p as any).brandSid;

    // ✅ Added: recover if stored brandSid is stale (20404)
    if (brandSid) {
      try {
        await client.messaging.v1.brandRegistrations(brandSid).fetch();
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          await clearStaleSidOnProfile({
            a2pId: String(a2p._id),
            unset: {
              brandSid: 1,
              brandStatus: 1,
              brandFailureReason: 1,
              usa2pSid: 1,
              campaignSid: 1,
            },
            reason: `Recovered stale brandSid (Twilio 20404): ${brandSid}`,
            extra: { brandSid },
          });
          brandSid = undefined;
          storedBrandStatus = undefined;
        } else {
          throw err;
        }
      }
    }

    const normalizedStoredStatus = String(storedBrandStatus || "").toUpperCase();
    const isResubmit = Boolean(resubmit);

    // If brand FAILED previously and user requested resubmission, update the existing Brand.
    if (brandSid && normalizedStoredStatus === "FAILED" && isResubmit) {
      log(
        "resubmit requested for existing FAILED brand; updating BrandRegistration",
        { brandSid, storedBrandStatus, twilioAccountSidUsed },
      );

      try {
        await client.messaging.v1.brandRegistrations(brandSid).update();

        await A2PProfile.updateOne(
          { _id: a2p._id },
          {
            $set: {
              // ✅ PATCH: "brand_resubmitted" is NOT in schema enum; keep schema-safe value.
              registrationStatus: "brand_submitted",
              applicationStatus: "pending",
              brandStatus: "PENDING",
              brandFailureReason: undefined,
              lastError: undefined,
              lastSyncedAt: new Date(),
              twilioAccountSidLastUsed: twilioAccountSidUsed,
            } as any,
            $unset: {
              declinedReason: 1,
              declineNotifiedAt: 1,
            },
            $push: {
              approvalHistory: {
                stage: "brand_submitted",
                at: new Date(),
                note: "Brand resubmitted via API (schema-safe status)",
              },
            },
          },
        );
      } catch (err: any) {
        log("warn: brandRegistrations.update (resubmit) failed", {
          brandSid,
          twilioAccountSidUsed,
          code: err?.code,
          status: err?.status,
          moreInfo: err?.moreInfo,
          message: err?.message,
        });
      }
    }

    // If we still don't have a Brand SID, create a new BrandRegistration
    if (!brandSid) {
      const payload: any = {
        customerProfileBundleSid: secondaryProfileSid!,
        a2PProfileBundleSid: trustProductSid!,
        brandType: "STANDARD",
      };

      log("step: brandRegistrations.create", {
        ...payload,
        twilioAccountSidUsed,
      });

      let brand: any | undefined;
      try {
        brand = await client.messaging.v1.brandRegistrations.create(payload);
      } catch (err: any) {
        // 20409/409 => duplicate brand for this bundle
        if (err?.code === 20409 || err?.status === 409) {
          log("warn: duplicate brand detected when creating", {
            code: err?.code,
            status: err?.status,
            message: err?.message,
            twilioAccountSidUsed,
          });

          const recovered = await findExistingBrandForBundles({
            secondaryProfileSid: secondaryProfileSid!,
            trustProductSid: trustProductSid!,
          });

          if (recovered) {
            brandSid = recovered;
            log("recovered existing brandSid from Twilio list()", {
              brandSid,
              twilioAccountSidUsed,
            });
          } else {
            throw new Error(
              "Twilio reported duplicate brand for this bundle, but we could not recover the existing BN SID. This usually happens right after deleting a brand in the Twilio UI.",
            );
          }
        } else {
          throw err;
        }
      }

      if (!brandSid && brand) {
        const sidCandidate = brand.sid || brand.brandSid || brand.id;
        if (isSidLike(sidCandidate, "BN")) {
          brandSid = sidCandidate;
        }
      }

      if (!brandSid) {
        throw new Error(
          "Brand registration did not return a BN SID. Check Twilio credentials and logs; the request may be hitting a different account or Twilio returned an unexpected response.",
        );
      }

      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            brandSid,
            registrationStatus: "brand_submitted",
            applicationStatus: "pending",
            lastError: undefined,
            twilioAccountSidLastUsed: twilioAccountSidUsed,
          } as any,
          $push: {
            approvalHistory: {
              stage: "brand_submitted",
              at: new Date(),
              note: "Brand registration created/recovered via API",
            },
          },
        },
      );
    }

    // ---------------- 3.1) Fetch brand status so we know if we can create a campaign ----------------
    let brandStatus: string | undefined;
    let brandFailureReason: string | undefined;

    try {
      const brand: any = await client.messaging.v1
        .brandRegistrations(brandSid!)
        .fetch();

      brandStatus = brand?.status;

      const rawFailure =
        brand?.failureReason ||
        brand?.failureReasons ||
        brand?.errors ||
        brand?.errorCodes ||
        undefined;

      if (!rawFailure) {
        brandFailureReason = undefined;
      } else if (typeof rawFailure === "string") {
        brandFailureReason = rawFailure;
      } else if (Array.isArray(rawFailure)) {
        try {
          brandFailureReason = rawFailure
            .map((x) =>
              typeof x === "string"
                ? x
                : typeof x === "object"
                  ? JSON.stringify(x)
                  : String(x),
            )
            .join("; ");
        } catch {
          brandFailureReason = String(rawFailure);
        }
      } else {
        try {
          brandFailureReason = JSON.stringify(rawFailure);
        } catch {
          brandFailureReason = String(rawFailure);
        }
      }

      log("brandRegistrations.fetch", {
        brandSid,
        status: brandStatus,
        failureReason: brandFailureReason,
        twilioAccountSidUsed,
      });

      const normalized = String(brandStatus || "").toUpperCase();

      const update: any = {
        brandStatus: brandStatus || undefined,
        brandFailureReason,
        lastSyncedAt: new Date(),
        twilioAccountSidLastUsed: twilioAccountSidUsed,
      };

      if (normalized === "FAILED") {
        update.registrationStatus = "rejected";
        update.applicationStatus = "declined";
        update.declinedReason =
          brandFailureReason || "Brand registration failed.";
        update.messagingReady = false;
        update.lastError = brandFailureReason;

        await A2PProfile.updateOne(
          { _id: a2p._id },
          {
            $set: update,
            $push: {
              approvalHistory: {
                stage: "rejected",
                at: new Date(),
                note: "Brand FAILED",
              },
            },
          },
        );
      } else {
        await A2PProfile.updateOne({ _id: a2p._id }, { $set: update });
      }
    } catch (err: any) {
      // ✅ Added: if fetch fails with 20404, clear and force recreate next call
      if (isTwilioNotFound(err)) {
        await clearStaleSidOnProfile({
          a2pId: String(a2p._id),
          unset: {
            brandSid: 1,
            brandStatus: 1,
            brandFailureReason: 1,
            usa2pSid: 1,
            campaignSid: 1,
          },
          reason: `Recovered stale brandSid during fetch (Twilio 20404): ${brandSid}`,
          extra: { brandSid },
        });
      }

      log("warn: brandRegistrations.fetch failed", {
        brandSid,
        twilioAccountSidUsed,
        code: err?.code,
        status: err?.status,
        moreInfo: err?.moreInfo,
        message: err?.message,
      });
    }

    const normalizedBrandStatus = String(brandStatus || "").toUpperCase();
    const canCreateCampaign = BRAND_OK_FOR_CAMPAIGN.has(normalizedBrandStatus);

    // ---------------- 5) Campaign (Usa2p QE...) if missing AND brand is eligible ----------------
    let usa2pSid: string | undefined = (a2p as any).usa2pSid;

    if (!usa2pSid && canCreateCampaign) {
      const code = useCaseCode;

      const description = buildCampaignDescription({
        businessName: setPayload.businessName || "",
        useCase: code,
        messageFlow: messageFlowText,
      });

      const createPayload: any = {
        brandRegistrationSid: brandSid!,
        usAppToPersonUsecase: code,
        description,
        messageFlow: messageFlowText,
        messageSamples: samples,
        hasEmbeddedLinks: true,
        hasEmbeddedPhone: false,
        subscriberOptIn: true,
        ageGated: false,
        directLending: false,
      };

      log("step: usAppToPerson.create (initial campaign)", {
        messagingServiceSid,
        payloadSummary: {
          useCase: code,
          descriptionLength: description.length,
          samplesCount: samples.length,
        },
        twilioAccountSidUsed,
      });

      const usa2p = await client.messaging.v1
        .services(messagingServiceSid)
        .usAppToPerson.create(createPayload);

      usa2pSid = (usa2p as any).sid;

      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            usa2pSid,
            messagingServiceSid,
            usecaseCode: code,
            registrationStatus: "campaign_submitted",
            twilioAccountSidLastUsed: twilioAccountSidUsed,
          } as any,
          $push: {
            approvalHistory: {
              stage: "campaign_submitted",
              at: new Date(),
              note: "Initial A2P campaign created",
            },
          },
        },
      );
    } else if (!usa2pSid && !canCreateCampaign) {
      log(
        "brand not eligible for campaign creation yet; deferring usAppToPerson.create",
        { brandSid, brandStatus, twilioAccountSidUsed },
      );
    }

    // If brand is approved AND campaign exists, mark ready
    if (usa2pSid && canCreateCampaign) {
      const appStatus =
        normalizedBrandStatus === "FAILED" ? "declined" : "approved";

      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            registrationStatus: "ready",
            applicationStatus: appStatus,
            messagingReady: appStatus === "approved",
            lastSyncedAt: new Date(),
            twilioAccountSidLastUsed: twilioAccountSidUsed,
          } as any,
          $push: {
            approvalHistory: {
              stage: "ready",
              at: new Date(),
              note: "Brand + campaign ready from start.ts",
            },
          },
        },
      );
    }

    return res.status(200).json({
      ok: true,
      data: {
        messagingServiceSid,
        brandSid,
        usa2pSid,
        brandStatus,
        canCreateCampaign,
        brandFailureReason,
        twilioAccountSidUsed,
      },
    });
  } catch (err: any) {
    console.error("[A2P start] top-level error:", err);
    return res.status(500).json({
      message: "A2P start failed",
      error: err?.message || String(err),
    });
  }
}
