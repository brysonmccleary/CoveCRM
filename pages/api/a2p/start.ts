// pages/api/a2p/start.ts
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
import twilio from "twilio";
import { Agent } from "undici";

// ✅ NEW: hard-gate the primary linking before brand creation
import { ensurePrimaryLinkedToSecondary } from "@/lib/twilio/trusthubPrimaryLink";

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
 * - TWILIO_API_KEY_SID
 * - TWILIO_API_KEY_SECRET
 * - TWILIO_TRUSTHUB_TIMEOUT_MS (default 15000)
 * - TWILIO_TRUSTHUB_MAX_RETRIES (default 3)
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

// ✅ capture exact auth used by getClientForUser so raw TrustHub fetch can match tenant correctly.
let twilioResolvedAuth: TwilioResolvedAuth | null = null;

// ✅ parent/master client ONLY for ISV primary-link verification (NOT for customer objects)
let parentClient: any = null;
let parentAuth: TwilioResolvedAuth | null = null;
let parentAccountSid: string = "";

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

// deterministic Twilio "not found" detection
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

// treat “already exists / duplicate” as safe-idempotent for entity assignment
function isTwilioDuplicateAssignment(err: any): boolean {
  const code = Number(err?.code);
  const status = Number(err?.status);
  const message = String(err?.message || "");
  return (
    status === 409 ||
    code === 20409 ||
    /duplicate/i.test(message) ||
    /already exists/i.test(message) ||
    /already assigned/i.test(message)
  );
}

// unset stale SID(s) on profile and record lastError proof
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

/**
 * ✅ NEW (additive): rotate the entire A2P object chain if the secondary bundle is locked.
 * Why:
 * - TWILIO_APPROVED CustomerProfiles (BU...) cannot accept new EntityAssignments.
 * - Any attempt to "reuse" them causes missing assignments => instant brand rejection.
 */
async function rotateA2PChainBecauseSecondaryLocked(args: {
  a2pId: string;
  userId: string;
  secondaryProfileSid: string;
  status: string;
  reason: string;
}) {
  const { a2pId, userId, secondaryProfileSid, status, reason } = args;

  log("recover: secondary profile is locked; rotating A2P chain", {
    a2pId,
    userId,
    secondaryProfileSid,
    status,
    reason,
    twilioAccountSidUsed,
  });

  // We MUST clear everything derived from the secondary bundle because:
  // - EndUsers + SupportingDocs were attached to the old bundle
  // - TrustProduct often has the secondary assigned to it
  // - Brand + campaign are tied to the old bundle(s)
  await A2PProfile.updateOne(
    { _id: a2pId },
    {
      $unset: {
        profileSid: 1,

        businessEndUserSid: 1,
        authorizedRepEndUserSid: 1,
        assignedToPrimary: 1,

        addressSid: 1,
        supportingDocumentSid: 1,
        parentAddressSid: 1,
        supportingDocumentCreatedVia: 1,
        supportingDocumentAccountSid: 1,

        trustProductSid: 1,
        a2pProfileEndUserSid: 1,

        brandSid: 1,
        brandStatus: 1,
        brandFailureReason: 1,

        usa2pSid: 1,
        campaignSid: 1,
      } as any,
      $set: {
        lastError: reason,
        lastSyncedAt: new Date(),
        twilioAccountSidLastUsed: twilioAccountSidUsed,
      } as any,
      $push: {
        approvalHistory: {
          stage: "recovered_locked_secondary",
          at: new Date(),
          note: `${reason} (oldSecondary=${secondaryProfileSid} status=${status})`,
        },
      },
    },
  );

  // NOTE: we intentionally do NOT clear messagingServiceSid.
  // That can remain stable per-user while A2P objects rebuild.
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(err: any): boolean {
  const msg = String(err?.message || "");
  const code = String((err as any)?.code || "");
  const name = String((err as any)?.name || "");
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    name === "AbortError" ||
    /ETIMEDOUT/i.test(msg) ||
    /ECONNRESET/i.test(msg) ||
    /EAI_AGAIN/i.test(msg) ||
    /ENOTFOUND/i.test(msg) ||
    /network/i.test(msg) ||
    /fetch failed/i.test(msg) ||
    /socket/i.test(msg)
  );
}

// Keepalive dispatcher for TrustHub (stabilizes Vercel networking)
const TRUSTHUB_DISPATCHER = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 60_000,
  connections: 50,
});

/**
 * TrustHub fetch:
 * - For SUBACCOUNT customer objects: MUST include `X-Twilio-AccountSid: <subaccountSid>`
 *   when using platform creds or parent creds.
 */
async function trusthubFetch(
  auth: TwilioResolvedAuth,
  method: "POST" | "GET",
  path: string,
  form?: Record<string, string>,
  opts?: { xTwilioAccountSid?: string | null },
) {
  const url = `https://trusthub.twilio.com${path}`;

  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(auth.username, auth.password),
  };

  const xSid =
    opts && "xTwilioAccountSid" in opts
      ? opts.xTwilioAccountSid
      : twilioAccountSidUsed;

  if (xSid) {
    headers["X-Twilio-AccountSid"] = xSid;
  }

  let body: string | undefined = undefined;
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = toFormUrlEncoded(form || {});
  }

  const timeoutMs = Number(process.env.TWILIO_TRUSTHUB_TIMEOUT_MS || "15000");
  const maxAttempts = Number(process.env.TWILIO_TRUSTHUB_MAX_RETRIES || "3");

  let lastErr: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        // @ts-ignore - undici dispatcher is supported in Node runtimes
        dispatcher: TRUSTHUB_DISPATCHER,
      } as any);

      clearTimeout(t);

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

        // Retry 5xx
        if (resp.status >= 500 && resp.status <= 599 && attempt < maxAttempts) {
          log("warn: TrustHub 5xx; retrying", {
            method,
            path,
            status: resp.status,
            code,
            attempt,
            maxAttempts,
            xTwilioAccountSid: xSid,
          });
          await sleep(250 * attempt * attempt);
          continue;
        }

        const err: any = new Error(
          `TrustHub ${method} ${path} failed (${resp.status}) code=${code} message=${message}`,
        );
        err.status = resp.status;
        err.code = json?.code ?? undefined;
        err.moreInfo = json?.more_info ?? undefined;
        throw err;
      }

      return json ?? text;
    } catch (err: any) {
      clearTimeout(t);
      lastErr = err;

      if (attempt < maxAttempts && isRetryableNetworkError(err)) {
        log("warn: TrustHub network error; retrying", {
          method,
          path,
          attempt,
          maxAttempts,
          message: err?.message,
          code: err?.code,
          name: err?.name,
          xTwilioAccountSid: xSid,
        });
        await sleep(250 * attempt * attempt);
        continue;
      }

      throw err;
    }
  }

  throw lastErr || new Error("TrustHub request failed after retries.");
}

// parent TrustHub client (ISV account) - ONLY used for primary-link checks/assignment
function getParentTrusthubClient(): {
  client: any;
  auth: TwilioResolvedAuth;
  accountSid: string;
} {
  const platformAccountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const platformAuthToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const platformApiKeySid = String(process.env.TWILIO_API_KEY_SID || "").trim();
  const platformApiKeySecret = String(
    process.env.TWILIO_API_KEY_SECRET || "",
  ).trim();

  if (!platformAccountSid.startsWith("AC")) {
    throw new Error(
      "Missing/invalid TWILIO_ACCOUNT_SID for parent TrustHub client.",
    );
  }

  if (platformAuthToken) {
    const c = twilio(platformAccountSid, platformAuthToken);
    const a: TwilioResolvedAuth = {
      mode: "authToken",
      username: platformAccountSid,
      password: platformAuthToken,
      effectiveAccountSid: platformAccountSid,
    };
    return { client: c, auth: a, accountSid: platformAccountSid };
  }

  if (platformApiKeySid && platformApiKeySecret) {
    const c = twilio(platformApiKeySid, platformApiKeySecret, {
      accountSid: platformAccountSid,
    });
    const a: TwilioResolvedAuth = {
      mode: "apiKey",
      username: platformApiKeySid,
      password: platformApiKeySecret,
      effectiveAccountSid: platformAccountSid,
    };
    return { client: c, auth: a, accountSid: platformAccountSid };
  }

  throw new Error(
    "Missing parent credentials: set TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET.",
  );
}

// ✅ RAW entity assignment helper (idempotent; does NOT skip TWILIO_APPROVED)
async function assignEntityToCustomerProfileRaw(args: {
  auth: TwilioResolvedAuth;
  customerProfileSid: string;
  objectSid: string;
  xTwilioAccountSid: string | null;
}) {
  const { auth, customerProfileSid, objectSid, xTwilioAccountSid } = args;

  log("step: entityAssignments.create RAW (customerProfile)", {
    customerProfileSid,
    objectSid,
    xTwilioAccountSid,
    authMode: auth.mode,
  });

  try {
    await trusthubFetch(
      auth,
      "POST",
      `/v1/CustomerProfiles/${customerProfileSid}/EntityAssignments`,
      { ObjectSid: objectSid },
      { xTwilioAccountSid },
    );
  } catch (err: any) {
    if (isTwilioDuplicateAssignment(err)) {
      log("info: entity assignment already exists (raw); skipping", {
        customerProfileSid,
        objectSid,
        xTwilioAccountSid,
      });
      return;
    }
    throw err;
  }
}

/**
 * ✅ ISV link:
 * Assign the PRIMARY customer profile as an entity assignment ONTO the SECONDARY bundle,
 * executed with PARENT auth while acting on the subaccount via X-Twilio-AccountSid.
 *
 * NOTE: This does NOT create customer A2P objects in parent.
 */
async function assignPrimaryCustomerProfileToSecondaryISV(args: {
  secondaryProfileSid: string;
}) {
  const { secondaryProfileSid } = args;

  if (!PRIMARY_PROFILE_SID || !PRIMARY_PROFILE_SID.startsWith("BU")) {
    throw new Error("Missing/invalid A2P_PRIMARY_PROFILE_SID.");
  }
  if (!secondaryProfileSid || !secondaryProfileSid.startsWith("BU")) {
    throw new Error("Missing/invalid secondaryProfileSid.");
  }
  if (!twilioAccountSidUsed || !twilioAccountSidUsed.startsWith("AC")) {
    throw new Error("Missing/invalid twilioAccountSidUsed for ISV assignment.");
  }

  if (!parentClient || !parentAuth || !parentAccountSid) {
    const parent = getParentTrusthubClient();
    parentClient = parent.client;
    parentAuth = parent.auth;
    parentAccountSid = parent.accountSid;
  }

  log("step: ISV link PRIMARY -> secondary (PARENT auth acting on subaccount)", {
    primaryProfileSid: PRIMARY_PROFILE_SID,
    secondaryProfileSid,
    parentAccountSidMasked:
      parentAccountSid.slice(0, 4) + "…" + parentAccountSid.slice(-4),
    xTwilioAccountSid: twilioAccountSidUsed,
  });

  await assignEntityToCustomerProfileRaw({
    auth: parentAuth!,
    customerProfileSid: secondaryProfileSid,
    objectSid: PRIMARY_PROFILE_SID,
    xTwilioAccountSid: twilioAccountSidUsed, // ✅ act on the subaccount bundle
  });
}

// ✅ NEW (additive): avoid duplicate customer_profile_address SDs causing instant evaluation failures.
async function findExistingCustomerProfileAddressSupportingDocSid(
  customerProfileSid: string,
): Promise<string | undefined> {
  if (!twilioResolvedAuth) return undefined;

  try {
    const data: any = await trusthubFetch(
      twilioResolvedAuth,
      "GET",
      `/v1/CustomerProfiles/${customerProfileSid}/EntityAssignments`,
      undefined,
      { xTwilioAccountSid: twilioAccountSidUsed },
    );

    const assignments: any[] =
      (Array.isArray(data) && data) ||
      data?.results ||
      data?.entity_assignments ||
      data?.entityAssignments ||
      [];

    const rdSids: string[] = [];
    for (const a of assignments) {
      const sid =
        a?.object_sid || a?.objectSid || a?.ObjectSid || a?.sid || a?.Sid;
      if (isSidLike(sid, "RD")) rdSids.push(String(sid));
    }

    if (!rdSids.length) return undefined;

    for (const rdSid of rdSids) {
      try {
        const sd: any = await trusthubFetch(
          twilioResolvedAuth,
          "GET",
          `/v1/SupportingDocuments/${rdSid}`,
          undefined,
          { xTwilioAccountSid: twilioAccountSidUsed },
        );

        const type = String(sd?.type || sd?.Type || "").toLowerCase();
        if (type === "customer_profile_address") {
          return rdSid;
        }
      } catch {
        // ignore and keep scanning
      }
    }

    return undefined;
  } catch (e: any) {
    log("warn: could not list/fetch entity assignments to reuse address SD", {
      customerProfileSid,
      twilioAccountSidUsed,
      message: e?.message,
      code: e?.code,
      status: e?.status,
    });
    return undefined;
  }
}

/**
 * ✅ CRITICAL FIX (ACTUAL):
 * SupportingDocuments creation should use the Twilio SDK surface in the *subaccount-scoped* client first.
 * This avoids TrustHub “20404 resource not found” quirks caused by subtle encoding/casing issues in raw fetch.
 *
 * We only fall back to raw TrustHub fetch if the SDK surface is unavailable.
 */
async function createSupportingDocumentSubaccountOnly(args: {
  friendlyName: string;
  type: string;
  attributes: Record<string, any>;
}) {
  const { friendlyName, type, attributes } = args;

  if (!twilioAccountSidUsed || !twilioAccountSidUsed.startsWith("AC")) {
    throw new Error("Missing/invalid subaccount SID for SupportingDocuments.");
  }

  // 1) ✅ Prefer SDK on the already-scoped client (getClientForUser gave us the correct scoping)
  try {
    const sdk = (client as any)?.trusthub?.v1?.supportingDocuments;
    if (sdk && typeof sdk.create === "function") {
      log("step: supportingDocuments.create via SDK (subaccount-scoped client)", {
        type,
        twilioAccountSidUsed,
        hasSdk: true,
      });

      const created: any = await sdk.create({
        friendlyName,
        type,
        // Twilio SDK will handle encoding; attributes should be an object here.
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

      // Verify it exists (still via SDK)
      try {
        await (client as any).trusthub.v1.supportingDocuments(sid).fetch();
      } catch (verifyErr: any) {
        log("warn: supportingDocuments.fetch verify failed (SDK)", {
          sid,
          twilioAccountSidUsed,
          code: verifyErr?.code,
          status: verifyErr?.status,
          message: verifyErr?.message,
        });
        // Don’t fail here — creation succeeded; verification can lag.
      }

      return { sid, raw: created, createdVia: "sdk_subaccount_scoped" };
    }
  } catch (sdkErr: any) {
    log("warn: supportingDocuments.create via SDK failed; will fallback to raw", {
      twilioAccountSidUsed,
      code: sdkErr?.code,
      status: sdkErr?.status,
      message: sdkErr?.message,
    });
    // continue to raw fallback below
  }

  // 2) Raw fallback (kept) — only used if SDK surface missing or SDK call failed
  if (!parentClient || !parentAuth || !parentAccountSid) {
    const parent = getParentTrusthubClient();
    parentClient = parent.client;
    parentAuth = parent.auth;
    parentAccountSid = parent.accountSid;
  }

  log("step: supportingDocuments.create RAW fallback (PARENT auth acting on SUBACCOUNT)", {
    host: "trusthub.twilio.com",
    path: "/v1/SupportingDocuments",
    type,
    xTwilioAccountSid: twilioAccountSidUsed,
    authMode: parentAuth!.mode,
  });

  const created: any = await trusthubFetch(
    parentAuth!,
    "POST",
    "/v1/SupportingDocuments",
    {
      FriendlyName: friendlyName,
      Type: type,
      Attributes: JSON.stringify(attributes),
    },
    { xTwilioAccountSid: twilioAccountSidUsed },
  );

  const sid = created?.sid || created?.Sid || created?.id;
  if (!sid || typeof sid !== "string") {
    throw new Error(
      `SupportingDocument RAW create did not return sid. Body: ${JSON.stringify(
        created,
      )}`,
    );
  }

  // verify (still acting on subaccount)
  try {
    await trusthubFetch(
      parentAuth!,
      "GET",
      `/v1/SupportingDocuments/${sid}`,
      undefined,
      { xTwilioAccountSid: twilioAccountSidUsed },
    );
  } catch (verifyErr: any) {
    log("warn: supportingDocuments.fetch verify failed (RAW)", {
      sid,
      twilioAccountSidUsed,
      code: verifyErr?.code,
      status: verifyErr?.status,
      message: verifyErr?.message,
    });
  }

  return { sid, raw: created, createdVia: "raw_parent_acting_subaccount" };
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

  // If the customerProfile is the PRIMARY and is TWILIO_APPROVED, Twilio can reject adding new items.
  // Also: PRIMARY may not be accessible in subaccounts; skip safely.
  if (customerProfileSid === PRIMARY_PROFILE_SID) {
    try {
      const primary = await (client.trusthub.v1.customerProfiles(
        customerProfileSid,
      ) as any).fetch();
      const status = String(primary?.status || "")
        .toUpperCase()
        .replace(/-/g, "_");

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
      try {
        await sub.create({ objectSid });
      } catch (err: any) {
        if (isTwilioDuplicateAssignment(err)) {
          log("info: entity assignment already exists; skipping", {
            customerProfileSid,
            objectSid,
            twilioAccountSidUsed,
            message: err?.message,
          });
          return;
        }

        // ✅ IMPORTANT: only "skip" TWILIO_APPROVED for PRIMARY. For SECONDARY, this is a real failure.
        const msg = String(err?.message || "");
        if (
          msg.includes("TWILIO_APPROVED") &&
          customerProfileSid === PRIMARY_PROFILE_SID
        ) {
          log("info: primary bundle is TWILIO_APPROVED; skipping assignment", {
            customerProfileSid,
            objectSid,
            twilioAccountSidUsed,
            message: msg,
          });
          return;
        }

        throw err;
      }
      return;
    }

    log(
      "warn: customerProfiles entityAssignments subresource unavailable; falling back to RAW TrustHub fetch",
      { customerProfileSid, objectSid, twilioAccountSidUsed },
    );
  } catch (err: any) {
    const msg = String(err?.message || "");

    // ✅ IMPORTANT: only skip TWILIO_APPROVED for PRIMARY. For SECONDARY we want it to error so our rotation logic can kick in.
    if (
      msg.includes("TWILIO_APPROVED") &&
      customerProfileSid === PRIMARY_PROFILE_SID
    ) {
      log("info: primary bundle is TWILIO_APPROVED; skipping assignment", {
        customerProfileSid,
        objectSid,
        message: msg,
        twilioAccountSidUsed,
      });
      return;
    }

    log("warn: error accessing customerProfiles entityAssignments; falling back to RAW TrustHub fetch", {
      customerProfileSid,
      message: err?.message,
      twilioAccountSidUsed,
    });
  }

  // ✅ FIX: Raw fallback MUST include X-Twilio-AccountSid so it lands in the SUBACCOUNT bundle
  if (!twilioResolvedAuth) {
    throw new Error("Missing twilioResolvedAuth for raw entity assignment.");
  }

  try {
    await trusthubFetch(
      twilioResolvedAuth,
      "POST",
      `/v1/CustomerProfiles/${customerProfileSid}/EntityAssignments`,
      { ObjectSid: objectSid },
      { xTwilioAccountSid: twilioAccountSidUsed },
    );
  } catch (err: any) {
    const msg = String(err?.message || "");

    // ✅ IMPORTANT: only skip TWILIO_APPROVED for PRIMARY
    if (
      msg.includes("TWILIO_APPROVED") &&
      customerProfileSid === PRIMARY_PROFILE_SID
    ) {
      log(
        "info: primary bundle is TWILIO_APPROVED (raw fallback); skipping assignment",
        {
          customerProfileSid,
          objectSid,
          message: msg,
          twilioAccountSidUsed,
        },
      );
      return;
    }

    if (isTwilioDuplicateAssignment(err)) {
      log("info: entity assignment already exists (raw fallback); skipping", {
        customerProfileSid,
        objectSid,
        twilioAccountSidUsed,
        message: (err as any)?.message,
      });
      return;
    }

    throw err;
  }
}

// TrustProduct entity assignment with SDK + raw fallback
async function assignEntityToTrustProduct(
  trustProductSid: string,
  objectSid: string,
) {
  log("step: entityAssignments.create (trustProduct)", {
    trustProductSid,
    objectSid,
    twilioAccountSidUsed,
  });

  try {
    const tp: any = client.trusthub.v1.trustProducts(trustProductSid) as any;
    const sub =
      tp?.entityAssignments ||
      tp?.trustProductsEntityAssignments ||
      tp?.trustProductsEntityAssignment;

    if (sub && typeof sub.create === "function") {
      try {
        await sub.create({ objectSid });
      } catch (err: any) {
        if (isTwilioDuplicateAssignment(err)) {
          log("info: trustProduct entity assignment already exists; skipping", {
            trustProductSid,
            objectSid,
            twilioAccountSidUsed,
            message: err?.message,
          });
          return;
        }
        throw err;
      }
      return;
    }

    log(
      "warn: trustProducts entityAssignments subresource unavailable; falling back to RAW TrustHub fetch",
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
      "warn: error accessing trustProducts entityAssignments; falling back to RAW TrustHub fetch",
      {
        trustProductSid,
        message: err?.message,
        twilioAccountSidUsed,
      },
    );
  }

  // ✅ FIX: Raw fallback MUST include X-Twilio-AccountSid so it lands in the SUBACCOUNT TrustProduct
  if (!twilioResolvedAuth) {
    throw new Error("Missing twilioResolvedAuth for raw trustProduct assignment.");
  }

  try {
    await trusthubFetch(
      twilioResolvedAuth,
      "POST",
      `/v1/TrustProducts/${trustProductSid}/EntityAssignments`,
      { ObjectSid: objectSid },
      { xTwilioAccountSid: twilioAccountSidUsed },
    );
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("TWILIO_APPROVED")) {
      log("info: trustProduct TWILIO_APPROVED (raw fallback); skipping assignment", {
        trustProductSid,
        objectSid,
        message: msg,
        twilioAccountSidUsed,
      });
      return;
    }
    if (isTwilioDuplicateAssignment(err)) {
      log(
        "info: trustProduct entity assignment already exists (raw fallback); skipping",
        {
          trustProductSid,
          objectSid,
          twilioAccountSidUsed,
          message: (err as any)?.message,
        },
      );
      return;
    }
    throw err;
  }
}

/**
 * ✅ FIX: Twilio TrustHub Evaluations require PolicySid in the POST body.
 * We include it for BOTH SDK and RAW paths.
 */

async function createCustomerProfileEvaluationRaw(customerProfileSid: string) {
  if (!twilioResolvedAuth) {
    throw new Error(
      "Missing twilioResolvedAuth for customerProfile evaluation.",
    );
  }
  log("step: customerProfiles.evaluations.create RAW", {
    customerProfileSid,
    twilioAccountSidUsed,
    policySid: SECONDARY_PROFILE_POLICY_SID,
  });
  await trusthubFetch(
    twilioResolvedAuth,
    "POST",
    `/v1/CustomerProfiles/${customerProfileSid}/Evaluations`,
    {
      PolicySid: SECONDARY_PROFILE_POLICY_SID,
    },
    { xTwilioAccountSid: twilioAccountSidUsed },
  );
}

async function createTrustProductEvaluationRaw(trustProductSid: string) {
  if (!twilioResolvedAuth) {
    throw new Error("Missing twilioResolvedAuth for trustProduct evaluation.");
  }
  log("step: trustProducts.evaluations.create RAW", {
    trustProductSid,
    twilioAccountSidUsed,
    policySid: A2P_TRUST_PRODUCT_POLICY_SID,
  });
  await trusthubFetch(
    twilioResolvedAuth,
    "POST",
    `/v1/TrustProducts/${trustProductSid}/Evaluations`,
    {
      PolicySid: A2P_TRUST_PRODUCT_POLICY_SID,
    },
    { xTwilioAccountSid: twilioAccountSidUsed },
  );
}

function normalizeTrustHubStatus(s: any): string {
  let raw = String(s || "").trim().toUpperCase();
  raw = raw.replace(/-/g, "_");
  if (raw === "PENDING_REVIEW") return "PENDING_REVIEW";
  if (raw === "PENDINGREVIEW") return "PENDING_REVIEW";
  if (raw === "IN_REVIEW") return "IN_REVIEW";
  if (raw === "INREVIEW") return "IN_REVIEW";
  return raw;
}

async function getCustomerProfileStatus(
  customerProfileSid: string,
): Promise<string | undefined> {
  try {
    const cp: any = await client.trusthub.v1
      .customerProfiles(customerProfileSid)
      .fetch();
    return normalizeTrustHubStatus(cp?.status);
  } catch {
    return undefined;
  }
}

async function getTrustProductStatus(
  trustProductSid: string,
): Promise<string | undefined> {
  try {
    const tp: any = await client.trusthub.v1
      .trustProducts(trustProductSid)
      .fetch();
    return normalizeTrustHubStatus(tp?.status);
  } catch {
    return undefined;
  }
}

async function evaluateAndSubmitCustomerProfile(customerProfileSid: string) {
  const currentStatus = await getCustomerProfileStatus(customerProfileSid);

  if (currentStatus === "TWILIO_APPROVED") {
    log(
      "info: customerProfile is TWILIO_APPROVED; skipping eval + status update",
      {
        customerProfileSid,
        twilioAccountSidUsed,
        currentStatus,
      },
    );
    return;
  }

  try {
    log("step: customerProfiles.evaluations.create", {
      customerProfileSid,
      twilioAccountSidUsed,
      policySid: SECONDARY_PROFILE_POLICY_SID,
    });
    const cp: any = client.trusthub.v1.customerProfiles(customerProfileSid);
    if ((cp as any).evaluations?.create) {
      await (cp as any).evaluations.create({
        policySid: SECONDARY_PROFILE_POLICY_SID,
      });
    } else {
      await createCustomerProfileEvaluationRaw(customerProfileSid);
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

  const postEvalStatus = await getCustomerProfileStatus(customerProfileSid);
  if (
    postEvalStatus === "PENDING_REVIEW" ||
    postEvalStatus === "IN_REVIEW" ||
    postEvalStatus === "APPROVED" ||
    postEvalStatus === "TWILIO_APPROVED"
  ) {
    log("info: customerProfile already submitted/approved; skipping status update", {
      customerProfileSid,
      twilioAccountSidUsed,
      status: postEvalStatus,
    });
    return;
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
  const currentStatus = await getTrustProductStatus(trustProductSid);

  if (currentStatus === "TWILIO_APPROVED") {
    log("info: trustProduct is TWILIO_APPROVED; skipping eval + status update", {
      trustProductSid,
      twilioAccountSidUsed,
      currentStatus,
    });
    return;
  }

  try {
    log("step: trustProducts.evaluations.create", {
      trustProductSid,
      twilioAccountSidUsed,
      policySid: A2P_TRUST_PRODUCT_POLICY_SID,
    });
    const tp: any = client.trusthub.v1.trustProducts(trustProductSid);
    if ((tp as any).evaluations?.create) {
      await (tp as any).evaluations.create({
        policySid: A2P_TRUST_PRODUCT_POLICY_SID,
      });
    } else {
      await createTrustProductEvaluationRaw(trustProductSid);
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

  const postEvalStatus = await getTrustProductStatus(trustProductSid);
  if (
    postEvalStatus === "PENDING_REVIEW" ||
    postEvalStatus === "IN_REVIEW" ||
    postEvalStatus === "APPROVED" ||
    postEvalStatus === "TWILIO_APPROVED"
  ) {
    log("info: trustProduct already submitted/approved; skipping status update", {
      trustProductSid,
      twilioAccountSidUsed,
      status: postEvalStatus,
    });
    return;
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

async function verifyBrandAndCampaignExist(args: {
  brandSid?: string;
  messagingServiceSid?: string;
  usa2pSid?: string;
}): Promise<{
  brandOk: boolean;
  campaignOk: boolean;
}> {
  const { brandSid, messagingServiceSid, usa2pSid } = args;

  let brandOk = false;
  let campaignOk = false;

  if (brandSid) {
    try {
      await client.messaging.v1.brandRegistrations(brandSid).fetch();
      brandOk = true;
    } catch (err: any) {
      if (!isTwilioNotFound(err)) throw err;
      brandOk = false;
    }
  }

  if (messagingServiceSid && usa2pSid) {
    try {
      const svc: any = client.messaging.v1.services(messagingServiceSid);
      const sub =
        svc?.usAppToPerson && typeof svc.usAppToPerson === "function"
          ? svc.usAppToPerson(usa2pSid)
          : null;

      if (sub?.fetch) {
        await sub.fetch();
        campaignOk = true;
      } else {
        const list = await (svc?.usAppToPerson?.list
          ? svc.usAppToPerson.list({ limit: 50 })
          : Promise.resolve([]));
        campaignOk = Boolean(
          (list || []).find((x: any) => (x?.sid || x?.id) === usa2pSid),
        );
      }
    } catch (err: any) {
      if (!isTwilioNotFound(err)) throw err;
      campaignOk = false;
    }
  }

  return { brandOk, campaignOk };
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

    // Resolve the Twilio client in the *user subaccount* context (or self-billing creds).
    let resolvedTwilio: Awaited<ReturnType<typeof getClientForUser>> | null =
      null;
    try {
      resolvedTwilio = await getClientForUser(session.user.email);
      client = resolvedTwilio.client;
      twilioAccountSidUsed = resolvedTwilio.accountSid;
      twilioResolvedAuth = resolvedTwilio.auth;

      log("TrustHub SDK surface", {
        hasSupportingDocuments: Boolean(
          (client as any)?.trusthub?.v1?.supportingDocuments,
        ),
        trusthubV1Keys: Object.keys((client as any)?.trusthub?.v1 || {}),
      });
    } catch (e: any) {
      console.error("[A2P start]", "getClientForUser failed:", {
        email: session.user.email,
        message: e?.message,
      });
      return res.status(400).json({
        message:
          e?.message ||
          "Twilio is not connected for this user. Missing subaccount SID or platform credentials.",
      });
    }

    log("twilioAccountSidUsed", { twilioAccountSidUsed });

    try {
      const acct = await client.api.v2010.accounts(twilioAccountSidUsed).fetch();
      log("twilio account in use", {
        sid: acct?.sid,
        friendlyName: acct?.friendlyName,
      });
    } catch (e: any) {
      log("twilio account in use", {
        sid: twilioAccountSidUsed,
        message: (e as any)?.message,
      });
    }

    const {
      businessName,
      ein,
      website,

      address,
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
      sampleMessages,
      optInDetails,
      volume,
      optInScreenshotUrl,
      usecaseCode,

      resubmit,

      landingOptInUrl,
      landingTosUrl,
      landingPrivacyUrl,
    } = (req.body || {}) as Record<string, unknown>;

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

    const einDigits = normalizeEinDigits(ein);
    const einDisplay = formatEinDisplay(einDigits);

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

    const setPayload: Partial<IA2PProfile> & { userId: string } = {
      userId,
      businessName: String(businessName),
      ein: einDisplay,
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
      sampleMessagesArr: samples,
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

    (setPayload as any).userEmail = user.email;
    (setPayload as any).lastSubmittedAt = now;
    (setPayload as any).lastSubmittedUseCase = normalizedUseCase;
    (setPayload as any).lastSubmittedOptInDetails = String(
      optInDetails || "",
    ).trim();
    (setPayload as any).lastSubmittedSampleMessages = samples;
    (setPayload as any).twilioAccountSidLastUsed = twilioAccountSidUsed;

    const messageFlowText: string = setPayload.optInDetails!;
    const useCaseCodeFinal: string =
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

    // ✅ If legacy says brand + campaign exist, verify they exist in Twilio before returning
    if ((a2p as any).brandSid && (a2p as any).usa2pSid) {
      const check = await verifyBrandAndCampaignExist({
        brandSid: (a2p as any).brandSid,
        messagingServiceSid,
        usa2pSid: (a2p as any).usa2pSid,
      });

      if (check.brandOk && check.campaignOk) {
        log("short-circuit: brand + usa2p exist and verified", {
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

      await clearStaleSidOnProfile({
        a2pId: String((a2p as any)._id),
        unset: {
          ...(check.brandOk
            ? {}
            : { brandSid: 1, brandStatus: 1, brandFailureReason: 1 }),
          ...(check.campaignOk ? {} : { usa2pSid: 1, campaignSid: 1 }),
        },
        reason: `Recovered stale stored A2P objects before short-circuit: brandOk=${check.brandOk} campaignOk=${check.campaignOk}`,
        extra: {
          brandSid: (a2p as any).brandSid,
          usa2pSid: (a2p as any).usa2pSid,
        },
      });
    }

    // ---------------- 1) Secondary Customer Profile (BU...) ----------------
    let live = await A2PProfile.findOne({ userId }).lean<any>();
    const a2pId = String(live?._id || (a2p as any)._id);

    let secondaryProfileSid: string | undefined = live?.profileSid;

    const isResubmit = Boolean(resubmit);

    if (secondaryProfileSid) {
      try {
        const cp: any = await (
          client.trusthub.v1.customerProfiles(secondaryProfileSid) as any
        ).fetch();

        const status = normalizeTrustHubStatus(cp?.status);

        log("secondary customerProfile fetched", {
          secondaryProfileSid,
          status,
          twilioAccountSidUsed,
          isResubmit,
        });

        const submittedLike = new Set([
          "PENDING_REVIEW",
          "IN_REVIEW",
          "APPROVED",
          "TWILIO_APPROVED",
        ]);
        const shouldRotate =
          status === "TWILIO_APPROVED" ||
          (isResubmit && submittedLike.has(status));

        if (shouldRotate) {
          await rotateA2PChainBecauseSecondaryLocked({
            a2pId,
            userId,
            secondaryProfileSid,
            status,
            reason:
              status === "TWILIO_APPROVED"
                ? "Secondary Business Profile bundle is TWILIO_APPROVED (locked). Must recreate."
                : "Resubmit requested but existing Secondary Business Profile is already submitted/locked-like. Recreating clean bundle to avoid instant failure.",
          });

          secondaryProfileSid = undefined;
          live = await A2PProfile.findOne({ userId }).lean<any>();
        }
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          await clearStaleSidOnProfile({
            a2pId,
            unset: {
              profileSid: 1,
              businessEndUserSid: 1,
              authorizedRepEndUserSid: 1,
              assignedToPrimary: 1,
              addressSid: 1,
              supportingDocumentSid: 1,
              parentAddressSid: 1,
              supportingDocumentAccountSid: 1,
              supportingDocumentCreatedVia: 1,

              trustProductSid: 1,
              a2pProfileEndUserSid: 1,

              brandSid: 1,
              brandStatus: 1,
              brandFailureReason: 1,
              usa2pSid: 1,
              campaignSid: 1,
            },
            reason: `Recovered stale profileSid (Twilio 20404): ${secondaryProfileSid}`,
            extra: { profileSid: secondaryProfileSid },
          });
          secondaryProfileSid = undefined;
          live = await A2PProfile.findOne({ userId }).lean<any>();
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

      await A2PProfile.updateOne(
        { _id: a2pId },
        { $set: { profileSid: secondaryProfileSid } },
      );

      live = await A2PProfile.findOne({ userId }).lean<any>();
      log("created customerProfile (secondary)", {
        secondaryProfileSid,
        twilioAccountSidUsed,
      });
    }

    // ---------------- 1.2) EndUser: business information + attach ----------------
    live = await A2PProfile.findOne({ userId }).lean<any>();
    if (!live?.businessEndUserSid) {
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

      const businessEU = await client.trusthub.v1.endUsers.create({
        type: "customer_profile_business_information",
        friendlyName: `${setPayload.businessName} – Business Info`,
        attributes: businessAttributes as any,
      });

      await assignEntityToCustomerProfile(secondaryProfileSid!, businessEU.sid);

      await A2PProfile.updateOne(
        { _id: a2pId },
        { $set: { businessEndUserSid: businessEU.sid } },
      );
    }

    // ---------------- 1.4) Authorized representative + attach ----------------
    live = await A2PProfile.findOne({ userId }).lean<any>();
    if (!live?.authorizedRepEndUserSid) {
      const rawPhone = String(setPayload.phone || "");
      const digitsOnlyPhone = rawPhone.replace(/[^\d]/g, "");
      if (digitsOnlyPhone.length < 10) {
        throw new Error(
          "Authorized representative phone must be a valid US number with 10 digits including area code.",
        );
      }

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

      const repEU = await client.trusthub.v1.endUsers.create({
        type: "authorized_representative_1",
        friendlyName: `${setPayload.businessName} – Authorized Rep`,
        attributes: repAttributes as any,
      });

      await assignEntityToCustomerProfile(secondaryProfileSid!, repEU.sid);

      await A2PProfile.updateOne(
        { _id: a2pId },
        { $set: { authorizedRepEndUserSid: repEU.sid } },
      );
    }

    // ---------------- 1.6) Address resource (Twilio Address) ----------------
    live = await A2PProfile.findOne({ userId }).lean<any>();
    let addressSid: string | undefined = live?.addressSid;

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

      await A2PProfile.updateOne({ _id: a2pId }, { $set: { addressSid } });
      live = await A2PProfile.findOne({ userId }).lean<any>();
    }

    // ---------------- 1.7) SupportingDocument for address ----------------
    live = await A2PProfile.findOne({ userId }).lean<any>();
    let supportingDocumentSid: string | undefined = live?.supportingDocumentSid;

    if (!supportingDocumentSid) {
      const reused = await findExistingCustomerProfileAddressSupportingDocSid(
        secondaryProfileSid!,
      );
      if (reused) {
        supportingDocumentSid = reused;

        log(
          "reuse: found existing customer_profile_address SupportingDocument on profile",
          {
            customerProfileSid: secondaryProfileSid,
            supportingDocumentSid,
            twilioAccountSidUsed,
          },
        );

        await A2PProfile.updateOne(
          { _id: a2pId },
          {
            $set: {
              supportingDocumentSid,
              supportingDocumentCreatedVia: "subaccount",
              supportingDocumentAccountSid: twilioAccountSidUsed,
            } as any,
          },
        );
      }
    }

    if (!supportingDocumentSid && addressSid) {
      const attributes = { address_sids: addressSid };

      log("step: supportingDocuments.create (customer_profile_address)", {
        attributes,
        twilioAccountSidUsed,
      });

      const sd = await createSupportingDocumentSubaccountOnly({
        friendlyName: `${setPayload.businessName} – Address SupportingDocument`,
        type: "customer_profile_address",
        attributes,
      });

      supportingDocumentSid = sd.sid;

      await A2PProfile.updateOne(
        { _id: a2pId },
        {
          $set: {
            supportingDocumentSid,
            supportingDocumentCreatedVia: sd.createdVia,
            supportingDocumentAccountSid: twilioAccountSidUsed,
          } as any,
        },
      );
    }

    // ---------------- 1.8) Attach SupportingDocument to Secondary profile ----
    if (supportingDocumentSid) {
      await assignEntityToCustomerProfile(
        secondaryProfileSid!,
        supportingDocumentSid,
      );
    }

    // ---------------- 1.9) Assign PRIMARY to Secondary (ISV) ----------------
    live = await A2PProfile.findOne({ userId }).lean<any>();
    if (!live?.assignedToPrimary) {
      await assignPrimaryCustomerProfileToSecondaryISV({
        secondaryProfileSid: secondaryProfileSid!,
      });

      if (!parentClient || !parentAuth || !parentAccountSid) {
        const parent = getParentTrusthubClient();
        parentClient = parent.client;
        parentAuth = parent.auth;
        parentAccountSid = parent.accountSid;
      }

      const requestId = String(req.headers["x-request-id"] || Date.now());
      const verify = await ensurePrimaryLinkedToSecondary({
        secondaryCustomerProfileSid: secondaryProfileSid!,
        primaryCustomerProfileSid: PRIMARY_PROFILE_SID,
        auth: {
          username: parentAuth!.username,
          password: parentAuth!.password,
        },
        requestId,
        xTwilioAccountSid: twilioAccountSidUsed,
      });

      if (verify.ok) {
        await A2PProfile.updateOne(
          { _id: a2pId },
          { $set: { assignedToPrimary: true } },
        );
        log("primary link verified; assignedToPrimary=true", {
          secondaryProfileSid,
          primaryProfileSid: PRIMARY_PROFILE_SID,
          twilioAccountSidUsed,
        });
      } else {
        log("primary link NOT confirmed; refusing to proceed to brand create", {
          secondaryProfileSid,
          primaryProfileSid: PRIMARY_PROFILE_SID,
          twilioAccountSidUsed,
          assignments: verify.assignments,
        });

        await A2PProfile.updateOne(
          { _id: a2pId },
          {
            $set: {
              assignedToPrimary: false,
              lastError:
                "Primary bundle link could not be confirmed in Twilio yet. Try again shortly.",
              lastSyncedAt: new Date(),
              twilioAccountSidLastUsed: twilioAccountSidUsed,
            } as any,
          },
        );

        return res.status(409).json({
          ok: false,
          message:
            "Primary Customer Profile link could not be confirmed in Twilio yet. Please retry in ~60 seconds.",
          debug: {
            requestId,
            secondaryProfileSid,
            primaryProfileSid: PRIMARY_PROFILE_SID,
            assignments: verify.assignments,
            twilioAccountSidUsed,
          },
        });
      }
    } else {
      if (resubmit) {
        if (!parentClient || !parentAuth || !parentAccountSid) {
          const parent = getParentTrusthubClient();
          parentClient = parent.client;
          parentAuth = parent.auth;
          parentAccountSid = parent.accountSid;
        }

        const requestId = String(req.headers["x-request-id"] || Date.now());
        const verify = await ensurePrimaryLinkedToSecondary({
          secondaryCustomerProfileSid: secondaryProfileSid!,
          primaryCustomerProfileSid: PRIMARY_PROFILE_SID,
          auth: {
            username: parentAuth!.username,
            password: parentAuth!.password,
          },
          requestId,
          xTwilioAccountSid: twilioAccountSidUsed,
        });

        if (!verify.ok) {
          await A2PProfile.updateOne(
            { _id: a2pId },
            {
              $set: {
                assignedToPrimary: false,
                lastError:
                  "Primary bundle link could not be confirmed in Twilio yet (resubmit).",
                lastSyncedAt: new Date(),
                twilioAccountSidLastUsed: twilioAccountSidUsed,
              } as any,
            },
          );

          return res.status(409).json({
            ok: false,
            message:
              "Primary Customer Profile link could not be confirmed in Twilio yet (resubmit). Please retry shortly.",
            debug: {
              requestId,
              secondaryProfileSid,
              primaryProfileSid: PRIMARY_PROFILE_SID,
              assignments: verify.assignments,
              twilioAccountSidUsed,
            },
          });
        }
      }
    }

    // Evaluate + submit Secondary
    await evaluateAndSubmitCustomerProfile(secondaryProfileSid!);

    // ---------------- 2) TrustProduct (A2P) ----------------
    live = await A2PProfile.findOne({ userId }).lean<any>();
    let trustProductSid: string | undefined = live?.trustProductSid;

    if (trustProductSid) {
      try {
        await (client.trusthub.v1.trustProducts(trustProductSid) as any).fetch();
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          await clearStaleSidOnProfile({
            a2pId,
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

      await A2PProfile.updateOne(
        { _id: a2pId },
        { $set: { trustProductSid } },
      );

      log("created trustProduct", { trustProductSid, twilioAccountSidUsed });
    }

    // ---------------- 2.2) EndUser: us_a2p_messaging_profile_information ----------------
    live = await A2PProfile.findOne({ userId }).lean<any>();
    if (!live?.a2pProfileEndUserSid) {
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

      const a2pEU = await client.trusthub.v1.endUsers.create({
        type: "us_a2p_messaging_profile_information",
        friendlyName: `${setPayload.businessName} – A2P Messaging Profile`,
        attributes: a2pAttributes as any,
      });

      await assignEntityToTrustProduct(trustProductSid!, a2pEU.sid);
      await assignEntityToTrustProduct(trustProductSid!, secondaryProfileSid!);

      await A2PProfile.updateOne(
        { _id: a2pId },
        { $set: { a2pProfileEndUserSid: a2pEU.sid } },
      );
    }

    // Evaluate + submit TrustProduct
    await evaluateAndSubmitTrustProduct(trustProductSid!);

    // ---------------- 3) BrandRegistration (BN...) with resubmit logic -------
    live = await A2PProfile.findOne({ userId }).lean<any>();

    let storedBrandStatus = live?.brandStatus as string | undefined;
    let brandSid: string | undefined = live?.brandSid;

    if (brandSid) {
      try {
        await client.messaging.v1.brandRegistrations(brandSid).fetch();
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          await clearStaleSidOnProfile({
            a2pId,
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

    if (brandSid && normalizedStoredStatus === "FAILED" && isResubmit) {
      log(
        "resubmit requested for existing FAILED brand; updating BrandRegistration",
        { brandSid, storedBrandStatus, twilioAccountSidUsed },
      );

      try {
        await client.messaging.v1.brandRegistrations(brandSid).update();

        await A2PProfile.updateOne(
          { _id: a2pId },
          {
            $set: {
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

    if (!parentClient || !parentAuth || !parentAccountSid) {
      const parent = getParentTrusthubClient();
      parentClient = parent.client;
      parentAuth = parent.auth;
      parentAccountSid = parent.accountSid;
    }

    {
      const requestId = String(req.headers["x-request-id"] || Date.now());
      const verify = await ensurePrimaryLinkedToSecondary({
        secondaryCustomerProfileSid: secondaryProfileSid!,
        primaryCustomerProfileSid: PRIMARY_PROFILE_SID,
        auth: {
          username: parentAuth!.username,
          password: parentAuth!.password,
        },
        requestId,
        xTwilioAccountSid: twilioAccountSidUsed,
      });

      if (!verify.ok) {
        await A2PProfile.updateOne(
          { _id: a2pId },
          {
            $set: {
              assignedToPrimary: false,
              lastError:
                "Primary bundle link could not be confirmed in Twilio. Brand creation blocked to prevent instant rejection.",
              lastSyncedAt: new Date(),
              twilioAccountSidLastUsed: twilioAccountSidUsed,
            } as any,
          },
        );

        return res.status(409).json({
          ok: false,
          message:
            "Primary Customer Profile link not confirmed in Twilio yet. Please retry in ~60 seconds.",
          debug: {
            requestId,
            secondaryProfileSid,
            primaryProfileSid: PRIMARY_PROFILE_SID,
            assignments: verify.assignments,
            twilioAccountSidUsed,
          },
        });
      }

      await A2PProfile.updateOne(
        { _id: a2pId },
        { $set: { assignedToPrimary: true } },
      );
    }

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
        { _id: a2pId },
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

    // ---------------- 3.1) Fetch brand status ----------------
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
          { _id: a2pId },
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
        await A2PProfile.updateOne({ _id: a2pId }, { $set: update });
      }
    } catch (err: any) {
      if (isTwilioNotFound(err)) {
        await clearStaleSidOnProfile({
          a2pId,
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

    // ---------------- 5) Campaign (Usa2p QE...) ----------------
    live = await A2PProfile.findOne({ userId }).lean<any>();
    let usa2pSid: string | undefined = live?.usa2pSid;

    if (!usa2pSid && canCreateCampaign) {
      const code = useCaseCodeFinal;

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
        { _id: a2pId },
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

    if (usa2pSid && canCreateCampaign) {
      const appStatus =
        normalizedBrandStatus === "FAILED" ? "declined" : "approved";

      await A2PProfile.updateOne(
        { _id: a2pId },
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
