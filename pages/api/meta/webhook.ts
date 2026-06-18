// pages/api/meta/webhook.ts
// Meta (Facebook) native lead webhook — replaces Zapier dependency
// GET  — Meta webhook verification challenge
// POST — Receive and process lead gen events

import type { NextApiRequest, NextApiResponse } from "next";
import { createHmac, timingSafeEqual } from "crypto";
import mongooseConnect from "@/lib/mongooseConnect";
import { processMetaLead } from "@/lib/meta/processMetaLead";
import MetaLeadWebhookEvent from "@/models/MetaLeadWebhookEvent";

export const config = { api: { bodyParser: false } };

const META_WEBHOOK_VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || "";
const META_APP_SECRET = process.env.META_APP_SECRET || "";

async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function validateSignature(rawBody: Buffer, signatureHeader: string): boolean {
  if (!META_APP_SECRET) return true; // skip validation in dev/local when not configured
  if (!signatureHeader) return false;

  const sig = signatureHeader.replace(/^sha256=/, "");
  const expected = createHmac("sha256", META_APP_SECRET)
    .update(rawBody)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // GET — Meta webhook verification challenge
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (
      mode === "subscribe" &&
      META_WEBHOOK_VERIFY_TOKEN &&
      token === META_WEBHOOK_VERIFY_TOKEN
    ) {
      console.info("[meta-webhook] Verification challenge accepted");
      return res.status(200).send(challenge);
    }

    console.warn("[meta-webhook] Verification failed", { mode, token: typeof token });
    return res.status(403).json({ error: "Verification failed" });
  }

  // POST — Receive lead events
  if (req.method === "POST") {
    // Read raw body for signature validation
    let rawBody: Buffer;
    try {
      rawBody = await getRawBody(req);
    } catch (err: any) {
      console.error("[meta-webhook] Failed to read body:", err?.message);
      return res.status(200).json({ ok: true }); // always 200 to Meta
    }

    // Validate signature
    const signatureHeader = String(req.headers["x-hub-signature-256"] || "");
    const isValid = validateSignature(rawBody, signatureHeader);
    if (!isValid) {
      if (META_APP_SECRET && signatureHeader) {
        // Only reject if a signature was actually provided and it's wrong.
        // Meta test webhooks from the developer dashboard send no signature header,
        // so we allow those through for testing purposes.
        console.warn("[meta-webhook] Invalid X-Hub-Signature-256 — rejecting");
        return res.status(200).json({ ok: false, error: "invalid_signature" });
      }
      console.warn("[meta-webhook] Signature check skipped — no signature header or META_APP_SECRET not configured");
    }

    // Parse body
    let body: any;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      console.error("[meta-webhook] Failed to parse JSON body");
      return res.status(200).json({ ok: true });
    }

    const leadgenEvents: Array<{
      leadgenId: string;
      pageId: string;
      formId: string;
      adId: string;
      adsetId: string;
      metaCampaignId: string;
      createdTime: any;
      rawEntry: any;
      rawChange: any;
    }> = [];

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.field !== "leadgen") continue;

        const value = change.value || {};
        const leadgenId = String(value.leadgen_id || "");
        if (!leadgenId) continue;

        leadgenEvents.push({
          leadgenId,
          pageId: String(value.page_id || ""),
          formId: String(value.form_id || ""),
          adId: String(value.ad_id || ""),
          adsetId: String(value.adset_id || ""),
          metaCampaignId: String(value.campaign_id || ""),
          createdTime: value.created_time || "",
          rawEntry: entry,
          rawChange: change,
        });
      }
    }

    try {
      if (leadgenEvents.length > 0) {
        await mongooseConnect();
        const now = new Date();
        await Promise.all(
          leadgenEvents.map((event) =>
            MetaLeadWebhookEvent.updateOne(
              { leadgenId: event.leadgenId },
              {
                $setOnInsert: {
                  leadgenId: event.leadgenId,
                  receivedAt: now,
                  processingStatus: "received",
                  attemptCount: 0,
                  deliveryCount: 0,
                },
                $set: {
                  pageId: event.pageId,
                  formId: event.formId,
                  adId: event.adId,
                  adsetId: event.adsetId,
                  metaCampaignId: event.metaCampaignId,
                  createdTime: event.createdTime,
                  rawPayload: body,
                  rawEntry: event.rawEntry,
                  rawChange: event.rawChange,
                  lastReceivedAt: now,
                },
                $inc: { deliveryCount: 1 },
              },
              { upsert: true }
            )
          )
        );
      }
    } catch (err: any) {
      // Log but always ACK 200 — returning 500 causes Meta retry storms
      console.error("[meta-webhook] DB persist failed (acking 200 to suppress Meta retry):", err?.message);
    }

    // Return 200 immediately — process async
    res.status(200).json({ ok: true });

    // Process all leadgen events
    try {
      if (body?.object !== "page" && body?.object !== "leadgen") {
        // Accept both page and leadgen object types
      }

      for (const event of leadgenEvents) {
        // Fire async — do not await
        processMetaLead(
          event.leadgenId,
          event.pageId,
          event.formId,
          event.adId,
          event.adsetId,
          event.metaCampaignId,
          event.createdTime
        ).catch((err: any) => {
          console.error("[meta-webhook] processMetaLead error:", err?.message || err);
        });
      }
    } catch (err: any) {
      console.error("[meta-webhook] Processing error:", err?.message || err);
    }

    return;
  }

  return res.status(405).json({ error: "Method not allowed" });
}
