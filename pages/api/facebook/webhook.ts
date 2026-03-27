// pages/api/facebook/webhook.ts
// Facebook Lead Ads webhook receiver
// GET  — verify token challenge (Facebook calls this on setup)
// POST — receive leadgen events, fetch lead from Graph API, store in CRM
import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadEntry from "@/models/FBLeadEntry";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import User from "@/models/User";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";

const FB_LEAD_TYPE_TO_CRM: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Final Expense",
};

async function fetchLeadFromGraph(leadgenId: string): Promise<Record<string, string>> {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return {};
  try {
    const url = `https://graph.facebook.com/v18.0/${leadgenId}`;
    const res = await axios.get(url, {
      params: {
        fields: "field_data,created_time,ad_id,form_id",
        access_token: token,
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

          // Fetch full lead details from Graph API
          const fieldMap = await fetchLeadFromGraph(fbLeadId);

          // Fall back to any field_data included directly in the payload
          for (const f of value?.field_data ?? []) {
            fieldMap[String(f.name).toLowerCase()] = String(f.values?.[0] ?? "");
          }

          const fullName =
            fieldMap["full_name"] ??
            `${fieldMap["first_name"] ?? ""} ${fieldMap["last_name"] ?? ""}`.trim();
          const email = (fieldMap["email"] ?? "").toLowerCase().trim();
          const phone = fieldMap["phone_number"] ?? fieldMap["phone"] ?? "";

          // Find campaign: pageId → leadType match → isDefault → most recent active
          const userEmailFromQuery =
            typeof req.query.userEmail === "string" ? req.query.userEmail.toLowerCase() : "";

          let campaign = pageId
            ? await FBLeadCampaign.findOne({
                facebookPageId: pageId,
                status: { $in: ["active", "setup"] },
              }).lean()
            : null;

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

          const user = await User.findOne({ email: (campaign as any).userEmail })
            .select("_id")
            .lean();
          if (!user) continue;

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
          let folder = await Folder.findOne({
            userEmail: (campaign as any).userEmail,
            name: folderName,
          });
          if (!folder) {
            folder = await Folder.create({
              name: folderName,
              userEmail: (campaign as any).userEmail,
              assignedDrips: [],
            });
          }

          const nameParts = fullName.split(/\s+/);
          const firstName = nameParts[0] ?? "";
          const lastName = nameParts.slice(1).join(" ");
          const normalizedPhone = phone.replace(/\D+/g, "");
          const crmLeadType = FB_LEAD_TYPE_TO_CRM[(campaign as any).leadType] ?? "Final Expense";

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
          });

          await FBLeadEntry.updateOne({ _id: entry._id }, { $set: { crmLeadId: crmLead._id } });

          await enrollOnNewLeadIfWatched({
            userEmail: (campaign as any).userEmail,
            folderId: String(folder._id),
            leadId: String(crmLead._id),
            startMode: "now",
            source: "manual-lead",
          });

          await FBLeadCampaign.updateOne(
            { _id: (campaign as any)._id },
            { $inc: { totalLeads: 1 } }
          );

          // Write to agent's Google Sheet via Apps Script if connected
          const appsScriptUrl = (campaign as any).appsScriptUrl;
          if (appsScriptUrl) {
            await writeToAppsScript(appsScriptUrl, {
              firstName,
              lastName,
              email,
              phone,
              leadType: (campaign as any).leadType,
              source: "Facebook",
              date: new Date().toISOString(),
              campaignName: (campaign as any).campaignName,
            });
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
