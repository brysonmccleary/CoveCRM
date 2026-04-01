// pages/api/meta/webhook.ts
// Meta (Facebook) native lead webhook — replaces Zapier dependency
// GET  — Meta webhook verification challenge
// POST — Receive and process lead gen events

import type { NextApiRequest, NextApiResponse } from "next";
import { createHmac, timingSafeEqual } from "crypto";
import mongooseConnect from "@/lib/mongooseConnect";
import { processMetaLead } from "@/lib/meta/processMetaLead";

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
      if (META_APP_SECRET) {
        // Production: signature is required and must be valid — reject silently.
        // Return 200 so Meta doesn't retry (they would keep retrying on 4xx).
        console.warn("[meta-webhook] Invalid X-Hub-Signature-256 in production — rejecting without processing");
        return res.status(200).json({ ok: false, error: "invalid_signature" });
      }
      // Dev/local (no META_APP_SECRET): warn but continue (covered by validateSignature returning true)
      console.warn("[meta-webhook] Signature check skipped — META_APP_SECRET not configured");
    }

    // Parse body
    let body: any;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      console.error("[meta-webhook] Failed to parse JSON body");
      return res.status(200).json({ ok: true });
    }

    // Return 200 immediately — process async
    res.status(200).json({ ok: true });

    // Process all leadgen events
    try {
      await mongooseConnect();

      if (body?.object !== "page" && body?.object !== "leadgen") {
        // Accept both page and leadgen object types
      }

      for (const entry of body?.entry ?? []) {
        for (const change of entry?.changes ?? []) {
          if (change?.field !== "leadgen") continue;

          const value = change.value || {};
          const leadgenId = String(value.leadgen_id || "");
          const pageId = String(value.page_id || "");
          const formId = String(value.form_id || "");
          const adId = String(value.ad_id || "");
          const adsetId = String(value.adset_id || "");
          const metaCampaignId = String(value.campaign_id || "");
          const createdTime = value.created_time || "";

          if (!leadgenId) continue;

          // Fire async — do not await
          processMetaLead(
            leadgenId,
            pageId,
            formId,
            adId,
            adsetId,
            metaCampaignId,
            createdTime
          ).catch((err: any) => {
            console.error("[meta-webhook] processMetaLead error:", err?.message || err);
          });
        }
      }
    } catch (err: any) {
      console.error("[meta-webhook] Processing error:", err?.message || err);
    }

    return;
  }

  return res.status(405).json({ error: "Method not allowed" });
}
