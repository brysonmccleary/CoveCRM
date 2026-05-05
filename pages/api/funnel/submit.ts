
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Funnel from "@/models/Funnel";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FunnelSubmission from "@/models/FunnelSubmission";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { checkDuplicate } from "@/lib/leads/checkDuplicate";
import { scoreLeadOnArrival } from "@/lib/leads/scoreLead";
import { triggerAIFirstCall } from "@/lib/ai/triggerAIFirstCall";
import { getLeadTypeFolderName } from "@/lib/leadTypeConfig";
import { isStateAllowed, normalizeStateCode, stateLabel } from "@/lib/facebook/geo/usStates";
import { buildLeadSheetPayload } from "@/lib/facebook/sheets/mapLeadToSheetRow";

const LEAD_TYPE_TO_CRM: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Trucker",
};

function getIp(req: NextApiRequest): string {
  const xfwd = req.headers["x-forwarded-for"];
  if (Array.isArray(xfwd)) return xfwd[0] || "";
  if (typeof xfwd === "string") return xfwd.split(",")[0]?.trim() || "";
  return req.socket?.remoteAddress || "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    await mongooseConnect();

    const {
      slug,
      firstName = "",
      lastName = "",
      phone = "",
      email = "",
      state = "",
    } = req.body || {};

    const cleanSlug = String(slug || "").trim();
    const cleanFirst = String(firstName || "").trim();
    const cleanLast = String(lastName || "").trim();
    const cleanPhone = String(phone || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanState = String(state || "").trim();

    if (!cleanSlug) {
      return res.status(400).json({ error: "slug is required" });
    }

    if (!cleanFirst || !cleanPhone) {
      return res.status(400).json({ error: "firstName and phone are required" });
    }

    const funnel = await Funnel.findOne({ slug: cleanSlug, isActive: true }).lean();
    if (!funnel) {
      return res.status(404).json({ error: "Funnel not found" });
    }

    const userEmail = String((funnel as any).userEmail || "").toLowerCase();
    const userId = (funnel as any).userId;
    const campaignId = (funnel as any).campaignId || null;
    const leadType = String((funnel as any).leadType || "final_expense");
    let folderId = (funnel as any).folderId || null;
    let campaign: any = null;

    if (campaignId) {
      campaign = await (FBLeadCampaign as any).findOne({
        _id: campaignId,
      })
        .select("webhookKey metaCampaignId licensedStates borderStateBehavior appsScriptUrl writeLeadsToSheet")
        .lean() as any;

      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      if (!req.query.key || req.query.key !== campaign.webhookKey) {
        return res.status(403).json({ error: "Invalid webhook key" });
      }
      const normalizedState = normalizeStateCode(cleanState);
      const outsideLicensedArea =
        !!normalizedState &&
        Array.isArray(campaign.licensedStates) &&
        campaign.licensedStates.length > 0 &&
        !isStateAllowed(normalizedState, campaign.licensedStates);
      if (outsideLicensedArea && campaign.borderStateBehavior !== "allow_with_warning") {
        return res.status(403).json({ error: "We currently do not service your state for this campaign." });
      }
    }

    if (!userEmail || !userId) {
      return res.status(400).json({ error: "Funnel is missing owner information" });
    }

    // Ensure folder exists for this user
    if (!folderId) {
      const folderName = getLeadTypeFolderName(leadType);
      let folder = await Folder.findOne({ userEmail, name: folderName }).lean();
      if (!folder) {
        await Folder.create({ name: folderName, userEmail, assignedDrips: [] });
        folder = await Folder.findOne({ userEmail, name: folderName }).lean();
      }
      folderId = (folder as any)?._id || null;
    }

    const dupCheck = await checkDuplicate(userEmail, cleanPhone, cleanEmail);

    // Always log the raw submission so the agent retains what the prospect entered
    const submission = await FunnelSubmission.create({
      funnelId: (funnel as any)._id,
      campaignId,
      userId,
      userEmail,
      slug: cleanSlug,
      leadType,
      firstName: cleanFirst,
      lastName: cleanLast,
      phone: cleanPhone,
      email: cleanEmail,
      state: cleanState,
      rawPayload: req.body || {},
      wasDuplicate: !!dupCheck?.isDuplicate,
      ipAddress: getIp(req),
      userAgent: String(req.headers["user-agent"] || ""),
    });

    if (dupCheck?.isDuplicate) {
      return res.status(200).json({
        ok: true,
        duplicate: true,
        submissionId: submission._id,
        message: "Submission received.",
      });
    }

    const normalizedPhone = cleanPhone.replace(/\D+/g, "");
    const crmLeadType = LEAD_TYPE_TO_CRM[leadType] || "Final Expense";
    const normalizedState = normalizeStateCode(cleanState);
    const outsideLicensedArea =
      !!campaign &&
      !!normalizedState &&
      Array.isArray(campaign.licensedStates) &&
      campaign.licensedStates.length > 0 &&
      !isStateAllowed(normalizedState, campaign.licensedStates);
    const notes = outsideLicensedArea
      ? `State Restriction Warning: ${stateLabel(normalizedState)} is outside the campaign's primary licensed states.`
      : "";

    const newLead = await Lead.create({
      "First Name": cleanFirst,
      "Last Name": cleanLast,
      Email: cleanEmail,
      email: cleanEmail,
      Phone: cleanPhone,
      phoneLast10: normalizedPhone.slice(-10),
      normalizedPhone: normalizedPhone.slice(-10),
      State: cleanState,
      userEmail,
      ownerEmail: userEmail,
      folderId,
      leadType: crmLeadType,
      leadSource: "cove_landing_page",
      status: "New",
      sourceType: "landing_page",
      realTimeEligible: true,
      funnelId: (funnel as any)._id,
      campaignId: campaignId || null,
      metaCampaignId: campaign?.metaCampaignId || "",
      landingPageSlug: cleanSlug,
      Notes: notes,
      stateRestrictionWarning: outsideLicensedArea,
      stateOutsidePrimaryLicensedArea: outsideLicensedArea,
    });

    if (campaign?.writeLeadsToSheet && campaign?.appsScriptUrl) {
      try {
        const payload = buildLeadSheetPayload({
          leadType,
          campaignId: String(campaignId || ""),
          answers: { state: normalizedState || cleanState },
          firstName: cleanFirst,
          lastName: cleanLast,
          email: cleanEmail,
          phone: cleanPhone,
          notes,
          status: "New",
        });
        await fetch(String(campaign.appsScriptUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (sheetErr: any) {
        console.warn("[funnel/submit] sheet write failed:", sheetErr?.message);
      }
    }

    await FunnelSubmission.updateOne(
      { _id: (submission as any)._id },
      { $set: { createdLeadId: (newLead as any)._id } }
    );

    try {
      await scoreLeadOnArrival(String((newLead as any)._id), "facebook_realtime");
    } catch (err: any) {
      console.warn("[funnel/submit] scoreLeadOnArrival failed (non-blocking):", err?.message);
    }

    try {
      if (cleanPhone && folderId) {
        triggerAIFirstCall(
          String((newLead as any)._id),
          String(folderId),
          userEmail
        ).catch(() => {});
      }
    } catch {}

    return res.status(200).json({
      ok: true,
      duplicate: false,
      submissionId: submission._id,
      leadId: newLead._id,
      message: "Submission received.",
    });
  } catch (err: any) {
    console.error("[funnel/submit] error:", err?.message);
    return res.status(500).json({ error: "Failed to submit funnel lead" });
  }
}
