// pages/api/cron/fire-due-ai-calls.ts
// Cron: fires AI first calls whose delay has elapsed.
// Finds leads with aiFirstCallStatus="scheduled" and aiFirstCallDueAt <= now,
// re-checks DNC/booked guards, then fires to the voice server.
// Run this every 1–2 minutes via Vercel Cron or an external scheduler.
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

const AI_VOICE_SERVER_URL = (
  process.env.AI_VOICE_HTTP_BASE ||
  (process.env.AI_VOICE_STREAM_URL || "").replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://")
).replace(/\/$/, "");

const COVECRM_API_SECRET = process.env.COVECRM_API_SECRET || "";

const TERMINAL_STATUSES = new Set([
  "Booked Appointment",
  "booked appointment",
  "Not Interested",
  "not interested",
  "Sold",
  "sold",
  "Do Not Contact",
  "do not contact",
  "DNC",
  "dnc",
]);

// Max leads to process per cron tick — prevents timeout on large backlogs
const MAX_BATCH = 10;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  if (!AI_VOICE_SERVER_URL || !COVECRM_API_SECRET) {
    console.warn("[fire-due-ai-calls] Missing AI_VOICE_HTTP_BASE or COVECRM_API_SECRET — skipping");
    return res.status(200).json({ ok: true, fired: 0, skipped: "missing_env" });
  }

  await mongooseConnect();

  const now = new Date();
  let fired = 0;
  let skipped = 0;

  for (let i = 0; i < MAX_BATCH; i++) {
    // Atomic claim: find one due scheduled lead and transition it to "pending"
    // to prevent another cron tick from double-firing it.
    const lead = await Lead.findOneAndUpdate(
      {
        aiFirstCallStatus: "scheduled",
        aiFirstCallDueAt: { $lte: now },
      },
      {
        $set: { aiFirstCallStatus: "pending" },
        $unset: { aiFirstCallDueAt: 1 },
      },
      { new: true }
    ).lean() as any;

    if (!lead) break; // no more due leads

    const leadId = String(lead._id);
    const userEmail = String(lead.userEmail || "");

    // Re-check DNC — lead may have opted out during the delay window
    if (lead.doNotCall === true) {
      await Lead.updateOne({ _id: lead._id }, { $set: { aiFirstCallStatus: "aborted_dnc" } });
      console.info(`[fire-due-ai-calls] Lead ${leadId} is DNC — skipping`);
      skipped++;
      continue;
    }

    // Re-check booked — lead may have been booked during the delay window
    if (lead.appointmentTime) {
      await Lead.updateOne({ _id: lead._id }, { $set: { aiFirstCallStatus: "aborted_booked" } });
      console.info(`[fire-due-ai-calls] Lead ${leadId} was booked during delay — skipping`);
      skipped++;
      continue;
    }

    // Re-check terminal status
    const leadStatus = String(lead.status || "").trim();
    if (leadStatus && TERMINAL_STATUSES.has(leadStatus)) {
      await Lead.updateOne({ _id: lead._id }, { $set: { aiFirstCallStatus: "aborted_dnc" } });
      console.info(`[fire-due-ai-calls] Lead ${leadId} has terminal status "${leadStatus}" — skipping`);
      skipped++;
      continue;
    }

    // Verify folder still has AI calling enabled
    const folder = await Folder.findById(lead.folderId).lean() as any;
    if (!folder?.aiFirstCallEnabled) {
      await Lead.updateOne({ _id: lead._id }, { $set: { aiFirstCallStatus: "failed" } });
      console.info(`[fire-due-ai-calls] Folder aiFirstCallEnabled=false for lead ${leadId} — skipping`);
      skipped++;
      continue;
    }

    // Fire
    try {
      const resp = await fetch(`${AI_VOICE_SERVER_URL}/trigger-call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-secret": COVECRM_API_SECRET,
        },
        body: JSON.stringify({
          userEmail,
          leadId,
          leadPhone: lead.Phone,
          scriptKey: (folder.aiScriptKey as string) || "default",
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        console.error(`[fire-due-ai-calls] Voice server ${resp.status} for lead ${leadId}: ${errBody.slice(0, 200)}`);
        await Lead.updateOne({ _id: lead._id }, { $set: { aiFirstCallStatus: "failed" } });
        skipped++;
        continue;
      }

      await Lead.updateOne({ _id: lead._id }, { $set: { aiFirstCallStatus: "triggered", aiFirstCallTriggeredAt: new Date() } });
      console.info(`[fire-due-ai-calls] Triggered call for lead ${leadId} (${userEmail})`);
      fired++;
    } catch (err: any) {
      console.error(`[fire-due-ai-calls] Unexpected error for lead ${leadId}:`, err?.message);
      await Lead.updateOne({ _id: lead._id }, { $set: { aiFirstCallStatus: "failed" } });
      skipped++;
    }
  }

  return res.status(200).json({ ok: true, fired, skipped });
}
