import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import mongoose from "mongoose";
import { sendEmail } from "@/lib/email";

// --------------------------------------------------------------------------------------
// OPS ALERTS (hands-off)
// Sends an email when failures occur, rate-limited to avoid spam.
// Env:
//   OPS_ALERT_EMAIL (optional) default: Bryson.mccleary1@gmail.com
//   OPS_ALERT_COOLDOWN_MINUTES (optional) default: 30
// --------------------------------------------------------------------------------------
const OPS_ALERT_DEFAULT_TO = "Bryson.mccleary1@gmail.com";
const OPS_ALERT_COOLDOWN_MINUTES = parseInt(process.env.OPS_ALERT_COOLDOWN_MINUTES || "30", 10);

// best-effort global rate limit across warm lambdas
function shouldSendOpsAlert(): boolean {
  const g: any = globalThis as any;
  const now = Date.now();
  const last = typeof g.__covecrm_last_ops_alert_ts === "number" ? g.__covecrm_last_ops_alert_ts : 0;
  const cooldownMs = Math.max(1, OPS_ALERT_COOLDOWN_MINUTES) * 60 * 1000;
  if (now - last < cooldownMs) return false;
  g.__covecrm_last_ops_alert_ts = now;
  return true;
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function sendOpsAlertEmail(opts: {
  to?: string;
  subject: string;
  html: string;
}) {
  try {
    const to = (process.env.OPS_ALERT_EMAIL || opts.to || OPS_ALERT_DEFAULT_TO).trim();
    if (!to) return;
    await sendEmail(to, opts.subject, opts.html);
  } catch (e: any) {
    console.error("[OPS ALERT] sendEmail failed:", e?.message || e);
  }
}

/**
 * Enforces inbound webhook URLs across ALL user subaccounts:
 * - MessagingService.inboundRequestUrl
 * - IncomingPhoneNumber.smsUrl
 *
 * Secured by CRON_SECRET (query ?token= or Authorization: Bearer) OR x-vercel-cron.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const secret = process.env.CRON_SECRET || "";
  const token = String(req.query.token || "");
  const authHeader = String(req.headers.authorization || "");
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const isVercelCron = !!req.headers["x-vercel-cron"];
  const okAuth = (!!secret && (token === secret || bearer === secret)) || isVercelCron;

  if (!okAuth) return res.status(403).json({ ok: false, error: "Forbidden" });

  const mongo = process.env.MONGODB_URI;
  if (!mongo) return res.status(500).json({ ok: false, error: "Missing MONGODB_URI" });

  const base = (process.env.RAW_BASE_URL || process.env.PUBLIC_BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
  const webhookSecret = process.env.TWILIO_WEBHOOK_SECRET || "";
  if (!webhookSecret) {
    return res.status(500).json({ ok: false, error: "Missing TWILIO_WEBHOOK_SECRET" });
  }

  const inboundUrl = `${base}/api/twilio/inbound-sms?token=${encodeURIComponent(webhookSecret)}`;

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongo);
  }

  // Query raw users collection to avoid model path issues
  const db = mongoose.connection.db;
  if (!db) return res.status(500).json({ ok: false, error: "Mongo db handle unavailable" });
  const usersCol = db.collection("users");
const cursor = usersCol.find(
      {
        "twilio.accountSid": { $exists: true, $ne: "" },
      },
      { projection: { email: 1, twilio: 1, a2p: 1 } }
    );

  const masterSid = process.env.TWILIO_ACCOUNT_SID || "";
  const masterToken = process.env.TWILIO_AUTH_TOKEN || "";
  if (!masterSid || !masterToken) {
    return res.status(500).json({ ok: false, error: "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN" });
  }

  let scanned = 0;
    let attemptedSubaccounts = 0;
    let updatedSubaccounts = 0;
    let updatedServices = 0;
    let updatedNumbers = 0;
  const failures: Array<{ email?: string; subSid?: string; reason: string }> = [];

  while (await cursor.hasNext()) {
    const u: any = await cursor.next();
    scanned++;

    const subSid = u?.twilio?.accountSid;
    const email = u?.email;

    if (!subSid) continue;

      attemptedSubaccounts++;

    const client = twilio(masterSid, masterToken, { accountSid: subSid });

      let didUpdateThisSub = false;

    // 1) Update ALL Messaging Services in this subaccount
    try {
      const services = await client.messaging.v1.services.list({ limit: 200 });
      for (const svc of services) {
        // If inboundRequestUrl is null/empty or different, set it.
        if (svc.inboundRequestUrl !== inboundUrl) {
          await client.messaging.v1.services(svc.sid).update({ inboundRequestUrl: inboundUrl });
          updatedServices++;
            didUpdateThisSub = true;
        }
      }
    } catch (e: any) {
      failures.push({ email, subSid, reason: `MessagingServices list/update failed: ${e?.message || String(e)}` });
      // Don't stop—still try to update number-level webhooks
    }

    // 2) Update ALL Incoming Phone Numbers in this subaccount (even if not attached to a Messaging Service)
    try {
      const nums = await client.incomingPhoneNumbers.list({ limit: 200 });
      for (const n of nums) {
        const method = (n.smsMethod || "").toUpperCase();
        if (n.smsUrl !== inboundUrl || method !== "POST") {
          await client.incomingPhoneNumbers(n.sid).update({ smsUrl: inboundUrl, smsMethod: "POST" });
          updatedNumbers++;
            didUpdateThisSub = true;
        }
      }
    } catch (e: any) {
      failures.push({ email, subSid, reason: `IncomingPhoneNumbers list/update failed: ${e?.message || String(e)}` });
      continue;
    }

      if (didUpdateThisSub) updatedSubaccounts++;
    }


  
    // ----------------------------------------------------------------------------------
    // OPS ALERT: email if any failures occurred (rate-limited)
    // ----------------------------------------------------------------------------------
    if (failures.length > 0 && shouldSendOpsAlert()) {
      const commit = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GITHUB_COMMIT_SHA || process.env.GITHUB_SHA || "").slice(0, 12);
      const subj = `CoveCRM OPS: Twilio webhook enforcement failures (${failures.length})`;
      const rows = failures.slice(0, 50).map((f) => {
        const email = escapeHtml(String(f.email || ""));
        const subSid = escapeHtml(String(f.subSid || ""));
        const reason = escapeHtml(String(f.reason || ""));
        return `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:Arial, sans-serif;font-size:12px;">${email}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:Arial, sans-serif;font-size:12px;">${subSid}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:Arial, sans-serif;font-size:12px;">${reason}</td>
        </tr>`;
      }).join("");

      const html = `
        <div style="font-family:Arial, sans-serif;">
          <h2 style="margin:0 0 8px 0;">Twilio Inbound Webhook Enforcement Failures</h2>
          <p style="margin:0 0 6px 0;"><b>Count:</b> ${failures.length}</p>
          <p style="margin:0 0 6px 0;"><b>Build:</b> ${escapeHtml(commit || "unknown")}</p>
          <p style="margin:0 0 12px 0;"><b>Endpoint:</b> /api/cron/enforce-twilio-inbound-webhooks</p>
          <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;max-width:900px;">
            <thead>
              <tr>
                <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd;font-size:12px;">User Email</th>
                <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd;font-size:12px;">Subaccount SID</th>
                <th align="left" style="padding:6px 8px;border-bottom:2px solid #ddd;font-size:12px;">Reason</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:12px;font-size:12px;color:#666;">
            This is rate-limited (default: 30 minutes). Set OPS_ALERT_COOLDOWN_MINUTES to change.
          </p>
        </div>
      `;
      await sendOpsAlertEmail({ subject: subj, html });
    }

return res.status(200).json({
      ok: true,
      buildTag: "enforce-twilio-inbound-webhooks@v3",
      buildTime: "2026-02-26T00:59:44Z",
      buildCommit: (process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GITHUB_COMMIT_SHA || process.env.GITHUB_SHA || "").slice(0, 12),
      inboundUrl: inboundUrl.replace(/token=([^&]+)/, "token=***"),
      scannedUsers: scanned,
      attemptedSubaccounts,
      updatedSubaccounts,
      updatedServices,
      updatedNumbers,
      failuresCount: failures.length,
      failures: failures.slice(0, 20),
    });
  }
