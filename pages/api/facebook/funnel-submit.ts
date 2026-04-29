// pages/api/facebook/funnel-submit.ts
//
// POST — receives lead form submissions from the auto-hosted funnel page at /f/[id].
// Creates a CRM lead record tied to the campaign's CRM folder.
// No auth required (public endpoint — the funnel page is public).
//
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { isStateAllowed, normalizeStateCode, stateLabel } from "@/lib/facebook/geo/usStates";
import { buildLeadSheetPayload } from "@/lib/facebook/sheets/mapLeadToSheetRow";

const LEAD_TYPE_MAP: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Trucker",
};

function normalizePhoneForDedupe(value?: string) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeEmailForDedupe(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phoneDedupeRegex(normalizedPhone: string) {
  return new RegExp(normalizedPhone.split("").join("\\D*"));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    campaignId,
    firstName,
    lastName,
    phone,
    email,
    age,
    state,
    selectedOption,
    answers,
    stateRestrictionWarning,
    stateOutsidePrimaryLicensedArea,
  } = req.body as {
    campaignId?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    age?: string;
    state?: string;
    selectedOption?: string; // age band or coverage amount the user tapped
    answers?: Record<string, any>;
    stateRestrictionWarning?: boolean;
    stateOutsidePrimaryLicensedArea?: boolean;
  };

  if (!campaignId) return res.status(400).json({ error: "campaignId is required" });
  if (!phone && !email) return res.status(400).json({ error: "phone or email is required" });

  try {
    await mongooseConnect();

    // Load campaign to get userEmail + folderId for routing
    const campaign = await (FBLeadCampaign as any).findOne({
      _id: campaignId,
    })
      .select("userEmail folderId campaignName leadType webhookKey metaCampaignId licensedStates borderStateBehavior appsScriptUrl writeLeadsToSheet")
      .lean() as any;

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    if (!req.query.key || req.query.key !== campaign.webhookKey) {
      return res.status(403).json({ error: "Invalid webhook key" });
    }
    const answerMap = {
      ...(answers && typeof answers === "object" ? answers : {}),
      ...(age ? { age } : {}),
      ...(state ? { state } : {}),
      ...(selectedOption ? { selectedOption } : {}),
    };
    const normalizedState = normalizeStateCode(answerMap.state || state);
    const outsideLicensedArea =
      !!normalizedState &&
      Array.isArray(campaign.licensedStates) &&
      campaign.licensedStates.length > 0 &&
      !isStateAllowed(normalizedState, campaign.licensedStates);
    if (outsideLicensedArea && campaign.borderStateBehavior !== "allow_with_warning") {
      return res.status(403).json({ error: "We currently do not service your state for this campaign." });
    }

    const userEmail = String(campaign.userEmail || "").toLowerCase();
    if (!userEmail) {
      return res.status(400).json({ error: "Campaign has no owner" });
    }

    // Ensure the CRM folder exists
    let folderId = campaign.folderId;
    if (!folderId) {
      const folderName = `FB: ${campaign.campaignName}`;
      let folder = await Folder.findOne({ userEmail, name: folderName }).lean() as any;
      if (!folder) {
        folder = await Folder.create({ name: folderName, userEmail, createdAt: new Date() });
      }
      folderId = folder._id;
    }
    const normalizedLeadType =
      LEAD_TYPE_MAP[campaign.leadType] || campaign.leadType;
    const normalizedPhone = normalizePhoneForDedupe(phone);
    const normalizedEmail = normalizeEmailForDedupe(email);
    const duplicateMatchers: Record<string, any>[] = [];
    if (normalizedPhone) {
      duplicateMatchers.push({ Phone: { $regex: phoneDedupeRegex(normalizedPhone) } });
    }
    if (normalizedEmail) {
      duplicateMatchers.push(
        { email: normalizedEmail },
        { Email: { $regex: new RegExp(`^${escapeRegExp(normalizedEmail)}$`, "i") } }
      );
    }

    const duplicateCandidates = duplicateMatchers.length
      ? await Lead.find({
          userEmail,
          folderId,
          $or: duplicateMatchers,
        })
          .select("_id Phone email Email")
          .lean()
      : [];
    const duplicateLead = duplicateCandidates.find((existing: any) => {
      const existingPhone = normalizePhoneForDedupe(existing?.Phone);
      const existingEmail = normalizeEmailForDedupe(existing?.email || existing?.Email);
      return (
        (normalizedPhone && existingPhone === normalizedPhone) ||
        (normalizedEmail && existingEmail === normalizedEmail)
      );
    });

    if (duplicateLead) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
      });
    }

    // Notes field: capture which option they selected (age band or coverage amount)
    const notesLines: string[] = [];
    if (selectedOption) notesLines.push(`Selected: ${selectedOption}`);
    if (normalizedLeadType) notesLines.push(`Lead Type: ${normalizedLeadType}`);
    if (outsideLicensedArea || stateRestrictionWarning || stateOutsidePrimaryLicensedArea) {
      notesLines.push(`State Restriction Warning: ${stateLabel(normalizedState)} is outside the campaign's primary licensed states.`);
    }
    for (const [key, value] of Object.entries(answerMap)) {
      if (value !== undefined && value !== null && String(value).trim()) {
        notesLines.push(`${key}: ${String(value)}`);
      }
    }
    notesLines.push(`Source: CoveCRM hosted funnel — ${campaign.campaignName}`);

    const lead = await Lead.create({
      "First Name": String(firstName || "").trim(),
      "Last Name": String(lastName || "").trim(),
      Email: String(email || "").trim(),
      email: String(email || "").trim().toLowerCase(),
      Phone: String(phone || "").trim(),
      State: String(state || "").trim(),
      Age: String(age || "").trim(),
      Notes: notesLines.join("\n"),
      userEmail,
      folderId,
      status: "New",
      assignedDrips: [],
      campaignId: campaign._id,
      metaCampaignId: campaign.metaCampaignId || "",
      leadType: normalizedLeadType,
      sourceType: "facebook_funnel",
      stateRestrictionWarning: !!(outsideLicensedArea || stateRestrictionWarning),
      stateOutsidePrimaryLicensedArea: !!(outsideLicensedArea || stateOutsidePrimaryLicensedArea),
    });

    if (campaign.writeLeadsToSheet && campaign.appsScriptUrl) {
      try {
        const payload = buildLeadSheetPayload({
          leadType: campaign.leadType,
          campaignId: String(campaign._id),
          answers: answerMap,
          firstName: String(firstName || "").trim(),
          lastName: String(lastName || "").trim(),
          email: String(email || "").trim().toLowerCase(),
          phone: String(phone || "").trim(),
          notes: notesLines.join("\n"),
          status: "New",
        });
        await fetch(String(campaign.appsScriptUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (sheetErr: any) {
        console.warn("[funnel-submit] sheet write failed:", sheetErr?.message);
      }
    }

    return res.status(200).json({ ok: true, leadId: String(lead._id) });
  } catch (err: any) {
    console.error("[funnel-submit] error:", err?.message);
    return res.status(500).json({ error: "Failed to submit lead" });
  }
}
