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

  // Mark as processing and increment attemptCount atomically.
  // $set and $inc must be siblings at the top level — not nested inside each other.
  let attemptCount = 1;
  try {
    await MetaLeadWebhookEvent.updateOne(
      { leadgenId },
      {
        $set: { processingStatus: "processing", lastAttemptAt: now },
        $inc: { attemptCount: 1 },
      }
    );
    const evt = await MetaLeadWebhookEvent.findOne({ leadgenId }).select("attemptCount").lean() as any;
    if (evt?.attemptCount) attemptCount = evt.attemptCount;
  } catch (err: any) {
    console.warn("[processMetaLead] Failed to mark event as processing:", err?.message);
  }

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

  const aiScriptKey = FB_LEAD_TYPE_TO_AI_SCRIPT_KEY[(campaign as any).leadType] || "final_expense";
  let folder: any = null;

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
    folderId: (folder as any)._id,
    importedToCrm: !dupCheck.isDuplicate,
    importedAt: dupCheck.isDuplicate ? undefined : new Date(),
  });

  if (dupCheck.isDuplicate) {
    console.info(`[processMetaLead] Duplicate CRM lead for ${leadgenId} — FBLeadEntry created, CRM lead skipped`);
    await updateEventStatus(leadgenId, {
      processingStatus: "duplicate",
      processedAt: now,
      fbLeadEntryId: (entry as any)._id,
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

  const contextualNotes = [
    militaryBranch ? `Military Branch: ${militaryBranch}` : "",
    cdlStatus ? `CDL Status: ${cdlStatus}` : "",
    iulGoal ? `IUL Goal: ${iulGoal}` : "",
    bestCallTime ? `Best Call Time: ${bestCallTime}` : "",
    leadData.productInterest ? `Interest: ${leadData.productInterest}` : "",
    leadData.zip ? `Zip: ${leadData.zip}` : "",
  ].filter(Boolean).join("\n");

  const newLead = await Lead.create({
    "First Name": leadData.firstName,
    "Last Name": leadData.lastName,
    Email: leadData.email,
    email: leadData.email,
    Phone: leadData.phone,
    phoneLast10: normalizedPhone.slice(-10),
    normalizedPhone: normalizedPhone.slice(-10),
    State: leadData.state || "",
    Notes: contextualNotes || undefined,
    Age: ageValue || undefined,
    Beneficiary: beneficiary || undefined,
    "Coverage Amount": coverageAmountFinal || undefined,
    userEmail,
    ownerEmail: userEmail,
    folderId: (folder as any)._id,
    leadType: crmLeadType,
    leadSource: "facebook_meta_native",
    status: "New",
    metaLeadgenId: leadgenId,
    metaFormId: formId || leadData.formId,
    metaAdId: adId || leadData.adId,
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
