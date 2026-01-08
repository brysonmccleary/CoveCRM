// pages/api/assign-drip-to-folder.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import DripCampaign from "@/models/DripCampaign";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import DripEnrollment from "@/models/DripEnrollment";
import User from "@/models/User";
import { ObjectId } from "mongodb";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import { DateTime } from "luxon";
import { acquireLock } from "@/lib/locks";
import { sendSms } from "@/lib/twilio/sendSMS";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";

// ---------- helpers ----------
function isValidObjectId(id: string) {
  return /^[a-f0-9]{24}$/i.test(id);
}

async function resolveDrip(dripId: string) {
  // If dripId is an actual DripCampaign _id
  if (isValidObjectId(dripId)) return await DripCampaign.findById(dripId).lean();

  // Otherwise it’s a prebuilt ID -> map to global campaign by name
  const def = prebuiltDrips.find((d) => d.id === dripId);
  if (!def) return null;

  return await DripCampaign.findOne({ isGlobal: true, name: def.name }).lean();
}

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

// Quiet hours (PT)
const QUIET_START = Number(process.env.DRIPS_QUIET_START_HOUR_PT ?? 21); // 21 = 9pm
const QUIET_END = Number(process.env.DRIPS_QUIET_END_HOUR_PT ?? 8); // 8 = 8am

function isQuietHoursPT(now = DateTime.now().setZone(PT_ZONE)) {
  const h = now.hour;
  // Handles windows that cross midnight (default 21→08)
  return QUIET_START > QUIET_END
    ? h >= QUIET_START || h < QUIET_END
    : h >= QUIET_START && h < QUIET_END;
}

function nextWindowPT(now = DateTime.now().setZone(PT_ZONE)): Date {
  const today9 = now.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
  const when = now < today9 ? today9 : today9.plus({ days: 1 });
  return when.toJSDate();
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
 *  Lead field normalization (name/phone variants)
 *  ------------------------- */
function normKey(k: string): string {
  return String(k || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
}
function buildKeyMap(obj: Record<string, any>): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of Object.keys(obj || {})) {
    const nk = normKey(k);
    if (!nk) continue;
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

// ---------- handler ----------
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session: any = await getServerSession(req, res, authOptions as any);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { dripId, folderId } = (req.body || {}) as { dripId?: string; folderId?: string };
  if (!dripId || !folderId) return res.status(400).json({ message: "Missing dripId or folderId" });

  try {
    await dbConnect();
    const userEmail = String(session.user.email).toLowerCase();

    // 1) Validate user & folder
    const user = await User.findOne({ email: userEmail }).select({ _id: 1, email: 1, name: 1 }).lean();
    if (!user?._id) return res.status(404).json({ message: "User not found" });

    const folder = await Folder.findOne({ _id: new ObjectId(folderId), userEmail })
      .select({ _id: 1, assignedDrips: 1, name: 1 })
      .lean();
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // 2) Resolve drip campaign (must be SMS + active + steps)
    const dripDoc: any = await resolveDrip(dripId);
    if (!dripDoc?._id) {
      return res.status(404).json({ message: "Drip campaign not found" });
    }

    const campaignId = String(dripDoc._id);

    const isSms =
      dripDoc.type === "sms" &&
      dripDoc.isActive === true &&
      Array.isArray(dripDoc.steps) &&
      dripDoc.steps.length > 0;

    // Always attach watcher + folder metadata (even if drip is not sendable)
    await DripFolderEnrollment.updateOne(
      { userEmail, folderId: new ObjectId(folderId), campaignId: new ObjectId(campaignId), active: true },
      { $set: { active: true, startMode: "immediate" }, $setOnInsert: { lastScanAt: new Date(0) } },
      { upsert: true }
    );

    await Folder.updateOne(
      { _id: new ObjectId(folderId), userEmail },
      { $addToSet: { assignedDrips: campaignId } }
    );

    if (!isSms) {
      return res.status(200).json({
        message: "Drip assigned (campaign not active SMS with steps). Watcher enabled; no backfill send performed.",
        campaignId,
      });
    }

    // 3) Backfill existing leads into DripEnrollment AND (if not quiet hours) send step 0 immediately
    const nowPT = DateTime.now().setZone(PT_ZONE);
    const quiet = isQuietHoursPT(nowPT);

    const steps: Array<{ text?: string; day?: string }> = Array.isArray(dripDoc.steps) ? dripDoc.steps : [];
    const firstStep = steps[0];

    // If quiet hours, we still seed enrollments but do NOT send step 0 right now.
    const seedNextSendAt = quiet ? nextWindowPT(nowPT) : new Date();

    // IMPORTANT: do NOT project only Phone/First/Last — imports vary. Pull full docs.
    const leads = await Lead.find({ userEmail, folderId: new ObjectId(folderId) }).limit(10000).lean();

    let considered = 0;
    let deduped = 0;
    let created = 0;
    let immediateSent = 0;
    let immediateSkippedNoPhone = 0;

    const { first: agentFirst, last: agentLast } = splitName(user.name || "");

    for (const lead of leads as any[]) {
      considered++;

      if ((lead as any)?.unsubscribed) continue;

      const existing = await DripEnrollment.findOne(
        {
          userEmail,
          leadId: lead._id,
          campaignId: new ObjectId(campaignId),
          status: { $in: ["active", "paused"] },
        },
        { _id: 1 }
      ).lean();

      if (existing?._id) {
        deduped++;
        continue;
      }

      // Create enrollment (cursorStep 0)
      const ins = await DripEnrollment.create({
        userEmail,
        leadId: lead._id,
        campaignId: new ObjectId(campaignId),
        status: "active",
        cursorStep: 0,
        nextSendAt: seedNextSendAt,
        source: "folder-bulk",
      });

      created++;

      // If quiet hours, stop here (runner will send later at next window)
      if (quiet) continue;

      // Immediate send step 0 (same semantics as your /api/drips/enroll-folder)
      if (firstStep) {
        const phoneRaw = pickLeadPhoneRaw(lead);
        const to = normalizeToE164Maybe(phoneRaw || undefined);

        if (!to) {
          immediateSkippedNoPhone++;
          continue;
        }

        const leadFirst = pickLeadFirstName(lead);
        const leadLast = pickLeadLastName(lead);
        const fullName = [leadFirst, leadLast].filter(Boolean).join(" ") || null;

        const rendered = renderTemplate(String(firstStep.text || ""), {
          contact: { first_name: leadFirst, last_name: leadLast, full_name: fullName },
          agent: { name: user.name || null, first_name: agentFirst, last_name: agentLast },
        });
        const finalBody = ensureOptOut(rendered);

        const idKey = `${String(ins._id)}:0:${new Date().toISOString()}`;

        const locked = await acquireLock(
          "enroll",
          `${String(userEmail)}:${String(lead._id)}:${String(campaignId)}:0`,
          600
        );

        if (locked) {
          try {
            await sendSms({
              to,
              body: finalBody,
              userEmail,
              leadId: String(lead._id),
              idempotencyKey: idKey,
              enrollmentId: String(ins._id),
              campaignId: String(campaignId),
              stepIndex: 0,
            });

            immediateSent++;

            // Advance cursor and schedule next step (or complete)
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
            // Leave it active; runner can retry later
          }
        }
      }
    }

    // Prime watcher scan time so folder-watch doesn't re-seed immediately
    await DripFolderEnrollment.updateOne(
      { userEmail, folderId: new ObjectId(folderId), campaignId: new ObjectId(campaignId), active: true },
      { $set: { lastScanAt: new Date() } }
    );

    return res.status(200).json({
      message: "Drip assigned; watcher active; existing leads seeded and step 0 sent immediately when allowed.",
      campaignId,
      quietHours: quiet,
      quietHoursNextSendAt: quiet ? seedNextSendAt : null,
      considered,
      deduped,
      created,
      immediateSent,
      immediateSkippedNoPhone,
    });
  } catch (error) {
    console.error("Error assigning drip:", error);
    return res.status(500).json({ message: "Server error" });
  }
}
