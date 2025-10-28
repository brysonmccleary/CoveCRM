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
import { acquireLock } from "@/lib/locks";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import { DateTime } from "luxon";

type Body = {
  leadId?: string;
  campaignId?: string;
  startAt?: string; // ISO datetime optional
};

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

function parseStepDayNumber(dayField?: string): number {
  if (!dayField) return NaN;
  const m = String(dayField).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}
function computeNextWhenPTFromToday(nextDay: number, prevDay = 0): Date {
  const base = DateTime.now().setZone(PT_ZONE).startOf("day");
  const delta = Math.max(0, (isNaN(nextDay) ? 1 : nextDay) - (isNaN(prevDay) ? 0 : prevDay));
  return base.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 }).plus({ days: delta }).toJSDate();
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

    // Scope checks
    const [lead, campaign, user] = await Promise.all([
      Lead.findOne({ _id: leadId, userEmail: session.user.email })
        .select("_id Phone `First Name` `Last Name` userEmail")
        .lean(),
      DripCampaign.findOne({ _id: campaignId })
        .select("_id name key isActive type steps")
        .lean(),
      User.findOne({ email: session.user.email })
        .select("_id email name")
        .lean(),
    ]);

    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.isActive !== true || campaign.type !== "sms") {
      return res.status(400).json({ error: "Campaign is not an active SMS campaign" });
    }

    // Compute initial nextSendAt
    let nextSendAt: Date | undefined;
    if (startAt) {
      const parsed = new Date(startAt);
      if (!isNaN(parsed.getTime())) nextSendAt = parsed;
    }
    if (!nextSendAt) nextSendAt = new Date();

    // Upsert with rawResult so we know if it was newly created
    const up = await DripEnrollment.findOneAndUpdate(
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
      { new: true, upsert: true, rawResult: true }
    );

    const enrollment = up.value as any;
    const wasUpserted = Boolean((up.lastErrorObject as any)?.upserted);

    // Build history entry for UI (unchanged semantics)
    const historyEntry = {
      type: "status",
      subType: "drip-enrolled",
      message: `Enrolled to ${campaign.name}`,
      campaignKey: campaign.key,
      at: new Date().toISOString(),
    };

    // ---- Immediate first-step send (only for NEW enrollments) ----
    if (wasUpserted) {
      const steps: Array<{ text?: string; day?: string }> = Array.isArray(campaign.steps) ? campaign.steps : [];
      const firstStep = steps[0];

      if (firstStep) {
        const to = normalizeToE164Maybe((lead as any).Phone);
        if (to && user?._id) {
          const { first: agentFirst, last: agentLast } = splitName(user.name || "");
          const leadFirst = (lead as any)["First Name"] || null;
          const leadLast  = (lead as any)["Last Name"]  || null;
          const fullName  = [leadFirst, leadLast].filter(Boolean).join(" ") || null;

          const rendered = renderTemplate(String(firstStep.text || ""), {
            contact: { first_name: leadFirst, last_name: leadLast, full_name: fullName },
            agent: { name: user.name || null, first_name: agentFirst, last_name: agentLast },
          });
          const finalBody = ensureOptOut(rendered);

          const idKey = `${String(enrollment._id)}:0:${new Date(enrollment.nextSendAt || Date.now()).toISOString()}`;

          // Acquire the same lock shape as the cron to avoid any race/double
          const locked = await acquireLock(
            "enroll",
            `${String(user.email)}:${String(lead._id)}:${String(campaign._id)}:0`,
            600
          );

          if (locked) {
            try {
              const result = await sendSms({
                to,
                body: finalBody,
                userEmail: user.email,
                leadId: String(lead._id),
                idempotencyKey: idKey,
                enrollmentId: String(enrollment._id),
                campaignId: String(campaign._id),
                stepIndex: 0,
              });

              // Advance cursor + schedule next step (if any)
              const nextIndex = 1;
              const update: any = { $set: { cursorStep: nextIndex, lastSentAt: new Date() } };
              if (steps.length > 1) {
                const prevDay = parseStepDayNumber(firstStep.day);
                const nextDay = parseStepDayNumber(steps[1].day);
                update.$set.nextSendAt = computeNextWhenPTFromToday(nextDay, prevDay);
              } else {
                update.$set.status = "completed";
                update.$unset = { nextSendAt: 1 };
              }
              await DripEnrollment.updateOne({ _id: enrollment._id, cursorStep: 0 }, update);

              // optional: you can attach info into response (not required by your UI)
            } catch (e) {
              // If send fails, keep enrollment active but do not advance cursor
              // (run-drips will retry when nextSendAt is due)
            }
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      enrollmentId: String(enrollment?._id),
      campaign: { id: String(campaign._id), name: campaign.name, key: campaign.key },
      nextSendAt,
      wasUpserted,
      historyEntry,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(200).json({ success: true, deduped: true });
    }
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}
