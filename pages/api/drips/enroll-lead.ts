// pages/api/drips/enroll-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollment from "@/models/DripEnrollment";
import Lead from "@/models/Lead";
import User from "@/models/User";
import { sendSms } from "@/lib/twilio/sendSMS";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import { DateTime } from "luxon";
import { acquireLock } from "@/lib/locks";

type Body = {
  leadId?: string;
  campaignId?: string;
  startAt?: string; // ISO datetime optional
};

// ---- Local helpers (self-contained; no external changes) ----
const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

function parseStepDayNumber(dayField?: string): number {
  if (!dayField) return NaN;
  const m = String(dayField).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

/** Next step time using numeric day labels (Day 1, Day 2, …). */
function computeStepWhenPTFromBase(
  base: DateTime,
  targetDayNumber: number,
  prevDayNumber = 0
): DateTime {
  const delta = Math.max(
    0,
    (isNaN(targetDayNumber) ? 1 : targetDayNumber) -
      (isNaN(prevDayNumber) ? 0 : prevDayNumber)
  );
  return base
    .plus({ days: delta })
    .set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
}

function normalizeToE164Maybe(phone?: string): string | null {
  if (!phone) return null;
  const digits = (phone || "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  const just = digits.replace(/\D/g, "");
  if (just.length === 10) return `+1${just}`;
  if (just.length === 11 && just.startsWith("1")) return `+${just}`;
  return null;
}

// -------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const { leadId, campaignId, startAt }: Body = (req.body || {}) as any;
    if (!leadId || !campaignId) {
      return res.status(400).json({ error: "leadId and campaignId are required" });
    }

    await dbConnect();

    // Validate lead in tenant scope
    const lead = await Lead.findOne({ _id: leadId, userEmail: session.user.email })
      .select({ _id: 1, Phone: 1, "First Name": 1, "Last Name": 1, userEmail: 1 })
      .lean();
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    // Validate campaign
    const campaign = (await DripCampaign.findOne({ _id: campaignId })
      .select("_id name key isActive type steps")
      .lean()) as any;
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.isActive !== true) {
      return res.status(400).json({ error: "Campaign is not active" });
    }
    if (campaign.type !== "sms") {
      return res.status(400).json({ error: "Only SMS drips are supported right now" });
    }

    // Compute initial nextSendAt
    let nextSendAt: Date | undefined;
    if (startAt) {
      const parsed = new Date(startAt);
      if (!isNaN(parsed.getTime())) nextSendAt = parsed;
    }
    if (!nextSendAt) nextSendAt = new Date();

    // Create or dedupe active enrollment (unique on lead+campaign while active/paused)
    const enrollment = await DripEnrollment.findOneAndUpdate(
      {
        leadId,
        campaignId,
        status: { $in: ["active", "paused"] },
        userEmail: session.user.email,
      },
      {
        $setOnInsert: {
          leadId,
          campaignId,
          userEmail: session.user.email,
          status: "active",
          cursorStep: 0,
          nextSendAt,
          source: "manual-lead",
        },
      },
      { new: true, upsert: true }
    ).lean();

    const historyEntry = {
      type: "status",
      subType: "drip-enrolled",
      message: `Enrolled to ${campaign.name}`,
      campaignKey: campaign.key,
      at: new Date().toISOString(),
    };

    // ---- Immediately attempt first send if it's due now (best-effort; no throw if it fails) ----
    let firstSend: {
      attempted: boolean;
      sent?: boolean;
      scheduled?: boolean;
      sid?: string;
      error?: string;
    } = { attempted: false };

    try {
      // Due if nextSendAt <= now
      if (new Date((enrollment as any).nextSendAt || nextSendAt) <= new Date()) {
        firstSend.attempted = true;

        const steps: Array<{ text?: string; day?: string }> = Array.isArray(campaign.steps)
          ? campaign.steps
          : [];
        const idx = Math.max(0, Number((enrollment as any).cursorStep || 0));
        const step = steps[idx];

        if (step) {
          const to = normalizeToE164Maybe((lead as any).Phone);
          if (!to) throw new Error("Invalid or missing lead phone");

          const user = await User.findOne({ email: session.user.email })
            .select({ _id: 1, email: 1, name: 1 })
            .lean();
          if (!user?._id) throw new Error("User not found for tenant");

          // Render body
          const { first: agentFirst, last: agentLast } = splitName(user.name || "");
          const firstName = (lead as any)["First Name"] || null;
          const lastName = (lead as any)["Last Name"] || null;
          const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

          const rendered = renderTemplate(String(step.text || ""), {
            contact: { first_name: firstName, last_name: lastName, full_name: fullName },
            agent: { name: user.name || null, first_name: agentFirst, last_name: agentLast },
          });
          const finalBody = ensureOptOut(rendered);

          // lock: user + lead + campaign + stepIndex
          const ok = await acquireLock(
            "enroll",
            `${String(user.email)}:${String((lead as any)._id)}:${String(campaign._id)}:${String(idx)}`,
            600
          );
          if (!ok) {
            // Someone else is sending it (or very recent duplicate) — treat as success, but don't advance here
          } else {
            const result = await sendSms({
              to,
              body: finalBody,
              userEmail: user.email,
              leadId: String((lead as any)._id),
            });

            if (result?.sid) {
              if (result.scheduledAt) firstSend.scheduled = true;
              else firstSend.sent = true;
              firstSend.sid = result.sid;
            }
          }

          // Advance cursor and schedule the next step (or complete)
          const nextIndex = idx + 1;
          const update: any = { $set: { cursorStep: nextIndex } };

          if (nextIndex >= steps.length) {
            update.$set.status = "completed";
            update.$unset = { ...(update.$unset || {}), nextSendAt: 1 };
          } else {
            const prevDay = parseStepDayNumber(step.day);
            const nextDay = parseStepDayNumber(steps[nextIndex].day);
            const base = DateTime.now().setZone(PT_ZONE).startOf("day");
            const nextWhen = computeStepWhenPTFromBase(base, nextDay, prevDay);
            update.$set.nextSendAt = nextWhen.toJSDate();
          }

          await DripEnrollment.updateOne({ _id: (enrollment as any)._id }, update);
        }
      }
    } catch (e: any) {
      // Do not fail the overall enroll; just report what happened
      firstSend.error = e?.message || String(e);
    }

    return res.status(200).json({
      success: true,
      enrollmentId: (enrollment as any)?._id,
      campaign: { id: String(campaign._id), name: campaign.name, key: campaign.key },
      nextSendAt,
      historyEntry,
      firstSend,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      // unique index (leadId+campaignId+status) dedupe case
      return res.status(200).json({ success: true, deduped: true });
    }
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}
