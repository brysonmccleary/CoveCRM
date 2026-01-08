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
  return base
    .set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();
}
function parseStepDayNumber(dayField?: string): number {
  if (!dayField) return NaN;
  const m = String(dayField).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}
function computeNextWhenPTFromToday(nextDay: number, prevDay = 0): Date {
  const base = DateTime.now().setZone(PT_ZONE).startOf("day");
  const delta = Math.max(
    0,
    (isNaN(nextDay) ? 1 : nextDay) - (isNaN(prevDay) ? 0 : prevDay)
  );
  return base
    .set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 })
    .plus({ days: delta })
    .toJSDate();
}
function normalizeToE164Maybe(phone?: string): string | null {
  if (!phone) return null;
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  const just = digits.replace(/\D/g, "");
  if (just.length === 10) return `+1${just}`;
  if (just.length === 11 && just.startsWith("1")) return `+${just}`;
  return null;
}

/** -------------------------
 *  Lead field normalization
 *  ------------------------- */
function normKey(k: string): string {
  return String(k || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, ""); // remove spaces, underscores, punctuation
}
function buildKeyMap(obj: Record<string, any>): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of Object.keys(obj || {})) {
    const nk = normKey(k);
    if (!nk) continue;
    // keep the first occurrence
    if (!m.has(nk)) m.set(nk, k);
  }
  return m;
}
function getAnyField(obj: Record<string, any>, candidates: string[]): any {
  if (!obj) return undefined;
  const map = buildKeyMap(obj);
  for (const c of candidates) {
    const hit = map.get(normKey(c));
    if (hit && obj[hit] != null && obj[hit] !== "") return obj[hit];
  }
  return undefined;
}
function pickLeadFirstName(lead: Record<string, any>): string | null {
  const v = getAnyField(lead, [
    "First Name",
    "FirstName",
    "First",
    "FName",
    "first_name",
    "firstname",
    "given_name",
    "givenname",
    "contact_first_name",
  ]);
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}
function pickLeadLastName(lead: Record<string, any>): string | null {
  const v = getAnyField(lead, [
    "Last Name",
    "LastName",
    "Last",
    "LName",
    "last_name",
    "lastname",
    "surname",
    "family_name",
    "familyname",
    "contact_last_name",
  ]);
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}
function pickLeadPhoneRaw(lead: Record<string, any>): string | null {
  const v = getAnyField(lead, [
    "Phone",
    "Phone Number",
    "PhoneNumber",
    "phone_number",
    "phone",
    "mobile",
    "mobile_phone",
    "cell",
    "cell_phone",
    "contact_phone",
    "primary_phone",
  ]);
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email)
      return res.status(401).json({ error: "Unauthorized" });

    const { folderId, campaignId, startMode = "immediate", dry, limit }: Body =
      req.body || {};
    if (!folderId || !campaignId)
      return res
        .status(400)
        .json({ error: "folderId and campaignId are required" });

    await dbConnect();

    // Validate campaign
    const campaign = (await DripCampaign.findOne({ _id: campaignId })
      .select("_id name isActive type steps")
      .lean()) as
      | null
      | { _id: any; name?: string; isActive?: boolean; type?: string; steps?: any[] };

    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.type !== "sms")
      return res.status(400).json({ error: "Campaign must be SMS type" });
    if (campaign.isActive !== true)
      return res.status(400).json({ error: "Campaign is not active" });

    const user = await User.findOne({ email: session.user.email })
      .select("_id email name")
      .lean();
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

    // ✅ IMPORTANT: do NOT project only Phone/First/Last
    // Google Sheet imports vary; we need the full doc to reliably pick name/phone variants.
    const leads = await Lead.find({ userEmail: session.user.email, folderId })
      .limit(Math.max(0, Number(limit) || 10_000))
      .lean();

    let created = 0,
      deduped = 0,
      immediateSent = 0,
      immediateSkippedNoPhone = 0;

    const nextSendAt = startMode === "nextWindow" ? nextWindowPT() : new Date();
    const steps: Array<{ text?: string; day?: string }> = Array.isArray(campaign.steps)
      ? campaign.steps
      : [];
    const firstStep = steps[0];

    for (const lead of leads as any[]) {
      if (dry) {
        created++;
        continue;
      }

      const before = await DripEnrollment.findOne(
        {
          userEmail: session.user.email,
          leadId: lead._id,
          campaignId,
          status: { $in: ["active", "paused"] },
        },
        { _id: 1 }
      ).lean();

      if (before?._id) {
        deduped++;
        continue;
      }

      // Create enrollment
      const ins = await DripEnrollment.create({
        userEmail: session.user.email,
        leadId: lead._id,
        campaignId,
        status: "active",
        cursorStep: 0,
        nextSendAt,
        source: "folder-bulk",
      });

      created++;

      // Immediate first message only if startMode === "immediate"
      if (startMode === "immediate" && firstStep) {
        const phoneRaw = pickLeadPhoneRaw(lead);
        const to = normalizeToE164Maybe(phoneRaw || undefined);

        if (!to) {
          immediateSkippedNoPhone++;
          continue;
        }

        const { first: agentFirst, last: agentLast } = splitName(user.name || "");
        const leadFirst = pickLeadFirstName(lead);
        const leadLast = pickLeadLastName(lead);
        const fullName = [leadFirst, leadLast].filter(Boolean).join(" ") || null;

        const rendered = renderTemplate(String(firstStep.text || ""), {
          contact: { first_name: leadFirst, last_name: leadLast, full_name: fullName },
          agent: { name: user.name || null, first_name: agentFirst, last_name: agentLast },
        });
        const finalBody = ensureOptOut(rendered);

        const idKey = `${String(ins._id)}:0:${new Date(
          nextSendAt || Date.now()
        ).toISOString()}`;

        const locked = await acquireLock(
          "enroll",
          `${String(user.email)}:${String(lead._id)}:${String(campaign._id)}:0`,
          600
        );

        if (locked) {
          try {
            await sendSms({
              to,
              body: finalBody,
              userEmail: user.email,
              leadId: String(lead._id),
              idempotencyKey: idKey,
              enrollmentId: String(ins._id),
              campaignId: String(campaign._id),
              stepIndex: 0,
            });
            immediateSent++;

            // Advance cursor and schedule next (if any)
            const nextIndex = 1;
            const update: any = {
              $set: { cursorStep: nextIndex, lastSentAt: new Date() },
            };
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
      campaign: { id: String(campaign._id), name: campaign.name },
      seeded: { created, deduped, immediateSent, immediateSkippedNoPhone },
      startMode,
      nextSendAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}
