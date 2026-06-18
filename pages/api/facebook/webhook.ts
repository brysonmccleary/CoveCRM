// pages/api/facebook/webhook.ts
// Facebook Lead Ads webhook receiver
// GET  — verify token challenge (Facebook calls this on setup)
// POST — receive leadgen events, fetch lead from Graph API, store in CRM
import type { NextApiRequest, NextApiResponse } from "next";
import { createHmac, timingSafeEqual } from "crypto";
import axios from "axios";

export const config = { api: { bodyParser: false } };
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

async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function validateFBSignature(rawBody: Buffer, signatureHeader: string): boolean {
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
    const url = `https://graph.facebook.com/v19.0/${leadgenId}`;
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
    let rawBody: Buffer;
    try {
      rawBody = await getRawBody(req);
    } catch (err: any) {
      console.error("[fb-webhook] Failed to read body:", err?.message);
      return res.status(200).json({ ok: true });
    }

    // HMAC-SHA256 signature validation against raw body bytes
    const signatureHeader = String(req.headers["x-hub-signature-256"] || "");
    if (!validateFBSignature(rawBody, signatureHeader)) {
      if (FB_APP_SECRET) {
        // Production: reject invalid signatures silently — return 200 so FB doesn't retry
        console.warn("[fb-webhook] Invalid X-Hub-Signature-256 — rejecting");
        return res.status(200).json({ ok: false, error: "invalid_signature" });
      }
      console.warn("[fb-webhook] Signature check skipped — FB_APP_SECRET not configured");
    }

    let body: any;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      console.error("[fb-webhook] Failed to parse JSON body");
      return res.status(200).json({ ok: true });
    }

    // DEPRECATED: all lead processing now handled by /api/meta/webhook which uses
    // correct raw-body signature validation and processMetaLead with drip enrollment.
    // Return 200 so Meta does not retry; configure Meta to send webhooks to /api/meta/webhook.
    console.warn("[facebook/webhook] DEPRECATED: use /api/meta/webhook instead. Lead not processed.");
    return res.status(200).json({ ok: true, deprecated: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
