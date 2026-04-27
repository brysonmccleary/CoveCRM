import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

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

function isSidLike(value: any, prefix: string) {
  return typeof value === "string" && value.startsWith(prefix);
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

    let profileStatus = normalizeUpper(profile.profileStatus);
    if (profile.profileSid) {
      try {
        const customerProfile: any = await client.trusthub.v1
          .customerProfiles(profile.profileSid)
          .fetch();
        profileStatus = normalizeUpper(customerProfile?.status);
        update.profileStatus = profileStatus || undefined;
      } catch (err: any) {
        if (isTwilioNotFound(err)) {
          update.profileStatus = undefined;
        }
      }
    }

    let trustProductStatus = normalizeUpper(profile.trustProductStatus);
    if (profile.trustProductSid) {
      try {
        const trustProduct: any = await client.trusthub.v1
          .trustProducts(profile.trustProductSid)
          .fetch();
        trustProductStatus = normalizeUpper(trustProduct?.status);
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

    if (!brandSid && profile.profileSid && profile.trustProductSid) {
      const profileApproved = TRUSTHUB_APPROVED.has(profileStatus);
      const trustApproved = TRUSTHUB_APPROVED.has(trustProductStatus);

      if (profileApproved && trustApproved) {
        try {
          const created: any = await client.messaging.v1.brandRegistrations.create({
            customerProfileBundleSid: profile.profileSid,
            a2PProfileBundleSid: profile.trustProductSid,
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
              trustProductSid: String(profile.trustProductSid),
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
      else if (profile.trustProductSid) update.registrationStatus = "trust_product_submitted";
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
