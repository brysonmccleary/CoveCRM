type GuardResult = {
  campaign: any;
  campaignSid: string;
  campaignStatus?: string;
  didCreate: boolean;
  didUpdate: boolean;
  recovered: boolean;
  reason: string;
};

const FAILED_CAMPAIGN_STATUSES = new Set([
  "failed",
  "rejected",
  "declined",
  "terminated",
  "campaign_failed",
]);

function clean(value: any): string {
  return String(value || "").trim();
}

export function resolveExistingCampaignSid(...values: any[]): string {
  for (const value of values) {
    const sid = clean(value);
    if (sid) return sid;
  }
  return "";
}

export function campaignSidOf(campaign: any): string {
  return clean(campaign?.sid || campaign?.campaignSid || campaign?.campaign_id || campaign?.campaignId);
}

export function campaignStatusOf(campaign: any): string {
  return clean(campaign?.campaignStatus || campaign?.campaign_status || campaign?.status || campaign?.state || campaign?.registrationStatus);
}

export function campaignBrandSidOf(campaign: any): string {
  return clean(
    campaign?.brandRegistrationSid ||
      campaign?.brand_registration_sid ||
      campaign?.brandSid ||
      campaign?.brand_sid,
  );
}

export function isTwilioNotFound(err: any): boolean {
  const code = Number(err?.code);
  const status = Number(err?.status || err?.statusCode);
  const message = String(err?.message || "");
  return code === 20404 || status === 404 || /20404/.test(message) || /not found/i.test(message);
}

export function isCampaignRejectedOrFailed(status: any): boolean {
  return FAILED_CAMPAIGN_STATUSES.has(clean(status).toLowerCase());
}

async function fetchCampaign(client: any, messagingServiceSid: string, campaignSid: string) {
  return client.messaging.v1
    .services(messagingServiceSid)
    .usAppToPerson(campaignSid)
    .fetch();
}

async function listCampaigns(client: any, messagingServiceSid: string) {
  return (await client.messaging.v1.services(messagingServiceSid).usAppToPerson.list({ limit: 50 })) || [];
}

function buildCampaignUpdateRequestData(createPayload: any) {
  return {
    Description: createPayload.description,
    MessageFlow: createPayload.messageFlow,
    MessageSamples: createPayload.messageSamples,
    HasEmbeddedLinks: createPayload.hasEmbeddedLinks,
    HasEmbeddedPhone: createPayload.hasEmbeddedPhone,
    AgeGated: createPayload.ageGated,
    DirectLending: createPayload.directLending,
    PrivacyPolicyUrl: createPayload.privacyPolicyUrl,
    TermsAndConditionsUrl: createPayload.termsAndConditionsUrl,
  };
}

function buildCampaignCreateRequestData(createPayload: any) {
  return {
    BrandRegistrationSid: createPayload.brandRegistrationSid,
    Description: createPayload.description,
    MessageFlow: createPayload.messageFlow,
    MessageSamples: createPayload.messageSamples,
    UsAppToPersonUsecase: createPayload.usAppToPersonUsecase,
    HasEmbeddedLinks: createPayload.hasEmbeddedLinks,
    HasEmbeddedPhone: createPayload.hasEmbeddedPhone,
    SubscriberOptIn: createPayload.subscriberOptIn,
    AgeGated: createPayload.ageGated,
    DirectLending: createPayload.directLending,
    PrivacyPolicyUrl: createPayload.privacyPolicyUrl,
    TermsAndConditionsUrl: createPayload.termsAndConditionsUrl,
  };
}

async function updateExistingCampaign(args: {
  client: any;
  messagingServiceSid: string;
  campaignSid: string;
  createPayload: any;
}): Promise<GuardResult> {
  const updated = await args.client.messaging.v1.update({
    uri: `/Services/${args.messagingServiceSid}/Compliance/Usa2p/${args.campaignSid}`,
    method: "post",
    data: buildCampaignUpdateRequestData(args.createPayload),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  });

  const sid = campaignSidOf(updated) || args.campaignSid;
  return {
    campaign: updated,
    campaignSid: sid,
    campaignStatus: campaignStatusOf(updated),
    didCreate: false,
    didUpdate: true,
    recovered: false,
    reason: "updated_existing_failed_campaign",
  };
}

async function preserveExistingCampaign(campaign: any, campaignSid: string, reason: string): Promise<GuardResult> {
  return {
    campaign,
    campaignSid: campaignSidOf(campaign) || campaignSid,
    campaignStatus: campaignStatusOf(campaign),
    didCreate: false,
    didUpdate: false,
    recovered: reason.includes("recovered"),
    reason,
  };
}

export async function ensureA2PCampaignWithoutDuplicateCreate(args: {
  client: any;
  messagingServiceSid: string;
  brandSid: string;
  existingCampaignSid?: any;
  createPayload: any;
  allowCreate?: boolean;
  allowFailedUpdate?: boolean;
  log?: (...args: any[]) => void;
}): Promise<GuardResult> {
  const {
    client,
    messagingServiceSid,
    brandSid,
    createPayload,
    allowCreate = true,
    allowFailedUpdate = false,
    log,
  } = args;
  const existingCampaignSid = clean(args.existingCampaignSid);

  if (existingCampaignSid) {
    try {
      const existing = await fetchCampaign(client, messagingServiceSid, existingCampaignSid);
      const status = campaignStatusOf(existing);
      if (isCampaignRejectedOrFailed(status)) {
        if (!allowFailedUpdate) {
          log?.("A2P campaign guard: preserving failed/rejected campaign until explicit resubmission", {
            messagingServiceSid,
            campaignSid: existingCampaignSid,
            status,
          });
          return preserveExistingCampaign(
            existing,
            existingCampaignSid,
            "existing_failed_campaign_requires_explicit_resubmission",
          );
        }
        log?.("A2P campaign guard: updating existing failed/rejected campaign", {
          messagingServiceSid,
          campaignSid: existingCampaignSid,
          status,
        });
        return updateExistingCampaign({ client, messagingServiceSid, campaignSid: existingCampaignSid, createPayload });
      }
      return preserveExistingCampaign(existing, existingCampaignSid, "existing_campaign_fetch_succeeded");
    } catch (err: any) {
      if (!isTwilioNotFound(err)) throw err;
      log?.("A2P campaign guard: stored campaign missing; scanning same-brand campaigns before create", {
        messagingServiceSid,
        campaignSid: existingCampaignSid,
      });
    }
  }

  const campaigns = await listCampaigns(client, messagingServiceSid);
  const sameBrand = campaigns.find((campaign: any) => campaignBrandSidOf(campaign) === brandSid);
  if (sameBrand) {
    const sid = campaignSidOf(sameBrand);
    const status = campaignStatusOf(sameBrand);
    if (sid && isCampaignRejectedOrFailed(status)) {
      if (!allowFailedUpdate) {
        return preserveExistingCampaign(
          sameBrand,
          sid,
          "recovered_failed_campaign_requires_explicit_resubmission",
        );
      }
      log?.("A2P campaign guard: updating recovered same-brand failed/rejected campaign", {
        messagingServiceSid,
        campaignSid: sid,
        status,
      });
      return updateExistingCampaign({ client, messagingServiceSid, campaignSid: sid, createPayload });
    }
    return {
      campaign: sameBrand,
      campaignSid: sid,
      campaignStatus: status,
      didCreate: false,
      didUpdate: false,
      recovered: true,
      reason: "recovered_same_brand_campaign",
    };
  }

  if (!allowCreate) {
    return {
      campaign: null,
      campaignSid: existingCampaignSid,
      didCreate: false,
      didUpdate: false,
      recovered: false,
      reason: existingCampaignSid ? "existing_campaign_not_found_create_blocked" : "missing_campaign_create_blocked",
    };
  }

  log?.("A2P campaign guard: creating new campaign only after fetch/list recovery failed", {
    messagingServiceSid,
    brandSid,
  });
  const created = await client.messaging.v1.create({
    uri: `/Services/${messagingServiceSid}/Compliance/Usa2p`,
    method: "post",
    data: buildCampaignCreateRequestData(createPayload),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  });
  return {
    campaign: created,
    campaignSid: campaignSidOf(created),
    campaignStatus: campaignStatusOf(created),
    didCreate: true,
    didUpdate: false,
    recovered: false,
    reason: "created_new_campaign_no_existing_or_same_brand",
  };
}
