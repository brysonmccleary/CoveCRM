// lib/drips/createScheduledDripMessages.ts
//
// Creates ScheduledDripMessage records for all eligible steps in a drip
// enrollment. Called at enrollment time — never by the worker.
//
// Uses insertMany({ ordered: false }) so partial re-runs don't fail on
// idempotencyKey conflicts; already-existing records are silently skipped.

import dbConnect from "@/lib/mongooseConnect";
import ScheduledDripMessage from "@/models/ScheduledDripMessage";
import {
  computeScheduledDripSendAt,
  isBirthdayStep,
  parseLegacyDayField,
  resolveLeadTimezone,
} from "./computeScheduledDripSendAt";
import { renderTemplate, ensureOptOut, splitName } from "@/utils/renderTemplate";
import mongoose from "mongoose";

// ── Template token helper ────────────────────────────────────────────────────

function applyLegacyTokens(
  message: string,
  opts: {
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
    agentName?: string | null;
    agentFirst?: string | null;
    agentLast?: string | null;
  }
): string {
  const agentName = opts.agentName || "your licensed agent";
  const agentFirst = opts.agentFirst || agentName;
  return message
    .replace(/<client_first_name>/gi, opts.firstName || "")
    .replace(/<client_last_name>/gi, opts.lastName || "")
    .replace(/<client_full_name>/gi, opts.fullName || opts.firstName || "")
    .replace(/<agent_name>/gi, agentName)
    .replace(/<agent_first_name>/gi, agentFirst);
}

// ── Main export ──────────────────────────────────────────────────────────────

export interface CreateScheduledDripMessagesParams {
  enrollmentId: string | mongoose.Types.ObjectId;
  campaignId: string | mongoose.Types.ObjectId;
  leadId: string | mongoose.Types.ObjectId;
  userEmail: string;
  enrolledAt: Date;
  leadPhone: string;          // E.164
  leadFirstName?: string | null;
  leadLastName?: string | null;
  leadState?: string | null;
  agentName?: string | null;
  campaignIsGlobal?: boolean;
  campaignKey?: string | null;
  steps: Array<{
    _id?: any;
    text?: string;
    day?: string;
    delayValue?: number | null;
    delayUnit?: string | null;
  }>;
  /** 0-based index of the first step to register (default: 1 — skip step 0, already sent by enroll-lead) */
  startFromIndex?: number;
}

/**
 * Register future drip messages for a V2 enrollment.
 * Step 0 is sent immediately by enroll-lead.ts and skipped here by default.
 * Returns the count of records successfully inserted.
 */
export async function createScheduledDripMessages(
  params: CreateScheduledDripMessagesParams
): Promise<number> {
  await dbConnect();

  const {
    enrollmentId,
    campaignId,
    leadId,
    userEmail,
    enrolledAt,
    leadPhone,
    leadFirstName,
    leadLastName,
    leadState,
    agentName,
    campaignIsGlobal,
    campaignKey,
    steps,
    startFromIndex = 1,
  } = params;

  if (!Array.isArray(steps) || steps.length === 0) return 0;

  const enrollmentOid = new mongoose.Types.ObjectId(String(enrollmentId));
  const campaignOid = new mongoose.Types.ObjectId(String(campaignId));
  const leadOid = new mongoose.Types.ObjectId(String(leadId));

  const { first: agentFirst, last: agentLast } = splitName(agentName || "");
  const fullName = [leadFirstName, leadLastName].filter(Boolean).join(" ") || null;
  const appendOptOut = Boolean(campaignIsGlobal || (campaignKey && String(campaignKey).trim()));

  const docs: any[] = [];

  for (let idx = startFromIndex; idx < steps.length; idx++) {
    const step = steps[idx];
    if (!step) continue;

    // Skip birthday steps — V2 does not schedule them
    if (isBirthdayStep(step.day)) {
      console.log(`[createScheduledDripMessages] Skipping birthday step at index ${idx}`);
      continue;
    }

    // Compute sendAt
    const delayValue = step.delayValue != null ? Number(step.delayValue) : null;
    const delayUnit = (step.delayUnit as any) || null;

    const sendAt = computeScheduledDripSendAt({
      enrolledAt,
      step: { delayValue, delayUnit, day: step.day },
      leadState,
    });

    if (!sendAt) {
      console.warn(`[createScheduledDripMessages] Could not compute sendAt for step ${idx} — skipping`);
      continue;
    }

    // Render body snapshot at enrollment time
    const rawText = String(step.text || "").trim();
    let rendered = renderTemplate(rawText, {
      contact: { first_name: leadFirstName, last_name: leadLastName, full_name: fullName },
      agent: { name: agentName, first_name: agentFirst, last_name: agentLast },
    });
    rendered = applyLegacyTokens(rendered, {
      firstName: leadFirstName,
      lastName: leadLastName,
      fullName,
      agentName,
      agentFirst,
      agentLast,
    });
    const bodySnapshot = ensureOptOut(rendered, { appendOptOut });

    const stepId = step._id ? String(step._id) : `idx:${idx}`;
    const idempotencyKey = `sdm:${String(enrollmentId)}:${idx}`;

    // Resolve parsed unit for display storage
    let resolvedUnit = delayUnit;
    let resolvedValue = delayValue;
    if (!resolvedUnit && step.day) {
      const parsed = parseLegacyDayField(step.day);
      if (parsed) {
        resolvedValue = parsed.value;
        resolvedUnit = parsed.unit;
      }
    }

    docs.push({
      userEmail,
      leadId: leadOid,
      campaignId: campaignOid,
      enrollmentId: enrollmentOid,
      stepId,
      stepIndex: idx,
      bodySnapshot,
      toNumber: leadPhone,
      sendAt,
      timezone: require("@/lib/drips/computeScheduledDripSendAt").resolveLeadTimezone(leadState),
      delayValue: resolvedValue ?? undefined,
      delayUnit: resolvedUnit ?? undefined,
      status: "pending",
      attempts: 0,
      idempotencyKey,
    });
  }

  if (docs.length === 0) return 0;

  try {
    const result = await ScheduledDripMessage.insertMany(docs, { ordered: false });
    return result.length;
  } catch (err: any) {
    // ordered:false — bulk write errors include both successes and failures.
    // Idempotency key conflicts (code 11000) are expected on re-runs.
    const inserted = (err as any)?.result?.nInserted ?? 0;
    const writeErrors: any[] = (err as any)?.writeErrors || [];
    const nonDupeErrors = writeErrors.filter((e: any) => e?.code !== 11000);
    if (nonDupeErrors.length > 0) {
      console.error("[createScheduledDripMessages] Non-dedup errors:", nonDupeErrors);
    }
    return inserted;
  }
}
