// pages/api/facebook/funnel-submit.ts
//
// POST — receives lead form submissions from the auto-hosted funnel page at /f/[id].
// Creates a CRM lead record tied to the campaign's CRM folder.
// No auth required (public endpoint — the funnel page is public).
//
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import mongooseConnect from "@/lib/mongooseConnect";
import FunnelOTPSession from "@/models/FunnelOTPSession";
import FunnelSubmission from "@/models/FunnelSubmission";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FBLeadEntry from "@/models/FBLeadEntry";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import SmsConsentEvidence from "@/models/SmsConsentEvidence";
import { classifySubmissionState } from "@/lib/leads/submissionStatePolicy";
import { buildLeadSheetPayload } from "@/lib/facebook/sheets/mapLeadToSheetRow";
import { triggerAIFirstCall } from "@/lib/ai/triggerAIFirstCall";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";
import { resolveHostedAttribution, stableLeadEventId } from "@/lib/facebook/hostedAttribution";
import { buildHostedConsentEvidence, requestIp } from "@/lib/facebook/hostedConsent";
import { scoreHostedLeadOnArrival } from "@/lib/facebook/hostedLeadScoring";
import { enqueueMetaLifecycleEventSafely } from "@/lib/meta/capi";
import { buildStructuredLeadFields } from "@/lib/leads/structuredLeadFields";
import { sendNewLeadNotificationEmail, sendRepeatOptInNotificationEmail } from "@/lib/email";
import {
  buildAccountWideContactFilter,
  contactMatches,
  normalizeContactEmail,
} from "@/lib/leads/accountWideContactMatch";

const LEAD_TYPE_MAP: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Trucker",
};

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
    smsConsentGiven,
    attributionToken,
    fbclid,
    fbc,
    fbp,
    utm,
    submissionEventId,
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
    smsConsentGiven?: boolean;
    attributionToken?: string;
    fbclid?: string;
    fbc?: string;
    fbp?: string;
    utm?: Record<string, string>;
    submissionEventId?: string;
  };

  if (!campaignId) return res.status(400).json({ error: "campaignId is required" });
  if (!phone && !email) return res.status(400).json({ error: "phone or email is required" });

  let claimedSubmissionId = "";
  try {
    await mongooseConnect();

    // Load campaign to get userEmail + folderId for routing
    const campaign = await (FBLeadCampaign as any).findOne({
      _id: campaignId,
    })
      .select("userId userEmail folderId campaignName leadType audienceSegment campaignType webhookKey metaCampaignId metaAdsetId ads licensedStates borderStateBehavior appsScriptUrl writeLeadsToSheet funnelVersion publicAgentProfile complianceProfile")
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
    const { normalizedState, outsideLicensedArea } = classifySubmissionState({
      state: answerMap.state || state,
      licensedStates: campaign.licensedStates,
    });

    const userEmail = String(campaign.userEmail || "").toLowerCase();
    if (!userEmail) {
      return res.status(400).json({ error: "Campaign has no owner" });
    }

    let attribution = {
      metaAdId: "",
      metaCreativeId: "",
      variantId: "",
      creativeFamily: "",
    };
    if (attributionToken) {
      try {
        attribution = resolveHostedAttribution({
          token: attributionToken,
          campaignId: campaign._id,
          ads: Array.isArray(campaign.ads) ? campaign.ads : [],
        });
      } catch (error: any) {
        return res.status(400).json({ error: error?.message || "Invalid hosted-funnel attribution" });
      }
    }

    const complianceOnly = campaign.funnelVersion === "a2p-compliance-stub";
    if (!complianceOnly && smsConsentGiven !== true) {
      return res.status(400).json({ error: "SMS and telephone contact consent is required for this funnel." });
    }
    const ipAddress = requestIp(req.headers as Record<string, any>, req.socket?.remoteAddress || "");
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 1000);
    const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "https://www.covecrm.com").replace(/\/$/, "");
    const rawSubmissionEventId = String(submissionEventId || crypto.randomUUID()).trim();
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(rawSubmissionEventId)) {
      return res.status(400).json({ error: "Invalid submission event ID" });
    }
    const leadEventId = stableLeadEventId("hosted", rawSubmissionEventId);
    const preferredLanguage = campaign.audienceSegment === "spanish" ? "Spanish" : "English";
    const safeUtm = Object.fromEntries(
      Object.entries(utm && typeof utm === "object" ? utm : {})
        .slice(0, 10)
        .map(([key, value]) => [String(key).slice(0, 40), String(value || "").slice(0, 300)])
    );

    const previousDelivery = await FunnelSubmission.findOne({
      userEmail,
      submissionEventId: rawSubmissionEventId,
    }).select("_id processingStatus createdLeadId wasDuplicate").lean() as any;
    if (previousDelivery && previousDelivery.processingStatus !== "failed") {
      return res.status(previousDelivery.processingStatus === "received" ? 202 : 200).json({
        ok: true,
        infrastructureDuplicate: true,
        duplicate: !!previousDelivery.wasDuplicate,
        leadId: previousDelivery.createdLeadId ? String(previousDelivery.createdLeadId) : undefined,
        eventId: leadEventId,
      });
    }
    const consentEvidence = buildHostedConsentEvidence({
      userId: campaign.userId,
      userEmail,
      firstName,
      lastName,
      phone,
      email,
      consentGiven: smsConsentGiven === true,
      agentName: campaign.publicAgentProfile?.displayName,
      businessName: campaign.publicAgentProfile?.businessName,
      leadType: campaign.leadType,
      audienceSegment: campaign.audienceSegment,
      complianceOnly,
      pageUrl: `${appUrl}/f/${campaign._id}`,
      privacyUrl: String(campaign.complianceProfile?.privacyUrl || `${appUrl}/legal/privacy`),
      termsUrl: String(campaign.complianceProfile?.termsUrl || `${appUrl}/legal/terms`),
      ip: ipAddress,
      userAgent,
      submittedAt: new Date(),
    });

    if (complianceOnly) {
      await Promise.all([
        SmsConsentEvidence.create(consentEvidence),
        FunnelSubmission.create({
          campaignId: campaign._id,
          userId: campaign.userId,
          userEmail,
          leadType: campaign.leadType,
          firstName: consentEvidence.firstName,
          lastName: consentEvidence.lastName,
          phone: consentEvidence.phone,
          email: consentEvidence.email,
          state: String(state || ""),
          rawPayload: req.body,
          submissionEventId: rawSubmissionEventId,
          preferredLanguage,
          wasDuplicate: false,
          processingStatus: "processed",
          ipAddress,
          userAgent,
        }),
      ]);
      return res.status(200).json({ ok: true, complianceOnly: true } as any);
    }

    let otpSessionIdToConsume: string | undefined;
    if (campaign.campaignType === "hosted_funnel_otp") {
      const verifiedToken = (req.body as any).verifiedToken;
      if (!verifiedToken) return res.status(400).json({ error: "Phone verification required." });
      try {
        const secret = process.env.WEBHOOK_SECRET || process.env.NEXTAUTH_SECRET || "fallback";
        const decoded = Buffer.from(String(verifiedToken), "base64").toString("utf8");
        const parts = decoded.split(":");
        if (parts.length !== 4) throw new Error("Invalid token format");
        const [tokenCampaignId, tokenPhone, tokenSessionId, tokenSig] = parts;
        otpSessionIdToConsume = tokenSessionId;
        const payload = `${tokenCampaignId}:${tokenPhone}:${tokenSessionId}`;
        const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
        if (tokenSig !== expectedSig) throw new Error("Invalid signature");
        if (tokenCampaignId !== String(campaignId)) throw new Error("Campaign mismatch");
        const otpSession = await FunnelOTPSession.findOne({
          _id: tokenSessionId,
          campaignId: tokenCampaignId,
          verified: true,
        }).lean();
        if (!otpSession) throw new Error("Session not verified");
        const rawPhoneCheck = String(phone || "").trim();
        const phoneLast10Check = rawPhoneCheck.replace(/\D/g, "").slice(-10);
        if (tokenPhone !== phoneLast10Check) throw new Error("Phone mismatch");
      } catch {
        return res.status(400).json({ error: "Phone verification failed. Please verify your phone number again." });
      }
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
    const normalizedEmail = normalizeContactEmail(email);
    const accountWideFilter = buildAccountWideContactFilter(userEmail, phone, email);
    const duplicateCandidates = accountWideFilter
      ? await Lead.find(accountWideFilter)
          .select("_id Phone email Email")
          .lean()
      : [];
    const duplicateLead = duplicateCandidates.find((existing: any) => contactMatches(existing, phone, email));

    let rawSubmission: any = null;
    if (previousDelivery) {
      rawSubmission = await FunnelSubmission.findOneAndUpdate(
          { _id: previousDelivery._id, processingStatus: "failed" },
          { $set: { processingStatus: "received" } },
          { new: true }
        );
    } else {
      try {
        rawSubmission = await FunnelSubmission.create({
          campaignId: campaign._id,
          userId: campaign.userId,
          userEmail,
          leadType: campaign.leadType,
          submissionEventId: rawSubmissionEventId,
          preferredLanguage,
          firstName: String(firstName || "").trim(),
          lastName: String(lastName || "").trim(),
          phone: String(phone || "").trim(),
          email: normalizedEmail,
          state: String(state || "").trim(),
          rawPayload: req.body,
          wasDuplicate: !!duplicateLead,
          processingStatus: "received",
          metaCampaignId: String(campaign.metaCampaignId || ""),
          metaAdsetId: String(campaign.metaAdsetId || ""),
          metaAdId: attribution.metaAdId,
          metaCreativeId: attribution.metaCreativeId,
          variantId: attribution.variantId,
          creativeFamily: attribution.creativeFamily,
          fbclid: String(fbclid || "").slice(0, 500),
          fbc: String(fbc || "").slice(0, 500),
          fbp: String(fbp || "").slice(0, 500),
          utm: safeUtm,
          ipAddress,
          userAgent,
        });
      } catch (createError: any) {
        if (createError?.code === 11000) {
          return res.status(202).json({ ok: true, infrastructureDuplicate: true, eventId: leadEventId });
        }
        throw createError;
      }
    }
    if (!rawSubmission) {
      return res.status(202).json({ ok: true, infrastructureDuplicate: true, eventId: leadEventId });
    }
    claimedSubmissionId = String((rawSubmission as any)._id);
    await SmsConsentEvidence.create(consentEvidence);

    if (duplicateLead) {
      if (preferredLanguage === "Spanish") {
        await Lead.updateOne(
          { _id: (duplicateLead as any)._id, userEmail },
          { $set: { preferredLanguage: "Spanish" } }
        ).catch(() => {});
      }
      await FunnelSubmission.updateOne(
        { _id: (rawSubmission as any)._id },
        { $set: { createdLeadId: (duplicateLead as any)._id, processingStatus: "repeat_opt_in" } }
      );
      try {
        const leadName = `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim() || "Your lead";
        const emailResult = await sendRepeatOptInNotificationEmail({
          to: userEmail,
          leadName,
          leadPhone: String(phone || "").trim(),
          leadEmail: normalizedEmail,
          state: normalizedState || String(state || "").trim(),
          leadType: normalizedLeadType,
          campaignName: String(campaign.campaignName || ""),
          leadUrl: `${appUrl}/lead/${String((duplicateLead as any)._id)}`,
        });
        if (!emailResult.ok) {
          console.warn("[funnel-submit] repeat opt-in email failed (non-blocking):", emailResult.error);
        }
      } catch (emailErr: any) {
        console.warn("[funnel-submit] repeat opt-in email failed (non-blocking):", emailErr?.message);
      }
      await enqueueMetaLifecycleEventSafely({
        userEmail,
        leadId: String((duplicateLead as any)._id),
        leadEventId,
        deduplicationEventId: leadEventId,
        eventName: "Lead",
        email: String(email || ""),
        phone: String(phone || ""),
        fbc: String(fbc || ""),
        fbp: String(fbp || ""),
        eventSourceUrl: consentEvidence.pageUrl,
        clientIpAddress: ipAddress,
        clientUserAgent: userAgent,
        metaCampaignId: String(campaign.metaCampaignId || ""),
        metaAdId: attribution.metaAdId,
        metaCreativeId: attribution.metaCreativeId,
        creativeFamily: attribution.creativeFamily,
      }, undefined, (error) => console.warn("[funnel-submit] CAPI queue failed (non-blocking):", error?.message));
      return res.status(200).json({
        ok: true,
        duplicate: true,
        leadId: String((duplicateLead as any)._id),
        eventId: leadEventId,
      });
    }

    const structuredLeadFields = buildStructuredLeadFields({
      answers: answerMap,
      selectedOption,
      leadType: campaign.leadType,
    });

    const rawPhone = String(phone || "").trim();
    const phoneLast10 = rawPhone.replace(/\D+/g, "").slice(-10);
    const lead = await Lead.create({
      "First Name": String(firstName || "").trim(),
      "Last Name": String(lastName || "").trim(),
      Email: String(email || "").trim(),
      email: String(email || "").trim().toLowerCase(),
      Phone: rawPhone,
      phoneLast10,
      normalizedPhone: phoneLast10,
      State: String(state || "").trim(),
      Age: String(age || "").trim(),
      ...structuredLeadFields,
      "Coverage Amount": structuredLeadFields["Requested Coverage"] || undefined,
      Notes: "",
      userEmail,
      ownerEmail: userEmail,
      folderId,
      status: "New",
      assignedDrips: [],
      campaignId: campaign._id,
      metaCampaignId: campaign.metaCampaignId || "",
      metaAdsetId: campaign.metaAdsetId || "",
      metaAdId: attribution.metaAdId,
      metaCreativeId: attribution.metaCreativeId,
      metaVariantId: attribution.variantId,
      metaCreativeFamily: attribution.creativeFamily,
      metaLeadEventId: leadEventId,
      metaFbclid: String(fbclid || "").slice(0, 500),
      metaFbc: String(fbc || "").slice(0, 500),
      metaFbp: String(fbp || "").slice(0, 500),
      metaUtm: safeUtm,
      preferredLanguage,
      leadType: normalizedLeadType,
      leadSource: "facebook_funnel",
      sourceType: "facebook_funnel",
      realTimeEligible: true,
      stateRestrictionWarning: !!(outsideLicensedArea || stateRestrictionWarning),
      stateOutsidePrimaryLicensedArea: !!(outsideLicensedArea || stateOutsidePrimaryLicensedArea),
    });
    await FunnelSubmission.updateOne(
      { _id: (rawSubmission as any)._id, createdLeadId: null },
      { $set: { createdLeadId: (lead as any)._id, processingStatus: "processed" } }
    );

    try {
      const leadName = `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim() || "New lead";
      const emailResult = await sendNewLeadNotificationEmail({
        to: userEmail,
        leadName,
        leadPhone: rawPhone,
        leadEmail: normalizedEmail,
        state: normalizedState || String(state || "").trim(),
        age: String(age || "").trim(),
        leadType: normalizedLeadType,
        campaignName: String(campaign.campaignName || ""),
        details: structuredLeadFields,
        leadUrl: `${appUrl}/lead/${String((lead as any)._id)}`,
      });
      if (!emailResult.ok) {
        console.warn("[funnel-submit] new lead email failed (non-blocking):", emailResult.error);
      }
    } catch (emailErr: any) {
      console.warn("[funnel-submit] new lead email failed (non-blocking):", emailErr?.message);
    }

    try {
      await scoreHostedLeadOnArrival(String((lead as any)._id));
    } catch (scoreErr: any) {
      console.warn("[funnel-submit] scoreLeadOnArrival failed (non-blocking):", scoreErr?.message);
    }
    await enqueueMetaLifecycleEventSafely({
      userEmail,
      leadId: String((lead as any)._id),
      leadEventId,
      deduplicationEventId: leadEventId,
      eventName: "Lead",
      email: String(email || ""),
      phone: rawPhone,
      fbc: String(fbc || ""),
      fbp: String(fbp || ""),
      eventSourceUrl: consentEvidence.pageUrl,
      clientIpAddress: ipAddress,
      clientUserAgent: userAgent,
      metaCampaignId: String(campaign.metaCampaignId || ""),
      metaAdId: attribution.metaAdId,
      metaCreativeId: attribution.metaCreativeId,
      creativeFamily: attribution.creativeFamily,
    }, undefined, (error) => console.warn("[funnel-submit] CAPI queue failed (non-blocking):", error?.message));

    if (campaign.campaignType === "hosted_funnel_otp" && otpSessionIdToConsume) {
      try { await FunnelOTPSession.deleteOne({ _id: otpSessionIdToConsume }); } catch {}
    }

    try {
      await FBLeadEntry.create({
        userId: campaign.userId,
        userEmail,
        campaignId: campaign._id,
        firstName: String(firstName || "").trim(),
        lastName: String(lastName || "").trim(),
        email: String(email || "").trim().toLowerCase(),
        phone: rawPhone,
        facebookLeadId: `funnel_${String((lead as any)._id)}`,
        leadEventId,
        preferredLanguage,
        crmLeadId: (lead as any)._id,
        folderId: folderId || undefined,
        importedToCrm: true,
        importedAt: new Date(),
        source: "hosted_funnel",
        leadType: campaign.leadType,
        metaAdId: attribution.metaAdId,
        metaCreativeId: attribution.metaCreativeId,
        variantId: attribution.variantId,
        creativeFamily: attribution.creativeFamily,
        fbclid: String(fbclid || "").slice(0, 500),
        fbc: String(fbc || "").slice(0, 500),
        fbp: String(fbp || "").slice(0, 500),
        utm: safeUtm,
      });
    } catch (fbEntryErr: any) {
      console.warn("[funnel-submit] FBLeadEntry create failed (non-fatal):", fbEntryErr?.message);
    }

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
          notes: "",
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

    try {
      if (phone && folderId) {
        triggerAIFirstCall(
          String((lead as any)._id),
          String(folderId),
          userEmail
        ).catch(() => {});
      }
    } catch {}

    try {
      await enrollOnNewLeadIfWatched({
        userEmail,
        folderId: String(folderId),
        leadId: String((lead as any)._id),
        startMode: "now",
        source: "manual-lead",
      });
    } catch (enrollErr: any) {
      console.warn("[funnel-submit] enrollOnNewLeadIfWatched failed (non-blocking):", enrollErr?.message);
    }

    return res.status(200).json({ ok: true, leadId: String(lead._id), eventId: leadEventId });
  } catch (err: any) {
    console.error("[funnel-submit] error:", err?.message);
    if (claimedSubmissionId) {
      await FunnelSubmission.updateOne(
        { _id: claimedSubmissionId, processingStatus: "received" },
        { $set: { processingStatus: "failed" } }
      ).catch(() => {});
    }
    return res.status(500).json({ error: "Failed to submit lead" });
  }
}
