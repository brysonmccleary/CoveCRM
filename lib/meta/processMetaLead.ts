// lib/meta/processMetaLead.ts
// Process an incoming Meta (Facebook native) lead webhook event

import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/lib/mongo/leads";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FBLeadEntry from "@/models/FBLeadEntry";
import FBLeadSubscription from "@/models/FBLeadSubscription";
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

  const existingLead = await Lead.findOne({ metaLeadgenId: leadgenId }).lean();
  if (existingLead) {
    console.info(`[processMetaLead] Duplicate Meta lead ${leadgenId} — skipping`);
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

  if (!campaign && pageId) {
    campaign = await FBLeadCampaign.findOne({
      facebookPageId: pageId,
      status: { $in: ["active", "setup"] },
    }).lean();
  }

  if (!campaign && pageId) {
    user = await User.findOne({ metaPageId: pageId }).lean();
    if (user) {
      campaign = await FBLeadCampaign.findOne({
        userEmail: (user as any).email,
        status: { $in: ["active", "setup"] },
      })
        .sort({ createdAt: -1 })
        .lean();
    }
  }

  if (!campaign) {
    console.warn(`[processMetaLead] No CoveCRM campaign/user found for pageId ${pageId}, metaCampaignId ${metaCampaignId}`);
    return;
  }

  const userEmail = (campaign as any).userEmail as string;

  if (!user) {
    user = await User.findOne({ email: userEmail }).lean();
  }
  if (!user) {
    console.warn(`[processMetaLead] User not found: ${userEmail}`);
    return;
  }

  let leadData: any;
  try {
    leadData = await retrieveMetaLead(leadgenId);
  } catch (err: any) {
    console.error(`[processMetaLead] Failed to retrieve lead ${leadgenId}:`, err?.message);
    return;
  }

  const sub = await FBLeadSubscription.findOne({
    userEmail,
    status: "active",
  }).lean();
  if (!sub) {
    console.info(`[processMetaLead] No active subscription for ${userEmail} — Meta lead blocked`);
    return;
  }

  const dupCheck = await checkDuplicate(
    userEmail,
    leadData.phone,
    leadData.email
  );

  const folderName = `FB: ${(campaign as any).campaignName}`;
  const aiScriptKey = FB_LEAD_TYPE_TO_AI_SCRIPT_KEY[(campaign as any).leadType] || "final_expense";
  let folder: any = await Folder.findOne({ userEmail, name: folderName }).lean();
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
  } else if (!(folder as any).aiScriptKey) {
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
    return;
  }

  const crmLeadType = FB_LEAD_TYPE_TO_CRM[(campaign as any).leadType] ?? "Final Expense";
  const normalizedPhone = String(leadData.phone || "").replace(/\D+/g, "");

  const rawFields = leadData.rawFieldData || [];

  function getRawField(label: string): string {
    const normalized = label.toLowerCase().replace(/[\s_-]+/g, "_");
    const found = rawFields.find((f: any) =>
      String(f.name || "").toLowerCase().replace(/[\s_-]+/g, "_") === normalized
    );
    return String(found?.values?.[0] || "").trim();
  }

  const ageRaw = getRawField("age");
  const ageValue = ageRaw || null;

  const beneficiary = getRawField("who_would_be_your_beneficiary");
  const coverageAmount = getRawField("what_coverage_amount_are_you_interested_in");
  const mortgageBalance = getRawField("what_is_your_mortgage_balance");
  const militaryBranch = getRawField("what_military_branch_did_you_serve_in");
  const cdlStatus = getRawField("are_you_currently_an_active_cdl_driver");
  const iulGoal = getRawField("are_you_looking_for_protection_cash_value_growth_or_both");
  const bestCallTime = getRawField("best_time_for_a_licensed_agent_to_call");

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
