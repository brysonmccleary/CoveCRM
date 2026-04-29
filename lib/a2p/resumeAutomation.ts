import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { Buffer } from "buffer";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

const A2P_TRUST_PRODUCT_POLICY_SID =
  process.env.A2P_TRUST_PRODUCT_POLICY_SID ||
  "RNb0d4771c2c98518d916a3d4cd70a8f8b";

const STATUS_CB =
  process.env.A2P_STATUS_CALLBACK_URL || `${BASE_URL}/api/a2p/status-callback`;

const NOTIFY_EMAIL =
  process.env.A2P_NOTIFICATIONS_EMAIL || "a2p@yourcompany.com";

const A2P_COMPANY_TYPE = "private";

const BRAND_OK_FOR_CAMPAIGN = new Set([
  "APPROVED",
  "VERIFIED",
  "ACTIVE",
  "IN_USE",
  "REGISTERED",
]);

const TRUSTHUB_APPROVED = new Set(["APPROVED", "TWILIO_APPROVED"]);

const CAMPAIGN_APPROVED = new Set([
  "APPROVED",
  "VERIFIED",
  "ACTIVE",
  "IN_USE",
  "REGISTERED",
  "CAMPAIGN_APPROVED",
]);

const FAILED_STATUSES = new Set(["FAILED", "REJECTED", "DECLINED", "TERMINATED"]);

function log(tag: string, meta?: Record<string, any>) {
  if (meta) {
    console.log(`[${tag}]`, meta);
  } else {
    console.log(`[${tag}]`);
  }
}

function normalizeUpper(value: any): string {
  return String(value || "").trim().toUpperCase();
}

function normalizeTrustHubStatus(value: any): string {
  let raw = String(value || "").trim().toUpperCase();
  raw = raw.replace(/-/g, "_");
  if (raw === "PENDING_REVIEW") return "PENDING_REVIEW";
  if (raw === "PENDINGREVIEW") return "PENDING_REVIEW";
  if (raw === "IN_REVIEW") return "IN_REVIEW";
  if (raw === "INREVIEW") return "IN_REVIEW";
  return raw;
}

function normalizeLower(value: any): string {
  return String(value || "").trim().toLowerCase();
}

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

function isSidLike(value: any, prefix: string) {
  return typeof value === "string" && value.startsWith(prefix);
}

function isCompanyTypeRejected(status: string, reason: any) {
  const normalizedStatus = normalizeTrustHubStatus(status);
  const text = String(reason || "").toLowerCase();
  return (
    (normalizedStatus === "TWILIO_REJECTED" || normalizedStatus === "REJECTED") &&
    (text.includes("22218") || text.includes("company type is invalid"))
  );
}

function basicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

async function trusthubFetch(args: {
  auth: { username: string; password: string; effectiveAccountSid: string };
  method: string;
  path: string;
  body?: Record<string, any>;
  extraHeaders?: Record<string, string>;
}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(args.body || {})) {
    if (value === undefined || value === null) continue;
    body.set(key, String(value));
  }

  const response = await fetch(`https://trusthub.twilio.com${args.path}`, {
    method: args.method,
    headers: {
      Authorization: basicAuthHeader(args.auth.username, args.auth.password),
      "Content-Type": "application/x-www-form-urlencoded",
      ...(args.extraHeaders || {}),
    },
    body: args.method === "GET" ? undefined : body,
  });

  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const err: any = new Error(
      data?.message ||
        data?.Message ||
        `TrustHub request failed (${response.status}) ${args.method} ${args.path}`,
    );
    err.status = response.status;
    err.code = data?.code || data?.Code;
    err.moreInfo = data?.more_info || data?.moreInfo;
    throw err;
  }

  return data;
}

function parseSamples(doc: any): string[] {
  const rawList = Array.isArray(doc?.lastSubmittedSampleMessages) && doc.lastSubmittedSampleMessages.length
    ? doc.lastSubmittedSampleMessages
    : Array.isArray(doc?.sampleMessagesArr) && doc.sampleMessagesArr.length
      ? doc.sampleMessagesArr
      : [doc?.sampleMessage1, doc?.sampleMessage2, doc?.sampleMessage3];

  const list = rawList
    .map((s: any) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 3);

  if (list.length) return list;

  const raw = String(doc?.sampleMessages || "");
  return raw
    .split(/\n{2,}|\r{2,}/)
    .map((s: string) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildCampaignDescription(opts: {
  businessName: string;
  useCase: string;
  messageFlow: string;
}) {
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

  if (desc.length > 1024) desc = desc.slice(0, 1024);
  if (desc.length < 40) {
    desc +=
      " This campaign sends compliant follow-up and reminder messages to warm leads.";
  }

  return desc;
}

async function ensureMessagingService(args: {
  client: any;
  a2pId: string;
  userId: string;
  userEmail: string;
  existingSid?: string;
}) {
  const { client, a2pId, userId, userEmail, existingSid } = args;
  const inboundRequestUrl = `${BASE_URL}/api/twilio/inbound-sms`;
  const statusCallback = `${BASE_URL}/api/twilio/status-callback`;

  if (existingSid) {
    try {
      await client.messaging.v1.services(existingSid).fetch();
      return existingSid;
    } catch (err: any) {
      if (!isTwilioNotFound(err)) throw err;
      await A2PProfile.updateOne(
        { _id: a2pId },
        { $unset: { messagingServiceSid: 1 } },
      );
    }
  }

  const ms = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM Service – ${userEmail}`,
    inboundRequestUrl,
    statusCallback,
  });

  await A2PProfile.updateOne(
    { _id: a2pId },
    { $set: { messagingServiceSid: ms.sid } },
    { upsert: true },
  );

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        "a2p.messagingServiceSid": ms.sid,
        "a2p.lastSyncedAt": new Date(),
      },
    },
  );

  return ms.sid;
}

async function findExistingBrandForBundles(args: {
  client: any;
  profileSid: string;
  trustProductSid: string;
}) {
  try {
    const list = await (args.client.messaging.v1 as any).brandRegistrations.list({
      limit: 50,
    });
    const match = (list || []).find((b: any) => {
      const cp = b?.customerProfileBundleSid || b?.customerProfileSid;
      const tp =
        b?.a2PProfileBundleSid ||
        b?.a2pProfileBundleSid ||
        b?.a2PProfileSid ||
        b?.a2pProfileSid;
      return cp === args.profileSid && tp === args.trustProductSid;
    });
    const sid = match?.sid || match?.brandSid || match?.id;
    return isSidLike(sid, "BN") ? sid : undefined;
  } catch {
    return undefined;
  }
}

async function fetchCampaignStatus(args: {
  client: any;
  messagingServiceSid?: string;
  campaignSid?: string;
}) {
  if (!args.messagingServiceSid || !args.campaignSid) return undefined;
  try {
    const campaign = await args.client.messaging.v1
      .services(args.messagingServiceSid)
      .usAppToPerson(args.campaignSid)
      .fetch();

    return String(
      (campaign as any)?.campaignStatus ||
        (campaign as any)?.campaign_status ||
        (campaign as any)?.status ||
        (campaign as any)?.state ||
        "",
    ).trim();
  } catch {
    return undefined;
  }
}

async function createTrustProductEvaluationRaw(args: {
  auth: { username: string; password: string; effectiveAccountSid: string };
  accountSidUsed: string;
  trustProductSid: string;
}) {
  await trusthubFetch({
    auth: args.auth,
    method: "POST",
    path: `/v1/TrustProducts/${args.trustProductSid}/Evaluations`,
    body: {
      PolicySid: A2P_TRUST_PRODUCT_POLICY_SID,
    },
    extraHeaders: {
      "X-Twilio-AccountSid": args.accountSidUsed,
    },
  });
}

async function getTrustProductStatus(args: {
  client: any;
  trustProductSid: string;
}) {
  try {
    const trustProduct: any = await args.client.trusthub.v1
      .trustProducts(args.trustProductSid)
      .fetch();
    return normalizeTrustHubStatus(trustProduct?.status);
  } catch {
    return undefined;
  }
}

async function evaluateAndSubmitTrustProduct(args: {
  client: any;
  auth: { username: string; password: string; effectiveAccountSid: string };
  accountSidUsed: string;
  trustProductSid: string;
}) {
  const currentStatus = await getTrustProductStatus({
    client: args.client,
    trustProductSid: args.trustProductSid,
  });

  if (currentStatus === "TWILIO_APPROVED") {
    return;
  }

  try {
    const tp: any = args.client.trusthub.v1.trustProducts(args.trustProductSid);
    if ((tp as any).evaluations?.create) {
      await (tp as any).evaluations.create({
        policySid: A2P_TRUST_PRODUCT_POLICY_SID,
      });
    } else {
      await createTrustProductEvaluationRaw(args);
    }
  } catch {
    try {
      await createTrustProductEvaluationRaw(args);
    } catch {
      // best effort
    }
  }

  const postEvalStatus = await getTrustProductStatus({
    client: args.client,
    trustProductSid: args.trustProductSid,
  });
  if (
    postEvalStatus === "PENDING_REVIEW" ||
    postEvalStatus === "IN_REVIEW" ||
    postEvalStatus === "APPROVED" ||
    postEvalStatus === "TWILIO_APPROVED"
  ) {
    return;
  }

  try {
    await args.client.trusthub.v1.trustProducts(args.trustProductSid).update({
      status: "pending-review",
    } as any);
  } catch {
    // best effort
  }
}

async function assignEntityToTrustProduct(args: {
  client: any;
  auth: { username: string; password: string; effectiveAccountSid: string };
  accountSidUsed: string;
  trustProductSid: string;
  objectSid: string;
}) {
  try {
    const tp: any = args.client.trusthub.v1.trustProducts(args.trustProductSid) as any;
    const sub =
      tp?.entityAssignments ||
      tp?.trustProductsEntityAssignments ||
      tp?.trustProductsEntityAssignment;

    if (sub && typeof sub.create === "function") {
      try {
        await sub.create({ objectSid: args.objectSid });
      } catch (err: any) {
        if (isTwilioDuplicateAssignment(err)) return;
        throw err;
      }
      return;
    }
  } catch (err: any) {
    if (isTwilioDuplicateAssignment(err)) return;
  }

  try {
    await trusthubFetch({
      auth: args.auth,
      method: "POST",
      path: `/v1/TrustProducts/${args.trustProductSid}/EntityAssignments`,
      body: {
        ObjectSid: args.objectSid,
      },
      extraHeaders: {
        "X-Twilio-AccountSid": args.accountSidUsed,
      },
    });
  } catch (err: any) {
    if (isTwilioDuplicateAssignment(err)) return;
    throw err;
  }
}

async function listTrustProductAssignmentsDetailed(args: {
  client: any;
  auth: { username: string; password: string; effectiveAccountSid: string };
  accountSidUsed: string;
  trustProductSid: string;
}) {
  try {
    const tp: any = args.client.trusthub.v1.trustProducts(args.trustProductSid) as any;
    const sub =
      tp?.entityAssignments ||
      tp?.trustProductsEntityAssignments ||
      tp?.trustProductsEntityAssignment;

    if (sub && typeof sub.list === "function") {
      const list = (await sub.list({ limit: 50 })) || [];
      return list.map((item: any) => ({
        sid: String(item?.sid || "").trim(),
        objectSid: String(item?.objectSid || item?.object_sid || "").trim(),
      })).filter((item: any) => item.sid && item.objectSid);
    }
  } catch {
    // raw fallback below
  }

  try {
    const data: any = await trusthubFetch({
      auth: args.auth,
      method: "GET",
      path: `/v1/TrustProducts/${args.trustProductSid}/EntityAssignments`,
      extraHeaders: {
        "X-Twilio-AccountSid": args.accountSidUsed,
      },
    });
    const list = data?.results || data?.entity_assignments || data?.entityAssignments || [];
    return list.map((item: any) => ({
      sid: String(item?.sid || item?.Sid || "").trim(),
      objectSid: String(item?.objectSid || item?.object_sid || item?.ObjectSid || "").trim(),
    })).filter((item: any) => item.sid && item.objectSid);
  } catch {
    return [];
  }
}

async function removeTrustProductEntityAssignment(args: {
  client: any;
  auth: { username: string; password: string; effectiveAccountSid: string };
  accountSidUsed: string;
  trustProductSid: string;
  assignmentSid: string;
}) {
  try {
    const tp: any = args.client.trusthub.v1.trustProducts(args.trustProductSid) as any;
    const sub =
      tp?.entityAssignments ||
      tp?.trustProductsEntityAssignments ||
      tp?.trustProductsEntityAssignment;

    if (sub) {
      if (typeof sub === "function") {
        await sub(args.assignmentSid).remove();
        return;
      }
      if (typeof sub.remove === "function") {
        await sub.remove(args.assignmentSid);
        return;
      }
    }
  } catch {
    // raw fallback below
  }

  await trusthubFetch({
    auth: args.auth,
    method: "DELETE",
    path: `/v1/TrustProducts/${args.trustProductSid}/EntityAssignments/${args.assignmentSid}`,
    extraHeaders: {
      "X-Twilio-AccountSid": args.accountSidUsed,
    },
  });
}

async function listTrustProductAssignmentObjectSids(args: {
  client: any;
  auth: { username: string; password: string; effectiveAccountSid: string };
  accountSidUsed: string;
  trustProductSid: string;
}) {
  try {
    const tp: any = args.client.trusthub.v1.trustProducts(args.trustProductSid) as any;
    const sub =
      tp?.entityAssignments ||
      tp?.trustProductsEntityAssignments ||
      tp?.trustProductsEntityAssignment;

    if (sub && typeof sub.list === "function") {
      const list = (await sub.list({ limit: 50 })) || [];
      return list
        .map((item: any) => String(item?.objectSid || item?.object_sid || "").trim())
        .filter(Boolean);
    }
  } catch {
    // raw fallback below
  }

  try {
    const data: any = await trusthubFetch({
      auth: args.auth,
      method: "GET",
      path: `/v1/TrustProducts/${args.trustProductSid}/EntityAssignments`,
      extraHeaders: {
        "X-Twilio-AccountSid": args.accountSidUsed,
      },
    });
    const list = data?.results || data?.entity_assignments || data?.entityAssignments || [];
    return list
      .map((item: any) => String(item?.objectSid || item?.object_sid || item?.ObjectSid || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function recoverExistingTrustProductForProfile(args: {
  client: any;
  auth: { username: string; password: string; effectiveAccountSid: string };
  accountSidUsed: string;
  secondaryProfileSid: string;
  a2pProfileEndUserSid?: string;
}) {
  try {
    const list = (await args.client.trusthub.v1.trustProducts.list({ limit: 100 })) || [];
    for (const item of list) {
      const sid = String(item?.sid || "").trim();
      if (!sid) continue;
      const assigned = await listTrustProductAssignmentObjectSids({
        client: args.client,
        auth: args.auth,
        accountSidUsed: args.accountSidUsed,
        trustProductSid: sid,
      });
      if (assigned.includes(args.secondaryProfileSid)) return sid;
      if (args.a2pProfileEndUserSid && assigned.includes(args.a2pProfileEndUserSid)) return sid;
    }
  } catch {
    // best effort
  }
  return undefined;
}

async function removeStaleA2PMessagingProfileAssignments(args: {
  client: any;
  auth: { username: string; password: string; effectiveAccountSid: string };
  accountSidUsed: string;
  trustProductSid: string;
}) {
  const assignments = await listTrustProductAssignmentsDetailed(args);
  const removedObjectSids: string[] = [];

  for (const assignment of assignments) {
    const objectSid = String(assignment.objectSid || "").trim();
    if (!objectSid.startsWith("IT")) continue;

    let endUserType = "";
    try {
      const endUser: any = await args.client.trusthub.v1.endUsers(objectSid).fetch();
      endUserType = String(endUser?.type || "").trim();
    } catch {
      endUserType = "";
    }

    if (endUserType !== "us_a2p_messaging_profile_information") continue;

    await removeTrustProductEntityAssignment({
      client: args.client,
      auth: args.auth,
      accountSidUsed: args.accountSidUsed,
      trustProductSid: args.trustProductSid,
      assignmentSid: assignment.sid,
    });

    removedObjectSids.push(objectSid);
    console.log("[A2P] removed stale end-user", {
      trustProductSid: args.trustProductSid,
      assignmentSid: assignment.sid,
      objectSid,
    });
  }

  return removedObjectSids;
}

async function upsertA2PTrustProductEndUser(args: {
  client: any;
  profile: any;
  normalizedEmail: string;
  existingSid?: string;
  forceCreateFresh?: boolean;
}) {
  const friendlyName = `${String(args.profile.businessName || "").trim() || "Business"} – A2P Messaging Profile`;
  const attributes: Record<string, string> = {
    company_type: A2P_COMPANY_TYPE,
    brand_contact_email: String(args.profile.email || args.normalizedEmail || NOTIFY_EMAIL),
  };
  delete (attributes as any).stock_exchange;
  delete (attributes as any).stock_ticker;

  if (args.existingSid && !args.forceCreateFresh) {
    try {
      const updated: any = await args.client.trusthub.v1.endUsers(args.existingSid).update({
        friendlyName,
        attributes,
      } as any);
      return String(updated?.sid || args.existingSid || "").trim();
    } catch (err: any) {
      if (!isTwilioNotFound(err)) throw err;
    }
  }

  const created: any = await args.client.trusthub.v1.endUsers.create({
    type: "us_a2p_messaging_profile_information",
    friendlyName,
    attributes,
  });
  return String(created?.sid || "").trim();
}

async function recoverExistingCampaignForBrand(args: {
  client: any;
  messagingServiceSid: string;
  brandSid: string;
}) {
  try {
    const list =
      (await args.client.messaging.v1
        .services(args.messagingServiceSid)
        .usAppToPerson.list({ limit: 50 })) || [];

    const match = (list || []).find((item: any) => {
      const itemBrandSid =
        item?.brandRegistrationSid || item?.brandSid || item?.brand_registration_sid;
      return String(itemBrandSid || "") === String(args.brandSid);
    });

    const sid = String(
      match?.sid || match?.campaignSid || match?.campaign_id || match?.campaignId || "",
    ).trim();

    return sid || undefined;
  } catch {
    return undefined;
  }
}

async function detachNumberFromAllServices(args: { client: any; numberSid: string }) {
  const services = await args.client.messaging.v1.services.list({ limit: 200 });
  for (const svc of services) {
    try {
      const attached = await args.client.messaging.v1.services(svc.sid).phoneNumbers.list({
        limit: 200,
      });
      for (const assoc of attached) {
        const assocIncomingSid =
          (assoc as any).phoneNumberSid || (assoc as any).phone_number_sid;
        if (String(assocIncomingSid || "") !== String(args.numberSid)) continue;
        const assocSid = (assoc as any).sid;
        if (assocSid) {
          await args.client.messaging.v1.services(svc.sid).phoneNumbers(assocSid).remove();
        }
      }
    } catch {
      // best effort
    }
  }
}

async function addNumberToMessagingService(args: {
  client: any;
  serviceSid: string;
  numberSid: string;
}) {
  try {
    await args.client.messaging.v1.services(args.serviceSid).phoneNumbers.create({
      phoneNumberSid: args.numberSid,
    });
  } catch (err: any) {
    if (err?.code === 21710) return;
    if (err?.code === 21712) {
      await detachNumberFromAllServices({
        client: args.client,
        numberSid: args.numberSid,
      });
      await args.client.messaging.v1.services(args.serviceSid).phoneNumbers.create({
        phoneNumberSid: args.numberSid,
      });
      return;
    }
    throw err;
  }
}

async function attachOwnedNumbers(args: {
  client: any;
  user: any;
  messagingServiceSid: string;
  ready: boolean;
}) {
  const owned = await PhoneNumber.find({ userId: args.user._id }).lean<any[]>();
  let attachedCount = 0;

  for (const num of owned) {
    let numberSid = String(num.twilioSid || "").trim();
    if (!numberSid && num.phoneNumber) {
      try {
        const found = await args.client.incomingPhoneNumbers.list({
          phoneNumber: String(num.phoneNumber),
          limit: 1,
        });
        numberSid = String(found?.[0]?.sid || "").trim();
      } catch {
        numberSid = "";
      }
    }

    if (!numberSid) continue;

    try {
      await addNumberToMessagingService({
        client: args.client,
        serviceSid: args.messagingServiceSid,
        numberSid,
      });
      attachedCount += 1;
      await PhoneNumber.updateOne(
        { _id: num._id },
        {
          $set: {
            twilioSid: numberSid,
            messagingServiceSid: args.messagingServiceSid,
            a2pApproved: args.ready,
          },
        },
      );
    } catch {
      // best effort
    }
  }

  const userNumbers = Array.isArray(args.user?.numbers) ? args.user.numbers : [];
  if (userNumbers.length) {
    args.user.numbers = userNumbers.map((entry: any) => ({
      ...entry,
      messagingServiceSid: args.messagingServiceSid,
    }));
  }

  return attachedCount;
}

async function mirrorUserA2P(args: {
  user: any;
  profile: any;
}) {
  args.user.a2p = args.user.a2p || {};
  const target = args.user.a2p as any;
  target.profileSid = args.profile.profileSid || undefined;
  target.profileStatus = args.profile.profileStatus || undefined;
  target.trustProductSid = args.profile.trustProductSid || undefined;
  target.trustProductStatus = args.profile.trustProductStatus || undefined;
  target.brandSid = args.profile.brandSid || undefined;
  target.brandStatus = args.profile.brandStatus || undefined;
  target.campaignSid = args.profile.campaignSid || args.profile.usa2pSid || undefined;
  target.campaignStatus = args.profile.campaignStatus || undefined;
  target.messagingServiceSid = args.profile.messagingServiceSid || undefined;
  target.messagingReady = Boolean(args.profile.messagingReady);
  target.registrationStatus = args.profile.registrationStatus || undefined;
  target.applicationStatus = args.profile.applicationStatus || undefined;
  target.declinedReason = args.profile.declinedReason || null;
  target.lastCheckedAt = args.profile.lastCheckedAt || undefined;
  target.lastAdvancedAt = args.profile.lastAdvancedAt || undefined;
  target.lastSyncedAt = new Date();
  await args.user.save();
}

export async function resumeA2PAutomationForUserEmail(userEmail: string) {
  await mongooseConnect();

  const normalizedEmail = String(userEmail || "").toLowerCase().trim();
  if (!normalizedEmail) return null;

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) return null;

  let profile = await A2PProfile.findOne({ userId: String(user._id) });
  if (!profile) return null;

  let resolved;
  try {
    resolved = await getClientForUser(normalizedEmail);
  } catch (err: any) {
    log("A2P ERROR", { userEmail: normalizedEmail, message: err?.message || String(err) });
    return profile.toObject();
  }

  const client = resolved.client;
  const now = new Date();
  const update: Record<string, any> = {
    lastCheckedAt: now,
    lastSyncedAt: now,
    twilioAccountSidLastUsed: resolved.accountSid,
  };
  let advanced = false;

  try {
    let messagingServiceSid = profile.messagingServiceSid
      ? String(profile.messagingServiceSid)
      : "";

    if ((profile.profileSid || profile.trustProductSid || profile.brandSid || profile.usa2pSid) && !messagingServiceSid) {
      messagingServiceSid = await ensureMessagingService({
        client,
        a2pId: String(profile._id),
        userId: String(user._id),
        userEmail: normalizedEmail,
        existingSid: profile.messagingServiceSid,
      });
      update.messagingServiceSid = messagingServiceSid;
      advanced = true;
      log("A2P ADVANCE", {
        userEmail: normalizedEmail,
        step: "messaging_service",
        messagingServiceSid,
      });
    }

    let profileStatus = normalizeTrustHubStatus(profile.profileStatus);
    if (profile.profileSid) {
      try {
        const customerProfile: any = await client.trusthub.v1
          .customerProfiles(profile.profileSid)
          .fetch();
        profileStatus = normalizeTrustHubStatus(customerProfile?.status);
        update.profileStatus = profileStatus || undefined;
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          update.profileStatus = undefined;
        }
      }
    }

    let trustProductSid = profile.trustProductSid ? String(profile.trustProductSid).trim() : "";
    let trustProductStatus = normalizeTrustHubStatus(profile.trustProductStatus);
    let trustProductRejectionReason = "";
    if (trustProductSid) {
      try {
        const trustProduct: any = await client.trusthub.v1.trustProducts(trustProductSid).fetch();
        trustProductStatus = normalizeTrustHubStatus(trustProduct?.status);
        const rawFailure =
          trustProduct?.failureReason ||
          trustProduct?.failureReasons ||
          trustProduct?.errors ||
          trustProduct?.errorCodes ||
          trustProduct?.rejectionReasons ||
          undefined;
        if (typeof rawFailure === "string") {
          trustProductRejectionReason = rawFailure;
        } else if (rawFailure) {
          try {
            trustProductRejectionReason = JSON.stringify(rawFailure);
          } catch {
            trustProductRejectionReason = String(rawFailure);
          }
        }
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          await A2PProfile.updateOne(
            { _id: profile._id },
            { $unset: { trustProductSid: 1, a2pProfileEndUserSid: 1 } },
          );
          trustProductSid = "";
          update.trustProductSid = undefined;
          update.trustProductStatus = undefined;
          update.a2pProfileEndUserSid = undefined;
        } else {
          throw err;
        }
      }
    }

    const profileApproved = TRUSTHUB_APPROVED.has(profileStatus);

    if (!trustProductSid && profile.profileSid && profileApproved) {
      const recoveredTrustProductSid = await recoverExistingTrustProductForProfile({
        client,
        auth: resolved.auth,
        accountSidUsed: resolved.accountSid,
        secondaryProfileSid: String(profile.profileSid),
        a2pProfileEndUserSid: String(profile.a2pProfileEndUserSid || "").trim() || undefined,
      });

      if (recoveredTrustProductSid) {
        trustProductSid = recoveredTrustProductSid;
      } else {
        const created: any = await client.trusthub.v1.trustProducts.create({
          friendlyName: `${String(profile.businessName || "").trim() || "Business"} – A2P Trust Product`,
          email: String(profile.email || normalizedEmail || NOTIFY_EMAIL),
          policySid: A2P_TRUST_PRODUCT_POLICY_SID,
          statusCallback: STATUS_CB,
        });
        trustProductSid = String(created?.sid || "").trim();
      }

      if (trustProductSid) {
        update.trustProductSid = trustProductSid;
        update.registrationStatus = "trust_product_submitted";
        update.lastAdvancedAt = now;
        advanced = true;
        log("A2P ADVANCE", {
          userEmail: normalizedEmail,
          step: "trust_product",
          trustProductSid,
        });
      }
    }

    let a2pProfileEndUserSid = String(profile.a2pProfileEndUserSid || "").trim();
    if (trustProductSid && profile.profileSid && profileApproved) {
      const shouldRepairCompanyType = isCompanyTypeRejected(
        trustProductStatus,
        trustProductRejectionReason || profile.lastError || profile.declinedReason,
      );

      if (!a2pProfileEndUserSid || shouldRepairCompanyType) {
        if (shouldRepairCompanyType) {
          await removeStaleA2PMessagingProfileAssignments({
            client,
            auth: resolved.auth,
            accountSidUsed: resolved.accountSid,
            trustProductSid,
          });
        }

        a2pProfileEndUserSid = await upsertA2PTrustProductEndUser({
          client,
          profile,
          normalizedEmail,
          existingSid: a2pProfileEndUserSid || undefined,
          forceCreateFresh: shouldRepairCompanyType,
        });
        if (a2pProfileEndUserSid) {
          update.a2pProfileEndUserSid = a2pProfileEndUserSid;
          if (shouldRepairCompanyType) {
            console.log("[A2P] created fresh end-user", {
              trustProductSid,
              objectSid: a2pProfileEndUserSid,
            });
          }
        }
      }

      if (a2pProfileEndUserSid) {
        await assignEntityToTrustProduct({
          client,
          auth: resolved.auth,
          accountSidUsed: resolved.accountSid,
          trustProductSid,
          objectSid: a2pProfileEndUserSid,
        });
        if (shouldRepairCompanyType) {
          console.log("[A2P] reassigned trust product", {
            trustProductSid,
            objectSid: a2pProfileEndUserSid,
          });
        }
      }

      await assignEntityToTrustProduct({
        client,
        auth: resolved.auth,
        accountSidUsed: resolved.accountSid,
        trustProductSid,
        objectSid: String(profile.profileSid),
      });

      await evaluateAndSubmitTrustProduct({
        client,
        auth: resolved.auth,
        accountSidUsed: resolved.accountSid,
        trustProductSid,
      });
    }

    if (trustProductSid) {
      try {
        const trustProduct: any = await client.trusthub.v1
          .trustProducts(trustProductSid)
          .fetch();
        trustProductStatus = normalizeTrustHubStatus(trustProduct?.status);
        update.trustProductStatus = trustProductStatus || undefined;
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          update.trustProductStatus = undefined;
        }
      }
    }

    let brandSid = profile.brandSid ? String(profile.brandSid) : "";
    let brandStatus = normalizeUpper(profile.brandStatus);
    let brandFailureReason = profile.brandFailureReason
      ? String(profile.brandFailureReason)
      : "";

    if (!brandSid && profile.profileSid && trustProductSid) {
      const trustApproved = TRUSTHUB_APPROVED.has(trustProductStatus);

      if (profileApproved && trustApproved) {
        try {
          const created: any = await client.messaging.v1.brandRegistrations.create({
            customerProfileBundleSid: profile.profileSid,
            a2PProfileBundleSid: trustProductSid,
            brandType: "LOW_VOLUME_STANDARD",
          });
          const sidCandidate = created?.sid || created?.brandSid || created?.id;
          if (isSidLike(sidCandidate, "BN")) {
            brandSid = sidCandidate;
          }
        } catch (err: any) {
          if (err?.code === 20409 || err?.status === 409) {
            const recovered = await findExistingBrandForBundles({
              client,
              profileSid: String(profile.profileSid),
              trustProductSid,
            });
            if (recovered) brandSid = recovered;
          } else {
            throw err;
          }
        }

        if (brandSid) {
          update.brandSid = brandSid;
          update.registrationStatus = "brand_submitted";
          update.lastAdvancedAt = now;
          advanced = true;
          log("A2P ADVANCE", {
            userEmail: normalizedEmail,
            step: "brand",
            brandSid,
          });
        }
      }
    }

    if (brandSid) {
      try {
        const brand: any = await client.messaging.v1.brandRegistrations(brandSid).fetch();
        brandStatus = normalizeUpper(brand?.status);
        const rawFailure =
          brand?.failureReason ||
          brand?.failureReasons ||
          brand?.errors ||
          brand?.errorCodes ||
          undefined;
        if (typeof rawFailure === "string") {
          brandFailureReason = rawFailure;
        } else if (rawFailure) {
          try {
            brandFailureReason = JSON.stringify(rawFailure);
          } catch {
            brandFailureReason = String(rawFailure);
          }
        } else {
          brandFailureReason = "";
        }

        update.brandSid = brandSid;
        update.brandStatus = brandStatus || undefined;
        update.brandFailureReason = brandFailureReason || undefined;
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          brandSid = "";
          brandStatus = "";
          update.brandSid = undefined;
          update.brandStatus = undefined;
        }
      }
    }

    let campaignSid = String(profile.campaignSid || profile.usa2pSid || "").trim();
    let campaignStatus = normalizeUpper((profile as any).campaignStatus);

    if (!campaignSid && brandSid && BRAND_OK_FOR_CAMPAIGN.has(brandStatus)) {
      if (!messagingServiceSid) {
        messagingServiceSid = await ensureMessagingService({
          client,
          a2pId: String(profile._id),
          userId: String(user._id),
          userEmail: normalizedEmail,
          existingSid: profile.messagingServiceSid,
        });
        update.messagingServiceSid = messagingServiceSid;
      }

      const useCase = String(
        profile.lastSubmittedUseCase ||
          (profile as any).useCase ||
          profile.usecaseCode ||
          "LOW_VOLUME",
      );
      const samples = parseSamples(profile);
      const messageFlow = String(
        profile.lastSubmittedOptInDetails || profile.optInDetails || "",
      ).trim();

      if (samples.length >= 2 && messageFlow) {
        const lockUntil = new Date(now.getTime() + 2 * 60 * 1000);
        const lockedProfile = await A2PProfile.findOneAndUpdate(
          {
            _id: profile._id,
            $or: [
              { campaignSubmitLockUntil: { $exists: false } },
              { campaignSubmitLockUntil: null },
              { campaignSubmitLockUntil: { $lt: now } },
            ],
            $and: [
              { $or: [{ campaignSid: { $exists: false } }, { campaignSid: null }, { campaignSid: "" }] },
              { $or: [{ usa2pSid: { $exists: false } }, { usa2pSid: null }, { usa2pSid: "" }] },
            ],
          },
          {
            $set: {
              campaignSubmitLockUntil: lockUntil,
              campaignSubmitLastAttemptAt: now,
            },
            $inc: { campaignSubmitAttempts: 1 },
          },
          { new: true },
        );

        if (!lockedProfile) {
          const recoveredCampaignSid = await recoverExistingCampaignForBrand({
            client,
            messagingServiceSid,
            brandSid,
          });
          if (recoveredCampaignSid) {
            campaignSid = recoveredCampaignSid;
          }
        } else {
          try {
            const description = buildCampaignDescription({
              businessName: String(profile.businessName || ""),
              useCase,
              messageFlow,
            });

            const created: any = await client.messaging.v1
              .services(messagingServiceSid)
              .usAppToPerson.create({
                brandRegistrationSid: brandSid,
                usAppToPersonUsecase: useCase,
                description,
                messageFlow,
                messageSamples: samples,
                hasEmbeddedLinks: /https?:\/\//i.test(`${messageFlow} ${samples.join(" ")}`),
                hasEmbeddedPhone:
                  /\+\d{7,}/.test(`${messageFlow} ${samples.join(" ")}`) ||
                  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(
                    `${messageFlow} ${samples.join(" ")}`,
                  ),
                subscriberOptIn: true,
                ageGated: false,
                directLending: false,
              });

            campaignSid = String(
              created?.sid ||
                created?.campaignSid ||
                created?.campaign_id ||
                created?.campaignId ||
                "",
            ).trim();
            campaignStatus = normalizeUpper(
              created?.campaignStatus || created?.campaign_status || created?.status,
            );

            if (campaignSid) {
              update.campaignSid = campaignSid;
              update.usa2pSid = campaignSid;
              update.campaignStatus = campaignStatus || "PENDING";
              update.registrationStatus = "campaign_submitted";
              update.lastAdvancedAt = now;
              advanced = true;
              log("A2P ADVANCE", {
                userEmail: normalizedEmail,
                step: "campaign",
                campaignSid,
              });
            }
          } catch (err: any) {
            const recoveredCampaignSid = await recoverExistingCampaignForBrand({
              client,
              messagingServiceSid,
              brandSid,
            });
            if (recoveredCampaignSid) {
              campaignSid = recoveredCampaignSid;
            } else {
              throw err;
            }
          } finally {
            await A2PProfile.updateOne(
              { _id: profile._id },
              { $unset: { campaignSubmitLockUntil: 1 } },
            );
          }
        }
      }
    }

    if (campaignSid && messagingServiceSid) {
      const fetchedCampaignStatus = await fetchCampaignStatus({
        client,
        messagingServiceSid,
        campaignSid,
      });
      campaignStatus = normalizeUpper(fetchedCampaignStatus || campaignStatus);
      update.campaignSid = campaignSid;
      update.usa2pSid = campaignSid;
      update.campaignStatus = campaignStatus || undefined;
    }

    const isFailed =
      FAILED_STATUSES.has(brandStatus) || FAILED_STATUSES.has(campaignStatus);
    const messagingReady = CAMPAIGN_APPROVED.has(campaignStatus);

    if (messagingServiceSid) {
      const attachedCount = await attachOwnedNumbers({
        client,
        user,
        messagingServiceSid,
        ready: messagingReady,
      });
      if (attachedCount > 0) {
        update.messagingServiceSid = messagingServiceSid;
      }
    }

    if (messagingReady) {
      update.messagingReady = true;
      update.applicationStatus = "approved";
      update.registrationStatus = "ready";
      update.declinedReason = null;
      update.lastAdvancedAt = update.lastAdvancedAt || now;
      log("A2P READY", {
        userEmail: normalizedEmail,
        brandSid: brandSid || undefined,
        campaignSid: campaignSid || undefined,
        messagingServiceSid: messagingServiceSid || undefined,
      });
    } else if (isFailed) {
      update.messagingReady = false;
      update.applicationStatus = "declined";
      update.registrationStatus = "rejected";
      update.declinedReason = brandFailureReason || profile.declinedReason || "Rejected by reviewers";
    } else {
      update.messagingReady = false;
      update.applicationStatus = "pending";
      if (campaignSid) update.registrationStatus = "campaign_submitted";
      else if (brandSid && BRAND_OK_FOR_CAMPAIGN.has(brandStatus)) update.registrationStatus = "brand_approved";
      else if (brandSid) update.registrationStatus = "brand_submitted";
      else if (trustProductSid) update.registrationStatus = "trust_product_submitted";
      else if (profile.profileSid) update.registrationStatus = "profile_submitted";
    }

    await A2PProfile.updateOne({ _id: profile._id }, { $set: update });
    profile = await A2PProfile.findById(profile._id);
    if (!profile) return null;

    await mirrorUserA2P({ user, profile });

    if (advanced) {
      log("A2P RESUME", {
        userEmail: normalizedEmail,
        profileSid: profile.profileSid,
        trustProductSid: profile.trustProductSid,
        brandSid: profile.brandSid,
        campaignSid: profile.campaignSid || profile.usa2pSid,
        messagingReady: Boolean(profile.messagingReady),
      });
    }

    return profile.toObject();
  } catch (err: any) {
    log("A2P ERROR", {
      userEmail: normalizedEmail,
      message: err?.message || String(err),
    });
    if (profile?._id) {
      try {
        await A2PProfile.updateOne(
          { _id: profile._id },
          {
            $set: {
              lastCheckedAt: now,
              lastError: err?.message || String(err),
            },
          },
        );
      } catch {
        // best effort
      }
    }
    return profile ? profile.toObject() : null;
  }
}
