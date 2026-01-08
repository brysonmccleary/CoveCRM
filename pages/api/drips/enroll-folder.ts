// pages/api/drips/enroll-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollment from "@/models/DripEnrollment";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import User from "@/models/User";
import { DateTime } from "luxon";
import { acquireLock } from "@/lib/locks";
import { sendSms } from "@/lib/twilio/sendSMS";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

type Body = {
  folderId?: string;
  campaignId?: string;
  startMode?: "immediate" | "nextWindow"; // default immediate
  dry?: boolean;
  limit?: number; // optional cap when seeding (safety)
};

function nextWindowPT(): Date {
  const nowPT = DateTime.now().setZone(PT_ZONE);
  const base = nowPT.hour < SEND_HOUR_PT ? nowPT : nowPT.plus({ days: 1 });
  return base.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 }).toJSDate();
}
function parseStepDayNumber(dayField?: string): number {
  if (!dayField) return NaN;
  const m = String(dayField).match(/(\d+)/); return m ? parseInt(m[1], 10) : NaN;
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

/** ---------- robust lead field resolution (generic across any sheet headers) ---------- **/
function normalizeAnyKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[`"'’]/g, "")
    .replace(/[^a-z0-9]+/g, "_") // spaces, punctuation -> underscores
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildNormalizedKeyMap(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if (!obj || typeof obj !== "object") return out;

  for (const k of Object.keys(obj)) {
    const nk = normalizeAnyKey(k);
    if (!nk) continue;
    // Keep the first non-empty value we see for a normalized key
    const v = (obj as any)[k];
    if (out[nk] == null || out[nk] === "") out[nk] = v;
  }
  return out;
}

function pickFirstNonEmpty(map: Record<string, any>, keys: string[]): string | null {
  for (const k of keys) {
    const v = map[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function resolveLeadNameFields(leadDoc: any): { first: string | null; last: string | null; full: string | null } {
  const raw = (leadDoc || {}) as Record<string, any>;
  const norm = buildNormalizedKeyMap(raw);

  // Common “first name” variants across vendors/sheets
  const firstCandidates = [
    "first_name", "firstname", "first", "fname", "given_name", "givenname",
    "client_first_name", "clientfirstname", "lead_first_name", "borrower_first_name",
    "insured_first_name", "prospect_first_name", "customer_first_name", "contact_first_name",
    "applicant_first_name", "primary_first_name",
  ];

  // Common “last name” variants across vendors/sheets
  const lastCandidates = [
    "last_name", "lastname", "last", "lname", "surname", "family_name", "familyname",
    "client_last_name", "clientlastname", "lead_last_name", "borrower_last_name",
    "insured_last_name", "prospect_last_name", "customer_last_name", "contact_last_name",
    "applicant_last_name", "primary_last_name",
  ];

  // Common “full name” variants
  const fullCandidates = [
    "full_name", "fullname", "name", "client_name", "clientname", "lead_name",
    "borrower_name", "insured_name", "prospect_name", "customer_name", "contact_name",
    "applicant_name", "primary_name",
  ];

  const first = pickFirstNonEmpty(norm, firstCandidates);
  const last = pickFirstNonEmpty(norm, lastCandidates);

  const composed = [first, last].filter(Boolean).join(" ").trim();
  const fullRaw = pickFirstNonEmpty(norm, fullCandidates);

  const full = composed || fullRaw || null;

  return { first, last, full };
}
/** ----------------------------------------------------------------------------------- **/

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const { folderId, campaignId, startMode = "immediate", dry, limit }: Body = req.body || {};
    if (!folderId || !campaignId) return res.status(400).json({ error: "folderId and campaignId are required" });

    await dbConnect();

    // Validate campaign
    const campaign = (await DripCampaign.findOne({ _id: campaignId })
      .select("_id name isActive type steps")
      .lean()) as (null | { _id: any; name?: string; isActive?: boolean; type?: string; steps?: any[] });

    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.type !== "sms") return res.status(400).json({ error: "Campaign must be SMS type" });
    if (campaign.isActive !== true) return res.status(400).json({ error: "Campaign is not active" });

    const user = await User.findOne({ email: session.user.email }).select("_id email name").lean();
    if (!user?._id) return res.status(404).json({ error: "User not found" });

    // Create / update the folder watcher
    const watcher = await DripFolderEnrollment.findOneAndUpdate(
      { userEmail: session.user.email, folderId, campaignId, active: true },
      {
        $setOnInsert: {
          userEmail: session.user.email,
          folderId,
          campaignId,
          active: true,
          lastScanAt: new Date(0), // force an initial full scan below
        },
        $set: { startMode },
      },
      { upsert: true, new: true }
    ).lean();

    // Seed enrollments for existing leads in the folder (idempotent)
    // NOTE: we need the full lead doc (or at least its keys) to support "any variation"
    const leads = await Lead.find({ userEmail: session.user.email, folderId })
      .limit(Math.max(0, Number(limit) || 10_000))
      .lean();

    let created = 0, deduped = 0, immediateSent = 0;

    const nextSendAt = startMode === "nextWindow" ? nextWindowPT() : new Date();
    const steps: Array<{ text?: string; day?: string }> = Array.isArray(campaign.steps) ? campaign.steps : [];
    const firstStep = steps[0];

    for (const lead of leads) {
      if (dry) { created++; continue; }

      const before = await DripEnrollment.findOne({
        userEmail: session.user.email,
        leadId: (lead as any)._id,
        campaignId,
        status: { $in: ["active", "paused"] },
      }, { _id: 1 }).lean();

      if (before?._id) { deduped++; continue; }

      // Create enrollment
      const ins = await DripEnrollment.create({
        userEmail: session.user.email,
        leadId: (lead as any)._id,
        campaignId,
        status: "active",
        cursorStep: 0,
        nextSendAt,
        source: "folder-bulk",
      });

      created++;

      // Immediate first message only if startMode === "immediate"
      if (startMode === "immediate" && firstStep) {
        const to = normalizeToE164Maybe((lead as any).Phone);
        if (to) {
          const { first: agentFirst, last: agentLast } = splitName(user.name || "");

          const { first: leadFirst, last: leadLast, full: fullName } = resolveLeadNameFields(lead);

          const rendered = renderTemplate(String(firstStep.text || ""), {
            contact: { first_name: leadFirst, last_name: leadLast, full_name: fullName },
            agent: { name: user.name || null, first_name: agentFirst, last_name: agentLast },
          });
          const finalBody = ensureOptOut(rendered);

          const idKey = `${String(ins._id)}:0:${new Date(nextSendAt || Date.now()).toISOString()}`;
          const locked = await acquireLock(
            "enroll",
            `${String(user.email)}:${String((lead as any)._id)}:${String((campaign as any)._id)}:0`,
            600
          );

          if (locked) {
            try {
              await sendSms({
                to,
                body: finalBody,
                userEmail: user.email,
                leadId: String((lead as any)._id),
                idempotencyKey: idKey,
                enrollmentId: String(ins._id),
                campaignId: String((campaign as any)._id),
                stepIndex: 0,
              });
              immediateSent++;

              // Advance cursor and schedule next (if any)
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
              await DripEnrollment.updateOne({ _id: ins._id, cursorStep: 0 }, update);
            } catch {
              // Leave for cron to retry later
            }
          }
        }
      }
    }

    // Prime the watcher scan time so the cron won't re-seed immediately
    if (!dry && watcher?._id) {
      await DripFolderEnrollment.updateOne(
        { _id: watcher._id },
        { $set: { lastScanAt: new Date() } }
      );
    }

    return res.status(200).json({
      success: true,
      watcherId: watcher?._id,
      campaign: { id: String((campaign as any)._id), name: (campaign as any).name },
      seeded: { created, deduped, immediateSent },
      startMode,
      nextSendAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}
