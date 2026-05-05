import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

const APPROVED_BRAND = new Set(["approved", "verified", "active", "in_use", "registered"]);
const APPROVED_CAMPAIGN = new Set(["approved", "verified", "active", "in_use", "registered", "campaign_approved"]);
const UNREGISTERED_USECASE = new Set(["", "undeclared", "unknown"]);

type BasicAuth = { username: string; password: string; label: string };

function maskSid(sid?: string | null) {
  if (!sid) return null;
  return sid.length <= 8 ? sid : `${sid.slice(0, 4)}...${sid.slice(-4)}`;
}

function normalizePhone(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return String(value || "").startsWith("+") ? String(value || "") : "";
}

function basicAuthHeader(auth: BasicAuth) {
  return `Basic ${Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64")}`;
}

function twilioAuthCandidates(resolved: any, accountSid: string): BasicAuth[] {
  const candidates: BasicAuth[] = [];
  const platformSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const platformToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();

  if (platformSid && platformToken && platformSid === accountSid) {
    candidates.push({ username: platformSid, password: platformToken, label: "platform_sid_auth_token" });
  }

  if (resolved?.auth?.username && resolved?.auth?.password) {
    candidates.push({
      username: String(resolved.auth.username),
      password: String(resolved.auth.password),
      label: `resolved_${resolved.auth.mode || "auth"}`,
    });
  }

  // Do NOT try parent/platform auth against a different subaccount SID here.
  // Subaccount Messaging/TrustHub reads must use the resolved tenant credentials.
  // Trying parent auth against tenant resources causes Twilio 401 Authenticate.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.username}:${candidate.label}`;
    if (!candidate.username || !candidate.password || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchTwilioJson(url: string, auths: BasicAuth[], init: RequestInit = {}) {
  let last: any = null;
  for (const auth of auths) {
    const resp = await fetch(url, {
      ...init,
      headers: {
        Authorization: basicAuthHeader(auth),
        "Content-Type": "application/x-www-form-urlencoded",
        ...(init.headers || {}),
      },
    });
    const text = await resp.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (resp.ok) return { data, authLabel: auth.label };

    last = {
      status: resp.status,
      code: data?.code || data?.Code,
      message: data?.message || data?.Message || text || resp.statusText,
      authLabel: auth.label,
    };

    if (![401, 403].includes(resp.status)) break;
  }

  throw new Error(
    `Twilio REST failed (${last?.status || "?"}) auth=${last?.authLabel || "?"} code=${last?.code || "?"} message=${last?.message || "unknown"}`,
  );
}

function serviceRegistered(service: any) {
  return service?.usAppToPersonRegistered === true || service?.us_app_to_person_registered === true;
}

function serviceUsecase(service: any) {
  return String(service?.usecase || service?.useCase || "").trim();
}

function campaignSidOf(campaign: any) {
  return String(campaign?.sid || campaign?.campaignSid || campaign?.campaign_id || campaign?.campaignId || "").trim();
}

function campaignBrandSidOf(campaign: any) {
  return String(
    campaign?.brandRegistrationSid ||
      campaign?.brand_registration_sid ||
      campaign?.brandSid ||
      campaign?.brand_sid ||
      "",
  ).trim();
}

function campaignStatusOf(campaign: any) {
  return String(campaign?.campaignStatus || campaign?.campaign_status || campaign?.status || campaign?.state || "").trim();
}

function getUsecase(profile: any) {
  return String(
    profile?.lastSubmittedUseCase ||
      profile?.usecaseCode ||
      profile?.useCaseSid ||
      "LOW_VOLUME",
  ).trim();
}

function getMessageFlow(profile: any) {
  const flow = String(profile?.lastSubmittedOptInDetails || profile?.optInDetails || "").trim();
  return flow.length >= 40
    ? flow
    : `${flow || "Leads opt in through CoveCRM hosted forms and request insurance follow-up by SMS."} Reply STOP to opt out.`;
}

function getMessageSamples(profile: any) {
  const raw =
    (Array.isArray(profile?.lastSubmittedSampleMessages) && profile.lastSubmittedSampleMessages.length
      ? profile.lastSubmittedSampleMessages
      : null) ||
    (Array.isArray(profile?.sampleMessagesArr) && profile.sampleMessagesArr.length
      ? profile.sampleMessagesArr
      : null) ||
    String(profile?.sampleMessages || "")
      .split(/\n{2,}|\r{2,}/)
      .filter(Boolean);

  const samples = raw.map((sample: any) => String(sample || "").trim()).filter((sample: string) => sample.length >= 20);
  if (samples.length >= 2) return samples.slice(0, 5);

  return [
    "Hi, this is your licensed insurance agent following up on your coverage request. Reply STOP to opt out.",
    "Thanks for requesting insurance information. I can help compare options and answer questions. Reply STOP to opt out.",
  ];
}

function hasEmbeddedLinks(flow: string, samples: string[]) {
  return /https?:\/\//i.test([flow, ...samples].join(" "));
}

function hasEmbeddedPhone(flow: string, samples: string[]) {
  return /\+\d{7,}|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test([flow, ...samples].join(" "));
}

async function fetchMessagingService(client: any, auths: BasicAuth[], messagingServiceSid: string) {
  try {
    return await client.messaging.v1.services(messagingServiceSid).fetch();
  } catch (sdkErr: any) {
    const { data } = await fetchTwilioJson(
      `https://messaging.twilio.com/v1/Services/${encodeURIComponent(messagingServiceSid)}`,
      auths,
    );
    return data;
  }
}

async function listServiceCampaigns(client: any, auths: BasicAuth[], messagingServiceSid: string) {
  try {
    return (await client.messaging.v1.services(messagingServiceSid).usAppToPerson.list({ limit: 50 })) || [];
  } catch {}

  const { data } = await fetchTwilioJson(
    `https://messaging.twilio.com/v1/Services/${encodeURIComponent(messagingServiceSid)}/Compliance/Usa2p?PageSize=50`,
    auths,
  );
  return data?.us_app_to_person || data?.usa2p || data?.campaigns || data?.compliance || [];
}

async function fetchServiceCampaign(client: any, auths: BasicAuth[], messagingServiceSid: string, campaignSid: string) {
  try {
    return await client.messaging.v1.services(messagingServiceSid).usAppToPerson(campaignSid).fetch();
  } catch {}

  const campaigns = await listServiceCampaigns(client, auths, messagingServiceSid);
  return campaigns.find((campaign: any) => campaignSidOf(campaign) === campaignSid) || null;
}

async function createServiceCampaign(args: {
  client: any;
  auths: BasicAuth[];
  messagingServiceSid: string;
  brandSid: string;
  profile: any;
  dryRun: boolean;
}) {
  const { client, auths, messagingServiceSid, brandSid, profile, dryRun } = args;
  if (dryRun) return null;

  const messageFlow = getMessageFlow(profile);
  const messageSamples = getMessageSamples(profile);
  const payload = {
    brandRegistrationSid: brandSid,
    description: messageFlow.slice(0, 180),
    messageFlow,
    messageSamples,
    usAppToPersonUsecase: getUsecase(profile),
    hasEmbeddedLinks: hasEmbeddedLinks(messageFlow, messageSamples),
    hasEmbeddedPhone: hasEmbeddedPhone(messageFlow, messageSamples),
  };

  try {
    return await client.messaging.v1.services(messagingServiceSid).usAppToPerson.create(payload);
  } catch (sdkErr: any) {
    const body = new URLSearchParams();
    body.set("BrandRegistrationSid", payload.brandRegistrationSid);
    body.set("Description", payload.description);
    body.set("MessageFlow", payload.messageFlow);
    body.set("UsAppToPersonUsecase", payload.usAppToPersonUsecase);
    body.set("HasEmbeddedLinks", String(payload.hasEmbeddedLinks));
    body.set("HasEmbeddedPhone", String(payload.hasEmbeddedPhone));
    for (const sample of payload.messageSamples) body.append("MessageSamples", sample);

    const { data } = await fetchTwilioJson(
      `https://messaging.twilio.com/v1/Services/${encodeURIComponent(messagingServiceSid)}/Compliance/Usa2p`,
      auths,
      { method: "POST", body },
    );
    return data;
  }
}

async function resolveCampaign(args: {
  client: any;
  auths: BasicAuth[];
  messagingServiceSid: string;
  profile: any;
  userA2P: any;
  repair: boolean;
  dryRun: boolean;
}) {
  const { client, auths, messagingServiceSid, profile, userA2P, repair, dryRun } = args;
  const dbCampaignSid = String(profile?.usa2pSid || profile?.campaignSid || userA2P?.usa2pSid || userA2P?.campaignSid || "").trim();
  const brandSid = String(profile?.brandSid || userA2P?.brandSid || "").trim();
  const brandStatus = String(profile?.brandStatus || userA2P?.brandStatus || "").toLowerCase();

  let campaigns: any[] = [];
  try {
    campaigns = await listServiceCampaigns(client, auths, messagingServiceSid);
  } catch {}

  if (dbCampaignSid) {
    const fetched = await fetchServiceCampaign(client, auths, messagingServiceSid, dbCampaignSid);
    if (fetched) return { campaign: fetched, campaignSid: campaignSidOf(fetched) || dbCampaignSid, created: false, reason: "db_campaign_on_service" };
  }

  const sameBrand = brandSid
    ? campaigns.filter((campaign) => campaignBrandSidOf(campaign) === brandSid)
    : [];
  const approvedSameBrand =
    sameBrand.find((campaign) => APPROVED_CAMPAIGN.has(campaignStatusOf(campaign).toLowerCase())) || sameBrand[0];
  if (approvedSameBrand) {
    return { campaign: approvedSameBrand, campaignSid: campaignSidOf(approvedSameBrand), created: false, reason: "service_campaign_same_brand" };
  }

  if (campaigns.length === 1) {
    return { campaign: campaigns[0], campaignSid: campaignSidOf(campaigns[0]), created: false, reason: "only_service_campaign" };
  }

  if (!repair) {
    return { campaign: null, campaignSid: dbCampaignSid || "", created: false, reason: dbCampaignSid ? "db_campaign_not_linked" : "missing_campaignSid" };
  }

  if (!brandSid) {
    return { campaign: null, campaignSid: "", created: false, reason: "missing_brandSid" };
  }

  if (brandStatus && !APPROVED_BRAND.has(brandStatus)) {
    return { campaign: null, campaignSid: "", created: false, reason: `brand_not_approved:${brandStatus}` };
  }

  const created = await createServiceCampaign({ client, auths, messagingServiceSid, brandSid, profile, dryRun });
  if (!created) {
    return { campaign: null, campaignSid: "", created: false, reason: "would_create_service_campaign" };
  }

  return { campaign: created, campaignSid: campaignSidOf(created), created: true, reason: "created_service_campaign" };
}

async function attachNumberIfMissing(client: any, messagingServiceSid: string, phoneNumberSid: string, dryRun: boolean) {
  const existing = await client.messaging.v1.services(messagingServiceSid).phoneNumbers.list({ limit: 1000 });
  const already = (existing || []).some((entry: any) => String(entry?.phoneNumberSid || "") === phoneNumberSid);
  if (already) return { attached: false, already: true };
  if (dryRun) return { attached: false, already: false };

  try {
    await client.messaging.v1.services(messagingServiceSid).phoneNumbers.create({ phoneNumberSid });
  } catch (err: any) {
    if (err?.code !== 21710) throw err;
  }
  return { attached: true, already: false };
}

async function findTwilioNumber(client: any, phoneSid?: string | null, phoneNumber?: string | null) {
  if (phoneSid) {
    try {
      return await client.incomingPhoneNumbers(phoneSid).fetch();
    } catch {}
  }
  const normalized = normalizePhone(phoneNumber);
  if (!normalized) return null;
  const found = await client.incomingPhoneNumbers.list({ phoneNumber: normalized, limit: 1 });
  return found?.[0] || null;
}

export async function ensureMessagingServiceA2PReadyForUser(
  userOrDoc: any,
  options: {
    dryRun?: boolean;
    repair?: boolean;
    attachNumbers?: boolean;
    purchasedNumberSid?: string | null;
    logPrefix?: string;
  } = {},
) {
  const dryRun = options.dryRun === true;
  const repair = options.repair !== false;
  const attachNumbers = options.attachNumbers !== false;
  const logPrefix = options.logPrefix || "ensureMessagingServiceA2PReady";

  const user =
    typeof userOrDoc?.toObject === "function"
      ? userOrDoc.toObject()
      : userOrDoc?._id
      ? userOrDoc
      : null;
  if (!user?._id || !user?.email) throw new Error("User with _id/email is required.");

  const resolved = await getClientForUser(String(user.email).toLowerCase());
  const client = resolved.client as any;
  const accountSid = resolved.accountSid;
  const auths = twilioAuthCandidates(resolved, accountSid);

  const profile = await A2PProfile.findOne({ userId: String(user._id) }).lean<any>();
  const a2p = user.a2p || {};

  const messagingServiceSid =
    String(a2p.messagingServiceSid || "").trim() ||
    String(profile?.messagingServiceSid || "").trim() ||
    String((user as any).messagingServiceSid || "").trim();

  if (!messagingServiceSid) throw new Error("Missing A2P Messaging Service SID.");
  if (!messagingServiceSid.startsWith("MG")) throw new Error("Invalid Messaging Service SID.");

  const initialService = await fetchMessagingService(client, auths, messagingServiceSid);
  if (String((initialService as any).accountSid || (initialService as any).account_sid || "") !== accountSid) {
    throw new Error("Messaging Service belongs to a different Twilio account.");
  }

  const beforeRegistered = serviceRegistered(initialService);
  const beforeUsecase = serviceUsecase(initialService);

  const resolvedCampaign = await resolveCampaign({
    client,
    auths,
    messagingServiceSid,
    profile,
    userA2P: a2p,
    repair,
    dryRun,
  });

  const campaign = resolvedCampaign.campaign;
  const campaignSid = resolvedCampaign.campaignSid || "";

  const refreshedService = await fetchMessagingService(client, auths, messagingServiceSid);
  const usecase = serviceUsecase(refreshedService);
  const serviceA2PRegistered = serviceRegistered(refreshedService);
  const campaignStatus = String(
    campaignStatusOf(campaign) ||
      profile?.campaignStatus ||
      a2p.campaignStatus ||
      "",
  );
  const campaignApproved = APPROVED_CAMPAIGN.has(campaignStatus.toLowerCase());
  const canSendSms = Boolean(
    serviceA2PRegistered &&
      !UNREGISTERED_USECASE.has(usecase.toLowerCase()) &&
      campaignSid &&
      campaignApproved,
  );

  const userNumberEntries = Array.isArray(user.numbers) ? user.numbers : [];
  const phoneDocs = await PhoneNumber.find({ userId: user._id }).lean<any[]>();
  const candidateNumbers = [
    ...userNumberEntries.map((entry: any) => ({
      sid: entry?.sid,
      phoneNumber: entry?.phoneNumber,
      status: entry?.status,
      source: "user",
    })),
    ...phoneDocs.map((entry: any) => ({
      sid: entry?.twilioSid || entry?.sid,
      phoneNumber: entry?.phoneNumber,
      status: entry?.status || "active",
      source: "phoneNumber",
    })),
    ...(options.purchasedNumberSid ? [{ sid: options.purchasedNumberSid, phoneNumber: null, status: "active", source: "purchased" }] : []),
  ];

  const seen = new Set<string>();
  const attachedNumbers: string[] = [];
  const attachedPhoneNumbers: string[] = [];
  const numbersMissing: string[] = [];
  const skippedNumbers: Array<{ sid?: string | null; phoneNumber?: string | null; reason: string }> = [];
  const initialSenderPool = await client.messaging.v1.services(messagingServiceSid).phoneNumbers.list({ limit: 1000 });
  const initialSenderPoolSids = new Set((initialSenderPool || []).map((entry: any) => String(entry?.phoneNumberSid || "")));

  for (const candidate of candidateNumbers) {
    const key = String(candidate.sid || candidate.phoneNumber || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const status = String(candidate.status || "active").toLowerCase();
    if (["inactive", "released", "deleted", "canceled", "cancelled"].includes(status)) {
      skippedNumbers.push({ sid: candidate.sid, phoneNumber: candidate.phoneNumber, reason: status });
      continue;
    }

    let twilioNumber: any = null;
    try {
      twilioNumber = await findTwilioNumber(client, candidate.sid, candidate.phoneNumber);
    } catch {}
    if (!twilioNumber?.sid) {
      skippedNumbers.push({ sid: candidate.sid, phoneNumber: candidate.phoneNumber, reason: "not_in_user_twilio_account" });
      continue;
    }
    if (!(twilioNumber.capabilities?.sms ?? twilioNumber.capabilities?.SMS)) {
      skippedNumbers.push({ sid: twilioNumber.sid, phoneNumber: twilioNumber.phoneNumber, reason: "not_sms_capable" });
      continue;
    }

    try {
      const alreadyAttached = initialSenderPoolSids.has(twilioNumber.sid);
      const result = alreadyAttached
        ? { attached: false, already: true }
        : attachNumbers && repair
        ? await attachNumberIfMissing(client, messagingServiceSid, twilioNumber.sid, dryRun)
        : { attached: false, already: false };
      if (result.already || result.attached) {
        attachedNumbers.push(twilioNumber.sid);
        if (twilioNumber.phoneNumber) attachedPhoneNumbers.push(twilioNumber.phoneNumber);
      } else {
        numbersMissing.push(twilioNumber.sid);
      }
    } catch (err: any) {
      skippedNumbers.push({ sid: twilioNumber.sid, phoneNumber: twilioNumber.phoneNumber, reason: err?.message || "attach_failed" });
    }
  }

  const senderPool = await client.messaging.v1.services(messagingServiceSid).phoneNumbers.list({ limit: 1000 });
  const senderPoolSids = new Set((senderPool || []).map((entry: any) => String(entry?.phoneNumberSid || "")));
  for (const sid of attachedNumbers) senderPoolSids.add(sid);

  const now = new Date();
  if (!dryRun) {
    const setReady = canSendSms;
    const userNumbers = userNumberEntries.map((entry: any) => {
      const owned = String(entry?.sid || "");
      const isAttached = owned && senderPoolSids.has(owned);
      return {
        ...entry,
        messagingServiceSid: isAttached ? messagingServiceSid : entry?.messagingServiceSid || null,
        a2pApproved: Boolean(setReady && isAttached),
        smsBlockedReason: setReady && isAttached ? undefined : "A2P messaging service not registered",
      };
    });

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          numbers: userNumbers,
          "a2p.messagingReady": setReady,
          "a2p.messagingServiceSid": messagingServiceSid,
          "a2p.campaignSid": campaignSid || a2p.campaignSid || null,
          "a2p.usa2pSid": campaignSid || a2p.usa2pSid || null,
          "a2p.campaignStatus": campaignStatus || a2p.campaignStatus || null,
          "a2p.lastSyncedAt": now,
          ...(!setReady ? { "a2p.smsBlockedReason": "A2P messaging service not registered" } : {}),
        },
        ...(setReady ? { $unset: { "a2p.smsBlockedReason": 1 } } : {}),
      },
    );

    await A2PProfile.updateOne(
      { userId: String(user._id) },
      {
        $set: {
          messagingReady: setReady,
          messagingServiceSid,
          ...(campaignSid ? { campaignSid, usa2pSid: campaignSid } : {}),
          ...(campaignStatus ? { campaignStatus } : {}),
          applicationStatus: setReady ? "approved" : "pending",
          registrationStatus: setReady ? "ready" : "campaign_submitted",
          lastSyncedAt: now,
          twilioAccountSidLastUsed: accountSid,
          ...(!setReady ? { lastError: "Messaging Service is not A2P registered/verified." } : {}),
        },
        ...(setReady ? { $unset: { lastError: 1 } } : {}),
      },
    );

    await PhoneNumber.updateMany(
      { userId: user._id },
      {
        $set: {
          messagingServiceSid: null,
          a2pApproved: false,
          smsBlockedReason: "A2P messaging service not registered",
        },
      },
    );

    if (setReady && senderPoolSids.size) {
      await PhoneNumber.updateMany(
        {
          userId: user._id,
          $or: [
            { twilioSid: { $in: Array.from(senderPoolSids) } },
            { sid: { $in: Array.from(senderPoolSids) } },
          ],
        },
        {
          $set: {
            messagingServiceSid,
            a2pApproved: true,
          },
          $unset: { smsBlockedReason: 1 },
        },
      );
    }
  }

  const blockedReasons = [
    !campaignSid ? resolvedCampaign.reason || "missing_campaignSid" : "",
    serviceA2PRegistered ? "" : "service_not_a2p_registered",
    UNREGISTERED_USECASE.has(usecase.toLowerCase()) ? "service_usecase_undeclared" : "",
    campaignSid && !campaignApproved ? `campaign_not_approved:${campaignStatus || "unknown"}` : "",
  ].filter(Boolean);

  const result = {
    ok: true,
    email: user.email,
    userId: String(user._id),
    accountSid,
    messagingServiceSid,
    campaignSid: campaignSid || null,
    campaignStatus: campaignStatus || null,
    campaignResolveReason: resolvedCampaign.reason,
    brandSid: String(profile?.brandSid || a2p.brandSid || "") || null,
    brandStatus: String(profile?.brandStatus || a2p.brandStatus || "") || null,
    beforeRegistered,
    beforeUsecase: beforeUsecase || null,
    serviceA2PRegistered,
    serviceUsecase: usecase || null,
    senderPoolCount: senderPoolSids.size,
    attachedNumbers,
    attachedPhoneNumbers,
    numbersAttached: attachedNumbers,
    numbersMissing,
    skippedNumbers,
    canSendSms,
    blockedReason: blockedReasons.join("; ") || null,
    dryRun,
    createdCampaign: resolvedCampaign.created,
  };

  console.log(
    JSON.stringify({
      msg: `${logPrefix}: result`,
      ...result,
      accountSid: maskSid(accountSid),
      messagingServiceSid: maskSid(messagingServiceSid),
      campaignSid: maskSid(campaignSid),
      brandSid: maskSid(result.brandSid),
    }),
  );

  return result;
}
