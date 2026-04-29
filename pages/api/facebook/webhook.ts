// pages/api/facebook/webhook.ts
// Facebook Lead Ads webhook receiver
// GET  — verify token challenge (Facebook calls this on setup)
// POST — receive leadgen events, fetch lead from Graph API, store in CRM
import type { NextApiRequest, NextApiResponse } from "next";
import { createHmac, timingSafeEqual } from "crypto";
import axios from "axios";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadEntry from "@/models/FBLeadEntry";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import User from "@/models/User";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";
import { scoreLeadOnArrival } from "@/lib/leads/scoreLead";
import { trackLeadSourceStat } from "@/lib/leads/trackLeadSourceStat";
import { checkDuplicate } from "@/lib/leads/checkDuplicate";
import { triggerAIFirstCall } from "@/lib/ai/triggerAIFirstCall";
import { buildLeadSheetPayload } from "@/lib/facebook/sheets/mapLeadToSheetRow";

const FB_APP_SECRET = process.env.FB_APP_SECRET || "";

function validateFBSignature(rawBody: string, signatureHeader: string): boolean {
  if (!FB_APP_SECRET) return true; // dev/local: skip when not configured
  if (!signatureHeader) return false;
  const sig = signatureHeader.replace(/^sha256=/, "");
  const expected = createHmac("sha256", FB_APP_SECRET).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

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

async function fetchLeadFromGraph(
  leadgenId: string,
  accessToken: string
): Promise<Record<string, string>> {
  if (!accessToken) return {};
  try {
    const url = `https://graph.facebook.com/v18.0/${leadgenId}`;
    const res = await axios.get(url, {
      params: {
        fields: "field_data,created_time,ad_id,form_id",
        access_token: accessToken,
      },
      timeout: 8000,
    });
    const fieldData: { name: string; values: string[] }[] = res.data?.field_data ?? [];
    const map: Record<string, string> = {};
    for (const f of fieldData) {
      map[String(f.name).toLowerCase()] = String(f.values?.[0] ?? "");
    }
    return map;
  } catch (err: any) {
    console.warn("[fb-webhook] Graph API fetch failed:", err?.message);
    return {};
  }
}

async function writeToAppsScript(appsScriptUrl: string, payload: Record<string, string>): Promise<void> {
  try {
    await axios.post(appsScriptUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 8000,
    });
  } catch (err: any) {
    console.warn("[fb-webhook] Apps Script write failed:", err?.message);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ── GET: Verify webhook token ────────────────────────────────────────────
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.FB_WEBHOOK_VERIFY_TOKEN) {
      console.info("[fb-webhook] Verified webhook challenge");
      return res.status(200).send(challenge);
    }

    console.warn("[fb-webhook] Webhook verification failed", { mode, token });
    return res.status(403).send("Forbidden");
  }

  // ── POST: Receive lead events ────────────────────────────────────────────
  if (req.method === "POST") {
    const body = req.body;

    // HMAC-SHA256 signature validation (FB_APP_SECRET must be set in production)
    const signatureHeader = String(req.headers["x-hub-signature-256"] || "");
    const rawBodyStr = JSON.stringify(body);
    if (!validateFBSignature(rawBodyStr, signatureHeader)) {
      if (FB_APP_SECRET) {
        // Production: reject invalid signatures silently — return 200 so FB doesn't retry
        console.warn("[fb-webhook] Invalid X-Hub-Signature-256 — rejecting");
        return res.status(200).json({ ok: false, error: "invalid_signature" });
      }
      console.warn("[fb-webhook] Signature check skipped — FB_APP_SECRET not configured");
    }

    console.info("[fb-webhook] Received payload:", JSON.stringify(body).slice(0, 500));

    // Always return 200 quickly to Facebook
    res.status(200).json({ ok: true });

    try {
      await mongooseConnect();

      if (body?.object !== "page") return;

      for (const entry of body?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
          if (change?.field !== "leadgen") continue;

          const value = change.value;
          const fbLeadId = String(value?.leadgen_id ?? "");
          const pageId = String(value?.page_id ?? "");
          const formId = String(value?.form_id ?? "");
          const adId = String(value?.ad_id ?? "");

          if (!fbLeadId) continue;

          // Idempotent — skip already-processed leads
          const existing = await FBLeadEntry.findOne({ facebookLeadId: fbLeadId }).lean();
          if (existing) {
            console.info(`[fb-webhook] Lead ${fbLeadId} already exists, skipping`);
            continue;
          }

          const fieldMap: Record<string, string> = {};

          // Fall back to any field_data included directly in the payload
          for (const f of value?.field_data ?? []) {
            fieldMap[String(f.name).toLowerCase()] = String(f.values?.[0] ?? "");
          }

          // Find campaign: pageId → leadType match → isDefault → most recent active
          const userEmailFromQuery =
            typeof req.query.userEmail === "string" ? req.query.userEmail.toLowerCase() : "";

          let campaign =
            (formId
              ? await FBLeadCampaign.findOne({
                  metaFormId: formId,
                  status: { $in: ["active", "setup"] },
                }).lean()
              : null) ||
            (adId
              ? await FBLeadCampaign.findOne({
                  metaAdId: adId,
                  status: { $in: ["active", "setup"] },
                }).lean()
              : null) ||
            (value?.campaign_id
              ? await FBLeadCampaign.findOne({
                  metaCampaignId: String(value.campaign_id),
                  status: { $in: ["active", "setup"] },
                }).lean()
              : null) ||
            (pageId
              ? await FBLeadCampaign.findOne({
                  facebookPageId: pageId,
                  status: { $in: ["active", "setup"] },
                })
                  .sort({ createdAt: -1 })
                  .lean()
              : null);

          if (!campaign) {
            console.warn("[fb-webhook] No campaign match", {
              formId,
              adId,
              metaCampaignId: value?.campaign_id,
              pageId,
            });
          }

          if (!campaign && userEmailFromQuery) {
            // Try matching by lead_type from form data
            const leadTypeFromForm =
              fieldMap["lead_type"] ?? fieldMap["leadtype"] ?? fieldMap["insurance_type"] ?? "";

            if (leadTypeFromForm) {
              campaign = await FBLeadCampaign.findOne({
                userEmail: userEmailFromQuery,
                leadType: leadTypeFromForm,
                status: { $in: ["active", "setup"] },
              })
                .sort({ createdAt: -1 })
                .lean();
            }

            // Try isDefault campaign
            if (!campaign) {
              campaign = await FBLeadCampaign.findOne({
                userEmail: userEmailFromQuery,
                isDefault: true,
                status: { $in: ["active", "setup"] },
              }).lean();
            }

            // Fall back to most recently created active campaign
            if (!campaign) {
              campaign = await FBLeadCampaign.findOne({
                userEmail: userEmailFromQuery,
                status: { $in: ["active", "setup"] },
              })
                .sort({ createdAt: -1 })
                .lean();
            }
          }

          if (!campaign) {
            console.warn("[fb-webhook] No matching campaign for lead", { fbLeadId, pageId, adId });
            continue;
          }

          const user = await User.findOne({ _id: (campaign as any).userId })
            .select("_id metaAccessToken")
            .lean();
          if (!user) continue;

          const accessToken = String((user as any)?.metaAccessToken || "").trim();
          if (accessToken) {
            const graphFieldMap = await fetchLeadFromGraph(fbLeadId, accessToken);
            Object.assign(fieldMap, graphFieldMap);
            for (const f of value?.field_data ?? []) {
              fieldMap[String(f.name).toLowerCase()] = String(f.values?.[0] ?? "");
            }
          } else {
            console.warn("[fb-webhook] Missing access token, using payload only");
          }

          // Check active FB Lead Manager subscription
          const sub = await FBLeadSubscription.findOne({ userId: (user as any)._id }).lean();
          const hasActiveSub =
            sub &&
            sub.status === "active" &&
            sub.currentPeriodEnd != null &&
            new Date(sub.currentPeriodEnd) > new Date();

          if (!hasActiveSub) {
            console.info(`[fb-webhook] Webhook blocked: no active subscription for userId ${(user as any)._id}`);
            return res.status(200).json({ ok: true, blocked: true, reason: "no_active_subscription" });
          }

          const folderName = `FB: ${(campaign as any).campaignName}`;
          let folder: any = null;

          // First: try stored folderId for direct routing (faster, more reliable)
          if ((campaign as any).folderId) {
            folder = await Folder.findById((campaign as any).folderId).lean();
          }

          // Fallback: find or create by name convention
          if (!folder) {
            folder = await Folder.findOne({
              userEmail: (campaign as any).userEmail,
              name: folderName,
            }).lean();
            if (!folder) {
              folder = await Folder.create({
                name: folderName,
                userEmail: (campaign as any).userEmail,
                assignedDrips: [],
                aiFirstCallEnabled: true,
                aiContactEnabled: true,
                aiEnabledAt: new Date(),
                aiScriptKey:
                  FB_LEAD_TYPE_TO_AI_SCRIPT_KEY[(campaign as any).leadType] || "default",
              });
            }
          }

          const fullName =
            fieldMap["full_name"] ??
            `${fieldMap["first_name"] ?? ""} ${fieldMap["last_name"] ?? ""}`.trim();
          const email = (fieldMap["email"] ?? "").toLowerCase().trim();
          const phone = fieldMap["phone_number"] ?? fieldMap["phone"] ?? "";
          const city = fieldMap["city"] ?? "";
          const state = fieldMap["state"] ?? "";
          const zip = fieldMap["zip"] ?? fieldMap["postal_code"] ?? "";
          const birthdate = fieldMap["birthdate"] ?? fieldMap["date_of_birth"] ?? "";
          const homeowner = fieldMap["homeowner"] ?? "";
          const coverageAmount =
            fieldMap["coverage_amount"] ??
            fieldMap["coverage amount wanted ($5,000 – $25,000 / $25,000+)"] ??
            fieldMap["mortgage balance (approximate)"] ??
            fieldMap["current coverage amount (if any)"] ??
            "";

          const nameParts = fullName.split(/\s+/);
          const firstName = nameParts[0] ?? "";
          const lastName = nameParts.slice(1).join(" ");
          const normalizedPhone = phone.replace(/\D+/g, "");
          const crmLeadType = FB_LEAD_TYPE_TO_CRM[(campaign as any).leadType] ?? "Final Expense";
          const sheetAnswers = {
            ...fieldMap,
            city,
            state,
            zip,
            postalCode: zip,
            birthdate,
            dateOfBirth: birthdate,
            homeowner,
            coverage: coverageAmount,
            coverageAmount,
          };
          const sheetNotes = Object.entries(fieldMap)
            .filter(([, value]) => String(value || "").trim())
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n");

          // Duplicate check before creating CRM lead
          const dupCheck = await checkDuplicate(
            (campaign as any).userEmail,
            normalizedPhone,
            email
          );
          if (dupCheck.isDuplicate) {
            console.info(`[fb-webhook] Duplicate lead detected: ${dupCheck.existingLeadId} (${dupCheck.matchType})`);
            // Still create the FBLeadEntry for tracking, but don't create CRM lead
          }

          const entry = await FBLeadEntry.create({
            userId: (user as any)._id,
            userEmail: (campaign as any).userEmail,
            campaignId: (campaign as any)._id,
            firstName,
            lastName,
            email,
            phone,
            leadType: (campaign as any).leadType,
            source: "facebook_webhook",
            facebookLeadId: fbLeadId,
            folderId: folder._id,
            importedToCrm: true,
            importedAt: new Date(),
          });

          if (dupCheck.isDuplicate) {
            console.info(`[fb-webhook] Skipping CRM lead creation for duplicate`);
            continue;
          }

          const crmLead = await Lead.create({
            "First Name": firstName,
            "Last Name": lastName,
            Email: email,
            email,
            Phone: phone,
            phoneLast10: normalizedPhone.slice(-10),
            normalizedPhone,
            userEmail: (campaign as any).userEmail,
            folderId: folder._id,
            leadType: crmLeadType,
            status: "New",
            sourceType: "facebook_lead",
            realTimeEligible: true,
            campaignId: (campaign as any)._id,
            metaCampaignId: (campaign as any).metaCampaignId,
            metaAdsetId: (campaign as any).metaAdsetId,
            metaAdId: adId,
            metaFormId: formId,
          });

          await FBLeadEntry.updateOne({ _id: entry._id }, { $set: { crmLeadId: crmLead._id } });

          // Score lead and track source
          try {
            await scoreLeadOnArrival(String(crmLead._id), "facebook_realtime");
            await trackLeadSourceStat((campaign as any).userEmail, "facebook_realtime");
          } catch (scoreErr: any) {
            console.warn("[fb-webhook] Scoring error:", scoreErr?.message);
          }

          await enrollOnNewLeadIfWatched({
            userEmail: (campaign as any).userEmail,
            folderId: String(folder._id),
            leadId: String(crmLead._id),
            startMode: "now",
            source: "manual-lead",
          });

          // ✅ AI First-Call: fire-and-forget (non-blocking)
          try {
            triggerAIFirstCall(
              String(crmLead._id),
              String(folder._id),
              (campaign as any).userEmail
            ).catch(() => {});
          } catch {}

          await FBLeadCampaign.updateOne(
            { _id: (campaign as any)._id },
            { $inc: { totalLeads: 1 } }
          );

          // Mirror to the campaign's Google Sheet after CRM lead creation.
          const appsScriptUrl = String((campaign as any).appsScriptUrl || "").trim();
          if ((campaign as any).writeLeadsToSheet === true && appsScriptUrl) {
            const payload = buildLeadSheetPayload({
              leadType: (campaign as any).leadType,
              campaignId: String((campaign as any)._id),
              answers: sheetAnswers,
              firstName,
              lastName,
              email,
              phone,
              notes: sheetNotes,
              status: "New",
            });
            await writeToAppsScript(appsScriptUrl, payload);
          }

          console.info(`[fb-webhook] Imported lead ${fbLeadId} for ${(campaign as any).userEmail}`);
        }
      }
    } catch (err: any) {
      console.error("[fb-webhook] Error processing webhook:", err?.message);
    }
    return;
  }

  return res.status(405).json({ error: "Method not allowed" });
}
