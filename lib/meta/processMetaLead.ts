// lib/meta/processMetaLead.ts
// Process an incoming Meta (Facebook native) lead webhook event

import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/lib/mongo/leads";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FBLeadEntry from "@/models/FBLeadEntry";
import MetaLeadWebhookEvent from "@/models/MetaLeadWebhookEvent";
import User from "@/models/User";
import Folder from "@/models/Folder";
import { retrieveMetaLead } from "./retrieveLead";
import { scoreLeadOnArrival } from "@/lib/leads/scoreLead";
import { checkDuplicate } from "@/lib/leads/checkDuplicate";
import { triggerAIFirstCall } from "@/lib/ai/triggerAIFirstCall";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";
import { stableLeadEventId } from "@/lib/facebook/hostedAttribution";
import { enqueueMetaLifecycleEventSafely } from "@/lib/meta/capi";
import { buildStructuredLeadFields } from "@/lib/leads/structuredLeadFields";
import { sendNewLeadNotificationEmail, sendRepeatOptInNotificationEmail } from "@/lib/email";

const FB_LEAD_TYPE_TO_CRM: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Trucker",
};

const FB_LEAD_TYPE_TO_AI_SCRIPT_KEY: Record<string, string> = {
  final_expense: "final_expense",
  mortgage_protection: "mortgage_protection",
  iul: "iul_cash_value",
  veteran: "veteran_leads",
  trucker: "trucker_leads",
};

// Retry backoff: 1 min, 5 min, 30 min, 2 hr, 6 hr
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];

async function updateEventStatus(
  leadgenId: string,
  update: Record<string, any>
) {
  try {
    await MetaLeadWebhookEvent.updateOne(
      { leadgenId },
      { $set: update }
    );
  } catch (err: any) {
    console.warn("[processMetaLead] MetaLeadWebhookEvent status update failed:", err?.message);
  }
}

export async function processMetaLead(
  leadgenId: string,
  pageId: string,
  formId: string,
  adId: string,
  adsetId: string,
  metaCampaignId: string,
  createdTime: string | number
) {
  await mongooseConnect();

  const now = new Date();

  // Atomic claim: this is the guard against double-creating a Lead or
  // double-firing the AI first-call flow when Meta redelivers the same
  // leadgen event (at-least-once delivery). Only one concurrent call for a
  // given leadgenId can win this transition — a second call arriving before
  // the first finishes sees processingStatus already "processing" (or
  // "processed"/"duplicate" for an already-completed one) and its $nin
  // filter won't match, so it bails out immediately, before ever reaching
  // retrieveMetaLead/Lead.create/triggerAIFirstCall below. Mirrors the
  // atomic-upsert idempotency pattern used for the Stripe ai_dialer_topup
  // credit (pages/api/stripe/webhook.ts).
  let claimed: any = null;
  try {
    claimed = await MetaLeadWebhookEvent.findOneAndUpdate(
      { leadgenId, processingStatus: { $nin: ["processing", "processed", "duplicate"] } },
      { $set: { processingStatus: "processing", lastAttemptAt: now }, $inc: { attemptCount: 1 } },
      { new: true }
    );
  } catch (err: any) {
    console.error(
      "[processMetaLead] Failed to atomically claim event, aborting to avoid a possible duplicate:",
      err?.message
    );
    return;
  }

  if (!claimed) {
    console.info(
      `[processMetaLead] Meta lead ${leadgenId} already processing/processed — skipping concurrent or duplicate delivery`
    );
    return;
  }

  const attemptCount = Number(claimed?.attemptCount) || 1;

  // Defensive secondary check — cheap, and catches a Lead created through any
  // other path (e.g. manual import) with the same metaLeadgenId.
  const existingLead = await Lead.findOne({ metaLeadgenId: leadgenId }).lean();
  if (existingLead) {
    console.info(`[processMetaLead] Duplicate Meta lead ${leadgenId} — skipping`);
    await updateEventStatus(leadgenId, {
      processingStatus: "duplicate",
      processedAt: now,
      lastError: "",
    });
    return;
  }

  let campaign: any = null;
  let user: any = null;

  if (metaCampaignId) {
    campaign = await FBLeadCampaign.findOne({
      metaCampaignId,
      status: { $in: ["active", "setup"] },
    }).lean();
  }

  if (!campaign && formId) {
    campaign = await FBLeadCampaign.findOne({
      metaFormId: formId,
      status: { $in: ["active", "setup"] },
    }).lean();
    if (campaign) {
      console.info(`[processMetaLead] Matched campaign by formId ${formId}`);
    }
  }

  if (!campaign) {
    console.warn(`[processMetaLead] No campaign found for leadgenId ${leadgenId}, metaCampaignId ${metaCampaignId}, formId ${formId}`);
    // Mark permanent — no campaign to route to, retrying won't help
    await updateEventStatus(leadgenId, {
      processingStatus: "failed_permanent",
      lastError: `No campaign matched: metaCampaignId=${metaCampaignId} formId=${formId}`,
    });
    return;
  }

  const userEmail = (campaign as any).userEmail as string;

  if (!user) {
    user = await User.findOne({ email: userEmail }).lean();
  }
  if (!user) {
    console.warn(`[processMetaLead] User not found: ${userEmail}`);
    await updateEventStatus(leadgenId, {
      processingStatus: "failed_permanent",
      lastError: `User not found: ${userEmail}`,
      matchedCampaignId: (campaign as any)._id,
      userEmail,
    });
    return;
  }

  // Update event with matched campaign/user before the retrieval attempt
  await updateEventStatus(leadgenId, {
    matchedCampaignId: (campaign as any)._id,
    userEmail,
  });

  let leadData: any;
  try {
    const userAccessToken = String((user as any).metaAccessToken || "").trim();
    leadData = await retrieveMetaLead(leadgenId, userAccessToken || undefined);
  } catch (err: any) {
    const retryIndex = Math.min(attemptCount - 1, RETRY_DELAYS_MS.length - 1);
    const nextRetryAt = attemptCount <= RETRY_DELAYS_MS.length
      ? new Date(now.getTime() + RETRY_DELAYS_MS[retryIndex])
      : null;
    const status = nextRetryAt ? "failed_retryable" : "failed_permanent";
    console.error(`[processMetaLead] Failed to retrieve lead ${leadgenId} (attempt ${attemptCount}):`, err?.message);
    await updateEventStatus(leadgenId, {
      processingStatus: status,
      lastError: String(err?.message || "retrieve failed").slice(0, 500),
      nextRetryAt,
    });
    return;
  }

  const dupCheck = await checkDuplicate(
    userEmail,
    leadData.phone,
    leadData.email
  );

  const _lt = (campaign as any).leadType as string;
  const _seg = String((campaign as any).audienceSegment || "standard");
  const aiScriptKey =
    (_lt === "mortgage_protection" && _seg === "veteran") ? "veteran_mortgage" :
    (_lt === "iul"                 && _seg === "veteran") ? "veteran_iul" :
    (_lt === "mortgage_protection" && _seg === "trucker") ? "trucker_mortgage" :
    (_lt === "iul"                 && _seg === "trucker") ? "trucker_iul" :
    FB_LEAD_TYPE_TO_AI_SCRIPT_KEY[_lt] || "final_expense";
  let folder: any = null;
  const attributedAd = (Array.isArray((campaign as any).ads) ? (campaign as any).ads : []).find(
    (candidate: any) => String(candidate?.metaAdId || "").trim() === String(adId || leadData?.adId || "").trim()
  );
  const leadEventId = stableLeadEventId("meta-native", leadgenId);

  if ((campaign as any).folderId) {
    try {
      folder = await Folder.findOne({
        _id: (campaign as any).folderId,
        userEmail,
      }).lean();
    } catch {}
  }

  if (!folder) {
    const folderName = `FB: ${(campaign as any).campaignName}`;
    folder = await Folder.findOne({ userEmail, name: folderName }).lean();
    if (!folder) {
      folder = await Folder.create({
        name: folderName,
        userEmail,
        assignedDrips: [],
        aiFirstCallEnabled: true,
        aiContactEnabled: true,
        aiRealTimeOnly: true,
        aiScriptKey,
      });
    }

    if ((folder as any)?._id) {
      await FBLeadCampaign.updateOne(
        { _id: (campaign as any)._id, userEmail },
        { $set: { folderId: (folder as any)._id } }
      );
    }
  }

  if (folder && !(folder as any).aiScriptKey) {
    await Folder.updateOne({ _id: (folder as any)._id }, { $set: { aiScriptKey } });
    folder = await Folder.findOne({ _id: (folder as any)._id }).lean();
  }

  const entry = await FBLeadEntry.create({
    userId: (user as any)._id,
    userEmail,
    campaignId: (campaign as any)._id,
    firstName: leadData.firstName,
    lastName: leadData.lastName,
    email: leadData.email,
    phone: leadData.phone,
    leadType: (campaign as any).leadType,
    source: "facebook_meta_native",
    facebookLeadId: leadgenId,
    leadEventId,
    metaAdId: String(adId || leadData?.adId || ""),
    metaCreativeId: String(attributedAd?.metaCreativeId || ""),
    variantId: String(attributedAd?.variantId || ""),
    creativeFamily: String(attributedAd?.creativeFamily || ""),
    folderId: (folder as any)._id,
    importedToCrm: !dupCheck.isDuplicate,
    importedAt: dupCheck.isDuplicate ? undefined : new Date(),
  });

  if (dupCheck.isDuplicate) {
    console.info(`[processMetaLead] Duplicate CRM lead for ${leadgenId} — FBLeadEntry created, CRM lead skipped`);
    if (dupCheck.existingLeadId) {
      await FBLeadEntry.updateOne(
        { _id: (entry as any)._id },
        { $set: { crmLeadId: dupCheck.existingLeadId } }
      );
    }
    try {
      const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "https://www.covecrm.com").replace(/\/$/, "");
      const leadName = `${String(leadData.firstName || "").trim()} ${String(leadData.lastName || "").trim()}`.trim()
        || dupCheck.existingName
        || "Your lead";
      const emailResult = await sendRepeatOptInNotificationEmail({
        to: userEmail,
        leadName,
        leadPhone: leadData.phone,
        leadEmail: leadData.email,
        state: leadData.state,
        leadType: FB_LEAD_TYPE_TO_CRM[(campaign as any).leadType] ?? String((campaign as any).leadType || ""),
        campaignName: String((campaign as any).campaignName || ""),
        leadUrl: dupCheck.existingLeadId ? `${appUrl}/lead/${dupCheck.existingLeadId}` : undefined,
      });
      if (!emailResult.ok) {
        console.warn("[processMetaLead] repeat opt-in email failed (non-blocking):", emailResult.error);
      }
    } catch (emailErr: any) {
      console.warn("[processMetaLead] repeat opt-in email failed (non-blocking):", emailErr?.message);
    }
    await updateEventStatus(leadgenId, {
      processingStatus: "duplicate",
      processedAt: now,
      fbLeadEntryId: (entry as any)._id,
      ...(dupCheck.existingLeadId ? { crmLeadId: dupCheck.existingLeadId } : {}),
      lastError: "",
    });
    return;
  }

  const crmLeadType = FB_LEAD_TYPE_TO_CRM[(campaign as any).leadType] ?? "Final Expense";
  const normalizedPhone = String(leadData.phone || "").replace(/\D+/g, "");

  const rawFields = leadData.rawFieldData || [];

  // Match by explicit key first (set since form question fix), then fall back to normalized label
  function getRawField(key: string, labelFallback?: string): string {
    const byKey = rawFields.find((f: any) => String(f.name || "") === key);
    if (byKey) return String(byKey.values?.[0] || "").trim();
    if (labelFallback) {
      const normalized = labelFallback.toLowerCase().replace(/[\s_-]+/g, "_");
      const byLabel = rawFields.find((f: any) =>
        String(f.name || "").toLowerCase().replace(/[\s_-]+/g, "_") === normalized
      );
      if (byLabel) return String(byLabel.values?.[0] || "").trim();
    }
    return "";
  }

  const ageRaw = getRawField("age");
  const ageValue = ageRaw || null;

  const beneficiary = getRawField("beneficiary", "who_would_be_your_beneficiary");
  const coverageAmount = getRawField("coverage_amount", "what_coverage_amount_are_you_interested_in");
  const mortgageBalance = getRawField("mortgage_balance", "what_is_your_mortgage_balance");
  const militaryBranch = getRawField("military_branch", "what_military_branch_did_you_serve_in");
  const cdlStatus = getRawField("cdl_driver_status", "are_you_currently_an_active_cdl_driver");
  const iulGoal = getRawField("iul_goal", "are_you_looking_for_protection_cash_value_growth_or_both");
  const bestCallTime = getRawField("best_call_time", "best_time_for_a_licensed_agent_to_call");

  const coverageAmountFinal = coverageAmount || mortgageBalance || "";
  const nativeAnswers = Object.fromEntries(
    rawFields.map((field: any) => [
      String(field?.name || ""),
      Array.isArray(field?.values) ? field.values : field?.values?.[0],
    ])
  );
  const structuredLeadFields = buildStructuredLeadFields({
    answers: {
      ...nativeAnswers,
      ...(leadData.city ? { city: leadData.city } : {}),
      ...(leadData.zip ? { zip: leadData.zip } : {}),
      ...(leadData.productInterest ? { productInterest: leadData.productInterest } : {}),
      ...(militaryBranch ? { militaryBranch } : {}),
      ...(cdlStatus ? { cdlStatus } : {}),
      ...(iulGoal ? { iulGoal } : {}),
      ...(bestCallTime ? { bestTime: bestCallTime } : {}),
    },
    selectedOption: coverageAmountFinal,
    leadType: (campaign as any).leadType,
  });

  const newLead = await Lead.create({
    "First Name": leadData.firstName,
    "Last Name": leadData.lastName,
    Email: leadData.email,
    email: leadData.email,
    Phone: leadData.phone,
    phoneLast10: normalizedPhone.slice(-10),
    normalizedPhone: normalizedPhone.slice(-10),
    State: leadData.state || "",
    Notes: "",
    Age: ageValue || undefined,
    ...structuredLeadFields,
    Beneficiary: structuredLeadFields.Beneficiary || beneficiary || undefined,
    "Coverage Amount": structuredLeadFields["Requested Coverage"] || undefined,
    userEmail,
    ownerEmail: userEmail,
    folderId: (folder as any)._id,
    leadType: crmLeadType,
    leadSource: "facebook_meta_native",
    status: "New",
    metaLeadgenId: leadgenId,
    metaFormId: formId || leadData.formId,
    metaAdId: adId || leadData.adId,
    metaCreativeId: String(attributedAd?.metaCreativeId || ""),
    metaVariantId: String(attributedAd?.variantId || ""),
    metaCreativeFamily: String(attributedAd?.creativeFamily || ""),
    metaLeadEventId: leadEventId,
    metaAdsetId: adsetId || leadData.adsetId,
    metaCampaignId: metaCampaignId || leadData.campaignId,
    metaPageId: pageId || leadData.pageId,
    metaCreatedTime: createdTime
      ? new Date(typeof createdTime === "number" ? createdTime * 1000 : createdTime)
      : new Date(),
    metaRawPayload: JSON.stringify(leadData.rawPayload),
    sourceType: "facebook_lead",
    realTimeEligible: true,
  });

  await FBLeadEntry.updateOne(
    { _id: (entry as any)._id },
    { $set: { crmLeadId: (newLead as any)._id, importedToCrm: true, importedAt: new Date() } }
  );

  try {
    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "https://www.covecrm.com").replace(/\/$/, "");
    const leadName = `${String(leadData.firstName || "").trim()} ${String(leadData.lastName || "").trim()}`.trim() || "New lead";
    const emailResult = await sendNewLeadNotificationEmail({
      to: userEmail,
      leadName,
      leadPhone: leadData.phone,
      leadEmail: leadData.email,
      state: leadData.state,
      age: String(ageValue || ""),
      leadType: crmLeadType,
      campaignName: String((campaign as any).campaignName || ""),
      details: structuredLeadFields,
      leadUrl: `${appUrl}/lead/${String((newLead as any)._id)}`,
    });
    if (!emailResult.ok) {
      console.warn("[processMetaLead] new lead email failed (non-blocking):", emailResult.error);
    }
  } catch (emailErr: any) {
    console.warn("[processMetaLead] new lead email failed (non-blocking):", emailErr?.message);
  }

  // Mark event fully processed with CRM lead reference
  await updateEventStatus(leadgenId, {
    processingStatus: "processed",
    processedAt: now,
    crmLeadId: (newLead as any)._id,
    fbLeadEntryId: (entry as any)._id,
    lastError: "",
    nextRetryAt: null,
  });

  try {
    await scoreLeadOnArrival(String((newLead as any)._id), "facebook_realtime");
  } catch (err: any) {
    console.warn("[processMetaLead] scoreLeadOnArrival failed (non-blocking):", err?.message);
  }
  await enqueueMetaLifecycleEventSafely({
    userEmail,
    leadId: String((newLead as any)._id),
    leadEventId,
    eventName: "LeadAccepted",
    email: leadData.email,
    phone: leadData.phone,
    metaCampaignId: String(metaCampaignId || leadData.campaignId || ""),
    metaAdId: String(adId || leadData.adId || ""),
    metaCreativeId: String(attributedAd?.metaCreativeId || ""),
    creativeFamily: String(attributedAd?.creativeFamily || ""),
  }, undefined, (error) => console.warn("[processMetaLead] CAPI queue failed (non-blocking):", error?.message));

  try {
    if (leadData.phone && (folder as any)?._id) {
      triggerAIFirstCall(
        String((newLead as any)._id),
        String((folder as any)._id),
        userEmail
      ).catch(() => {});
    }
  } catch {}

  try {
    await enrollOnNewLeadIfWatched({
      userEmail,
      folderId: String((folder as any)._id),
      leadId: String((newLead as any)._id),
      startMode: "now",
      source: "manual-lead",
    });
  } catch (enrollErr: any) {
    console.warn("[processMetaLead] enrollOnNewLeadIfWatched failed (non-blocking):", enrollErr?.message);
  }

  try {
    await User.updateOne({ _id: (user as any)._id }, { $set: { metaLastWebhookAt: new Date() } });
  } catch {}

  console.info(
    `[processMetaLead] Meta lead ${leadgenId} created as Lead ${(newLead as any)._id} for user ${userEmail}`
  );
}
