// lib/sms/sendMissedCallText.ts
// Missed-call text-back: when an inbound call goes unanswered, automatically
// text the caller back. Mirrors sendMissedInboundCallEmailOnce's shape
// (pages/api/twilio/voice-status.ts) — same InboundCall-based atomic dedup
// pattern, gated on its own field (missedTextSentAt) so this never double-sends
// on a webhook retry and never interferes with the existing email dedup.
import InboundCall from "@/models/InboundCall";
import AISettings from "@/models/AISettings";
import { sendSMS } from "@/lib/twilio/sendSMS";
import { withStopFooter } from "@/lib/sms/complianceFooter";

const MISSED_CALL_STATES = new Set(["busy", "failed", "no-answer", "canceled"]);

const MISSED_CALL_TEXT_BODY =
  "Sorry we missed your call! We'll try you again shortly — feel free to call or text us back anytime.";

async function isMissedCallTextBackEnabled(ownerEmail: string): Promise<boolean> {
  if (!ownerEmail) return false;
  const settings = await (AISettings as any)
    .findOne({ userEmail: ownerEmail })
    .select({ missedCallTextBackEnabled: 1 })
    .lean();
  return settings?.missedCallTextBackEnabled === true;
}

export async function sendMissedCallTextOnce(opts: {
  callSid: string;
  status: string;
  ownerEmail?: string;
  from?: string;
  leadId?: string;
}) {
  if (!MISSED_CALL_STATES.has(opts.status) || !opts.callSid) return;

  // Off by default — check the toggle before claiming the one-time dedup
  // slot below, so leaving the feature off never burns it for a lead.
  const ownerEmailHint = String(opts.ownerEmail || "").toLowerCase();
  if (ownerEmailHint && !(await isMissedCallTextBackEnabled(ownerEmailHint))) return;

  const claimAt = new Date();
  const staleClaimBefore = new Date(claimAt.getTime() - 5 * 60 * 1000);
  const inbound = await (InboundCall as any)
    .findOneAndUpdate(
      {
        callSid: opts.callSid,
        $and: [
          { $or: [{ missedTextSentAt: null }, { missedTextSentAt: { $exists: false } }] },
          { $or: [{ missedTextSendingAt: null }, { missedTextSendingAt: { $exists: false } }, { missedTextSendingAt: { $lt: staleClaimBefore } }] },
        ],
      },
      { $set: { missedTextSendingAt: claimAt } },
      { new: false },
    )
    .lean();
  if (!inbound) return;

  const ownerEmail = String(inbound?.ownerEmail || opts.ownerEmail || "").toLowerCase();
  const to = String(inbound?.from || opts.from || "").trim();
  if (!ownerEmail || !to) {
    await (InboundCall as any).updateOne(
      { callSid: opts.callSid, missedTextSendingAt: claimAt },
      { $unset: { missedTextSendingAt: "" } },
    );
    return;
  }

  // Fallback check for the rare case the caller had no ownerEmail hint yet.
  if (!ownerEmailHint && !(await isMissedCallTextBackEnabled(ownerEmail))) {
    await (InboundCall as any).updateOne(
      { callSid: opts.callSid, missedTextSendingAt: claimAt },
      { $unset: { missedTextSendingAt: "" } },
    );
    return;
  }

  try {
    await sendSMS(to, withStopFooter(MISSED_CALL_TEXT_BODY), ownerEmail, {
      source: "missed_call_text_back",
      leadId: inbound?.leadId ? String(inbound.leadId) : opts.leadId || undefined,
    });
    await (InboundCall as any).updateOne(
      { callSid: opts.callSid, missedTextSendingAt: claimAt },
      { $set: { missedTextSentAt: new Date() }, $unset: { missedTextSendingAt: "" } },
    );
  } catch (error) {
    await (InboundCall as any).updateOne(
      { callSid: opts.callSid, missedTextSendingAt: claimAt },
      { $unset: { missedTextSendingAt: "" } },
    ).catch(() => undefined);
    throw error;
  }
}
