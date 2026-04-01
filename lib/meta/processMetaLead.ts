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

const FB_LEAD_TYPE_TO_CRM: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Trucker",
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
  let folder = await Folder.findOne({ userEmail, name: folderName }).lean();
  if (!folder) {
    await Folder.create({ name: folderName, userEmail, assignedDrips: [] });
    folder = await Folder.findOne({ userEmail, name: folderName }).lean();
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

  const newLead = await Lead.create({
    "First Name": leadData.firstName,
    "Last Name": leadData.lastName,
    Email: leadData.email,
    email: leadData.email,
    Phone: leadData.phone,
    phoneLast10: normalizedPhone.slice(-10),
    normalizedPhone: normalizedPhone.slice(-10),
    State: leadData.state || "",
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
    await User.updateOne({ _id: (user as any)._id }, { $set: { metaLastWebhookAt: new Date() } });
  } catch {}

  console.info(
    `[processMetaLead] Meta lead ${leadgenId} created as Lead ${(newLead as any)._id} for user ${userEmail}`
  );
}
