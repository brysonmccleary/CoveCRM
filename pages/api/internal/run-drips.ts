// pages/api/internal/run-drips.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollment from "@/models/DripEnrollment";
import { sendSms } from "@/lib/twilio/sendSMS";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import { prebuiltDrips } from "@/utils/prebuiltDrips";
import { DateTime } from "luxon";
import { acquireLock } from "@/lib/locks";

export const config = { maxDuration: 60 };

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;
const PER_LEAD_CONCURRENCY =
  Math.max(1, parseInt(process.env.DRIP_CONCURRENCY || "10", 10)) || 10;

/** -----------------------------
 *  Variant-key extraction helpers
 * ----------------------------- */
function normKey(k: string) {
  return String(k || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function candidateObjectsFromLead(lead: any): any[] {
  const cands: any[] = [];
  if (lead && typeof lead === "object") cands.push(lead);

  const maybeKeys = ["data", "fields", "customFields", "payload", "raw", "sheetRow", "row", "meta"];
  for (const key of maybeKeys) {
    const v = (lead as any)?.[key];
    if (v && typeof v === "object") cands.push(v);
  }

  const innerKeys = ["values", "record", "lead", "contact"];
  for (const obj of [...cands]) {
    for (const k of innerKeys) {
      const v = (obj as any)?.[k];
      if (v && typeof v === "object") cands.push(v);
    }
  }

  return Array.from(new Set(cands));
}

function pickByNormalizedKey(objs: any[], keySet: Set<string>): string | null {
  for (const obj of objs) {
    if (!obj || typeof obj !== "object") continue;
    for (const [k, v] of Object.entries(obj)) {
      if (!keySet.has(normKey(k))) continue;
      if (v == null) continue;
      const s = String(v).trim();
      if (!s) continue;
      return s;
    }
  }
  return null;
}

const PHONE_KEYS = new Set(["phone", "phonenumber", "mobile", "mobilenumber", "cell", "cellnumber", "telephone", "tel"]);
const FIRST_KEYS = new Set(["firstname", "first", "fname", "givenname", "given"]);
const LAST_KEYS = new Set(["lastname", "last", "lname", "surname", "familyname", "family"]);

function pickLeadPhoneRaw(lead: any): string | null {
  const objs = candidateObjectsFromLead(lead);
  const direct = (lead as any)?.Phone;
  if (direct != null && String(direct).trim()) return String(direct).trim();
  return pickByNormalizedKey(objs, PHONE_KEYS);
}
function pickLeadFirstName(lead: any): string | null {
  const objs = candidateObjectsFromLead(lead);
  const direct = (lead as any)?.["First Name"];
  if (direct != null && String(direct).trim()) return String(direct).trim();
  return pickByNormalizedKey(objs, FIRST_KEYS);
}
function pickLeadLastName(lead: any): string | null {
  const objs = candidateObjectsFromLead(lead);
  const direct = (lead as any)?.["Last Name"];
  if (direct != null && String(direct).trim()) return String(direct).trim();
  return pickByNormalizedKey(objs, LAST_KEYS);
}

/** ----------------------------- */

function isValidObjectId(id: string) {
  return /^[a-f0-9]{24}$/i.test(id);
}

async function resolveDrip(dripId: string) {
  if (isValidObjectId(dripId)) return await DripCampaign.findById(dripId).lean();
  const def = prebuiltDrips.find((d) => d.id === dripId);
  if (!def) return null;
  return await DripCampaign.findOne({ isGlobal: true, name: def.name }).lean();
}

function getCanonicalDripId(dripDoc: any, fallbackId: string): string {
  return String(dripDoc?._id ? dripDoc._id : fallbackId);
}

function parseStepDayNumber(dayField?: string): number {
  if (!dayField) return NaN;
  const raw = String(dayField).trim().toLowerCase();
  if (raw === "immediately" || raw === "immediate") return 0;
  const m = raw.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

/** ✅ NEW: stable step order before indexing by cursorStep */
function sortStepsStable(steps: Array<{ text?: string; day?: string }>) {
  const scored = steps.map((s, i) => {
    const n = parseStepDayNumber(s?.day);
    const score = isNaN(n) ? 999999 : n;
    return { s, i, score };
  });
  scored.sort((a, b) => (a.score - b.score) || (a.i - b.i));
  return scored.map((x) => x.s);
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

async function runBatched<T>(
  items: T[],
  batchSize: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let i = 0;
  while (i < items.length) {
    const batch = items.slice(i, i + batchSize);
    await Promise.allSettled(batch.map((item, idx) => worker(item, i + idx)));
    i += batchSize;
  }
}

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
    .set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 })
    .plus({ days: delta });
}
function computeStepWhenPT(startedAt: Date, dayNumber: number): DateTime {
  const startPT = DateTime.fromJSDate(startedAt, { zone: PT_ZONE }).startOf("day");
  const offsetDays = Math.max(0, dayNumber - 1);
  return startPT
    .plus({ days: offsetDays })
    .set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
}
function shouldRunWindowPT(): boolean {
  return DateTime.now().setZone(PT_ZONE).hour === SEND_HOUR_PT;
}

/**
 * Legacy <token> support
 */
const DEFAULT_AGENT_NAME = "your licensed agent";
const DEFAULT_AGENT_PHONE = "N/A";
const DEFAULT_FOLDER_NAME = "your campaign";

function getCurrentDate() {
  return new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
function getCurrentTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function applyLegacyTokens(
  message: string,
  options: {
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
    agentNameRaw?: string | null;
    agentFirst?: string | null;
    agentLast?: string | null;
    agentPhone?: string | null;
    folderName?: string | null;
  }
): string {
  const {
    firstName,
    lastName,
    fullName,
    agentNameRaw,
    agentFirst,
    agentLast,
    agentPhone,
    folderName,
  } = options;

  const effectiveAgentName = agentNameRaw || DEFAULT_AGENT_NAME;
  const effectiveAgentFirst = agentFirst || effectiveAgentName;
  const effectiveAgentLast = agentLast || "";
  const effectiveAgentPhone = agentPhone || DEFAULT_AGENT_PHONE;
  const effectiveFolderName = folderName || DEFAULT_FOLDER_NAME;

  let msg = message;

  msg = msg
    .replace(/<client_first_name>/gi, firstName || "")
    .replace(/<client_last_name>/gi, lastName || "")
    .replace(/<client_full_name>/gi, fullName || (firstName || ""))
    .replace(/<agent_name>/gi, effectiveAgentName)
    .replace(/<agent_first_name>/gi, effectiveAgentFirst)
    .replace(/<agent_phone>/gi, effectiveAgentPhone)
    .replace(/<folder_name>/gi, effectiveFolderName)
    .replace(/<current_date>/gi, getCurrentDate())
    .replace(/<current_time>/gi, getCurrentTime());

  return msg;
}

// ---------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ---------- AUTH SHIM ----------
  if (!["GET", "POST"].includes(req.method || "")) {
    res.setHeader("x-run-drips-auth", "bad-method");
    return res.status(405).json({ message: "Method not allowed" });
  }

  const secret = process.env.CRON_SECRET || "";
  const queryToken = (req.query?.token as string) || "";
  const headerToken = (req.headers["x-cron-key"] as string) || "";
  const vercelCron = Boolean(req.headers["x-vercel-cron"]);

  const authorized =
    (!!secret && (queryToken === secret || headerToken === secret)) || vercelCron;

  if (!authorized) {
    res.setHeader("x-run-drips-auth", "fail");
    res.setHeader("x-run-drips-secret-len", String(secret.length));
    res.setHeader("x-run-drips-query-token-len", String(queryToken?.length || 0));
    res.setHeader("x-run-drips-header-token-len", String(headerToken?.length || 0));
    res.setHeader("cache-control", "private, no-store, max-age=0");
    return res.status(401).json({
      ok: false,
      error: "unauthorized",
      hint: "pass ?token=CRON_SECRET, or header x-cron-key: CRON_SECRET, or run from a Vercel Cron (x-vercel-cron).",
    });
  }
  res.setHeader("x-run-drips-auth", "ok");

  // ---------- ORIGINAL LOGIC ----------
  if (process.env.DRIPS_HARD_STOP === "1") return res.status(204).end();

  const force = ["1", "true", "yes"].includes(
    String(req.query.force || "").toLowerCase()
  );
  const dry = ["1", "true", "yes"].includes(
    String(req.query.dry || "").toLowerCase()
  );
  const limit =
    Math.max(0, parseInt((req.query.limit as string) || "", 10) || 0);

  try {
    await dbConnect();

    const cronLockOk = await acquireLock("cron", "run-drips", 50);
    if (!cronLockOk && !force) {
      return res
        .status(200)
        .json({ message: "Already running, skipping this tick." });
    }

    const dueCount = await DripEnrollment.countDocuments({
      status: "active",
      nextSendAt: { $lte: new Date() },
      processing: { $ne: true }, // ✅ NEW: processing guard
      $and: [
        { $or: [{ active: { $ne: false } }, { isActive: true }, { enabled: true }] },
        { $or: [{ paused: { $ne: true } }, { isPaused: { $ne: true } }] },
        { stopAll: { $ne: true } },
      ],
    });

    const windowOK =
      force ||
      process.env.DRIPS_DEBUG_ALWAYS_RUN === "1" ||
      dueCount > 0 ||
      shouldRunWindowPT();
    if (!windowOK) {
      return res.status(200).json({
        message:
          "Not run window (expects 9:00 AM PT). Set DRIPS_DEBUG_ALWAYS_RUN=1 or ?force=1 to override.",
        nowPT: DateTime.now().setZone(PT_ZONE).toISO(),
        dueEnrollments: dueCount,
      });
    }

    const nowPT = DateTime.now().setZone(PT_ZONE);
    console.log(
      `🕘 run-drips start @ ${nowPT.toISO()} PT | force=${force} dry=${dry} limit=${
        limit || "∞"
      } due=${dueCount}`
    );

    // -------- PRIMARY: ENROLLMENT ENGINE --------
    let enrollChecked = 0,
      enrollSent = 0,
      enrollScheduled = 0,
      enrollSuppressed = 0,
      enrollFailed = 0,
      enrollCompleted = 0,
      enrollClaimMiss = 0,
      enrollAlreadySent = 0,
      enrollNoPhone = 0;

    const dueEnrollmentsQ = DripEnrollment.find({
      status: "active",
      nextSendAt: { $lte: new Date() },
      processing: { $ne: true }, // ✅ NEW
      $and: [
        { $or: [{ active: { $ne: false } }, { isActive: true }, { enabled: true }] },
        { $or: [{ paused: { $ne: true } }, { isPaused: { $ne: true } }] },
        { stopAll: { $ne: true } },
      ],
    })
      .select({
        _id: 1,
        leadId: 1,
        campaignId: 1,
        userEmail: 1,
        cursorStep: 1,
        nextSendAt: 1,
        sentAtByIndex: 1,
      })
      .lean();

    const dueEnrollments =
      limit > 0 ? await dueEnrollmentsQ.limit(limit) : await dueEnrollmentsQ;

    await runBatched(dueEnrollments, PER_LEAD_CONCURRENCY, async (enr) => {
      enrollChecked++;

      let claimedId: any = null;

      try {
        // Atomic claim
        const claim = await DripEnrollment.findOneAndUpdate(
          {
            _id: enr._id,
            status: "active",
            nextSendAt: { $lte: new Date() },
            cursorStep: enr.cursorStep ?? 0,
            processing: { $ne: true }, // ✅ NEW
            $and: [
              {
                $or: [
                  { active: { $ne: false } },
                  { isActive: true },
                  { enabled: true },
                ],
              },
              {
                $or: [
                  { paused: { $ne: true } },
                  { isPaused: { $ne: true } },
                ],
              },
              { stopAll: { $ne: true } },
            ],
          },
          { $set: { processing: true, processingAt: new Date() } },
          { new: true }
        ).lean();

        if (!claim) {
          enrollClaimMiss++;
          return;
        }

        claimedId = claim._id;

        const [lead, user, campaign] = await Promise.all([
          Lead.findById(claim.leadId).lean(),
          User.findOne({ email: claim.userEmail })
            .select({ _id: 1, email: 1, name: 1 })
            .lean(),
          (DripCampaign.findById(claim.campaignId)
            .select({
              _id: 1,
              name: 1,
              type: 1,
              isActive: 1,
              steps: 1,
            })
            .lean() as any),
        ]);

        if (
          !lead ||
          !user?._id ||
          !campaign ||
          (campaign as any).isActive !== true ||
          (campaign as any).type !== "sms"
        ) {
          // mark not processing and exit
          await DripEnrollment.updateOne(
            { _id: claim._id },
            { $set: { processing: false }, $unset: { processingAt: 1 } }
          );
          return;
        }

        const phoneRaw = pickLeadPhoneRaw(lead);
        const to = normalizeToE164Maybe(phoneRaw || undefined);

        if (!to) {
          enrollNoPhone++;
          await DripEnrollment.updateOne(
            { _id: claim._id },
            {
              $set: { processing: false, lastError: "missing_phone" },
              $unset: { processingAt: 1 },
            }
          );
          return;
        }

        const { first: agentFirst, last: agentLast } = splitName(user.name || "");
        const firstName = pickLeadFirstName(lead);
        const lastName = pickLeadLastName(lead);
        const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

        const agentCtx = {
          name: user.name || null,
          first_name: agentFirst,
          last_name: agentLast,
        };

        // ✅ NEW: stable order before indexing by cursorStep
        const stepsRaw: Array<{ text?: string; day?: string }> = Array.isArray((campaign as any).steps)
          ? (campaign as any).steps
          : [];
        const steps = sortStepsStable(stepsRaw);

        const idx = Math.max(0, Number(claim.cursorStep || 0));
        const step = steps[idx];

        if (!step) {
          await DripEnrollment.updateOne(
            { _id: claim._id },
            {
              $set: { status: "completed", processing: false },
              $unset: { nextSendAt: 1, processingAt: 1 },
            }
          );
          enrollCompleted++;
          return;
        }

        // once-only: skip if already marked sent
        let alreadySent = false;
        const sentMap = (claim as any)?.sentAtByIndex;
        if (sentMap) {
          if (sentMap instanceof Map) alreadySent = !!sentMap.get(String(idx));
          else if (typeof sentMap === "object") alreadySent = !!(sentMap as any)[String(idx)];
        }

        if (alreadySent) {
          const nextIndex = idx + 1;
          const update: any = {
            $set: { cursorStep: nextIndex, processing: false, lastSentAt: new Date() },
            $unset: { processingAt: 1 },
          };

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

          await DripEnrollment.updateOne({ _id: claim._id, cursorStep: idx }, update);
          enrollAlreadySent++;
          return;
        }

        let rendered = renderTemplate(String(step.text || ""), {
          contact: { first_name: firstName, last_name: lastName, full_name: fullName },
          agent: agentCtx,
        });

        rendered = applyLegacyTokens(rendered, {
          firstName,
          lastName,
          fullName,
          agentNameRaw: user.name || null,
          agentFirst,
          agentLast,
          agentPhone: null,
          folderName: null,
        });

        const finalBody = ensureOptOut(rendered);

        const idKey = `${String(claim._id)}:${idx}:${new Date(
          claim.nextSendAt || Date.now()
        ).toISOString()}`;

        // Still active right before send
        const fresh = await DripEnrollment.findById(claim._id)
          .select({ status: 1, stopAll: 1, paused: 1, isPaused: 1 })
          .lean();

        if (
          !fresh ||
          fresh.status !== "active" ||
          fresh.stopAll === true ||
          fresh.paused === true ||
          fresh.isPaused === true
        ) {
          await DripEnrollment.updateOne(
            { _id: claim._id },
            { $set: { processing: false }, $unset: { processingAt: 1 } }
          );
          return;
        }

        try {
          if (!dry) {
            const lockKey = `${String(user.email)}:${String((lead as any)._id)}:${String(
              (campaign as any)._id
            )}:${String(idx)}`;

            const ok = await acquireLock("enroll", lockKey, 600);

            if (ok) {
              const result = await sendSms({
                to,
                body: finalBody,
                userEmail: user.email,
                leadId: String((lead as any)._id),
                idempotencyKey: idKey,
                enrollmentId: String(claim._id),
                campaignId: String((campaign as any)._id),
                stepIndex: idx,
              });

              if (result?.scheduledAt) enrollScheduled++;
              else if (result?.sid) enrollSent++;
              else enrollSuppressed++;
            } else {
              enrollSuppressed++;
            }
          }
        } catch (err: any) {
          enrollFailed++;
          await DripEnrollment.updateOne(
            { _id: claim._id },
            { $set: { lastError: err?.message || "send_failed" } }
          );
        }

        const nextIndex = idx + 1;

        const update: any = {
          $set: {
            cursorStep: nextIndex,
            processing: false,
            [`sentAtByIndex.${idx}`]: new Date(),
            lastSentAt: new Date(),
          },
          $unset: { processingAt: 1, lastError: 1 }, // ✅ NEW: reliably clear lastError
        };

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

        await DripEnrollment.updateOne({ _id: claim._id, cursorStep: idx }, update);
      } finally {
        // ✅ NEW: best-effort safety clear if anything exited unexpectedly
        if (claimedId) {
          await DripEnrollment.updateOne(
            { _id: claimedId, processing: true },
            { $set: { processing: false }, $unset: { processingAt: 1 } }
          );
        }
      }
    });

    // legacy block unchanged (you already gate it)
    const legacyEnabled = process.env.DRIPS_LEGACY_ENABLED === "1";

    return res.status(200).json({
      message: "run-drips complete",
      nowPT: DateTime.now().setZone(PT_ZONE).toISO(),
      forced: force,
      dryRun: dry,
      limit,
      stats: {
        primary: {
          enrollChecked,
          enrollSent,
          enrollScheduled,
          enrollSuppressed,
          enrollFailed,
          enrollCompleted,
          enrollClaimMiss,
          enrollAlreadySent,
          enrollNoPhone,
        },
        legacyEnabled,
      },
    });
  } catch (error: any) {
    console.error("❌ run-drips error:", error);
    return res.status(500).json({ message: "Server error", detail: error?.message || "Unknown error" });
  }
}
