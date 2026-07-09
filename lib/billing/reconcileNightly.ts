import AICallRecording from "@/models/AICallRecording";
import AICallUsageLedger from "@/models/AICallUsageLedger";
import BillingEvent from "@/models/BillingEvent";
import Call from "@/models/Call";
import UsageAccrualLedger from "@/models/UsageAccrualLedger";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import { getPlatformTwilioClientScoped } from "@/lib/twilio/getPlatformClient";

export type ReconciliationWindow = { start: Date; end: Date; label: string };

type TwilioCallResult =
  | { ok: true; durationSec: number }
  | { ok: false; reason: "not_found" | "fetch_error"; error?: string };

function asNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function ceilMinutes(seconds: number) {
  return seconds > 0 ? Math.ceil(seconds / 60) : 0;
}

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function previousUtcDayWindow(now = new Date()): ReconciliationWindow {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start, end, label: start.toISOString().slice(0, 10) };
}

export function utcDayWindow(day: string): ReconciliationWindow | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000), label: day };
}

async function fetchTwilioCall(args: {
  client: any;
  callSid: string;
}): Promise<TwilioCallResult> {
  try {
    const call = await args.client.calls(args.callSid).fetch();
    return { ok: true, durationSec: Math.max(0, asNumber((call as any)?.duration)) };
  } catch (error: any) {
    const status = Number(error?.status || error?.statusCode || 0);
    return {
      ok: false,
      reason: status === 404 ? "not_found" : "fetch_error",
      error: String(error?.message || error).slice(0, 300),
    };
  }
}

function allocateFifo(args: { events: any[]; accruals: any[]; bucket: "regular" | "ai_voice" }) {
  const rows = args.accruals
    .filter((row) => row.bucket === args.bucket)
    .map((row) => ({
      remainingCents: Math.max(0, asNumber(row.billedCents)),
      eventKey: String(row.eventKey || ""),
    }));
  let cursor = 0;

  return args.events.map((event) => {
    let remaining = Math.max(0, asNumber(event.amountCents));
    let allocatedCents = 0;
    const eventKeys: string[] = [];
    while (remaining > 0 && cursor < rows.length) {
      const row = rows[cursor];
      if (row.remainingCents <= 0) {
        cursor += 1;
        continue;
      }
      const take = Math.min(remaining, row.remainingCents);
      row.remainingCents -= take;
      remaining -= take;
      allocatedCents += take;
      if (row.eventKey) eventKeys.push(row.eventKey);
      if (row.remainingCents <= 0) cursor += 1;
    }
    return { event, allocatedCents, unallocatedCents: remaining, eventKeys };
  });
}

export async function reconcileBillingForTenant(args: {
  userEmail: string;
  window: ReconciliationWindow;
}) {
  const userEmail = normalizeEmail(args.userEmail);
  const user = await User.findOne({ email: userEmail })
    .select("email twilio.accountSid stripeCustomerId")
    .lean();
  if (!user) throw new Error("Tenant user not found");

  const accountSid = String((user as any)?.twilio?.accountSid || process.env.TWILIO_ACCOUNT_SID || "");
  const twilioClient = getPlatformTwilioClientScoped(accountSid);
  const inWindow = { $gte: args.window.start, $lt: args.window.end };

  const [aiLedgers, manualCalls, transferredRecordings, billingEventsThroughWindow, billedAccruals] = await Promise.all([
    AICallUsageLedger.find({ userEmail, createdAt: inWindow }).lean(),
    Call.find({
      userEmail,
      billedAt: inWindow,
      billedSource: "manual_dial_connected_duration",
    }).lean(),
    AICallRecording.find({ userEmail, outcome: "transferred", updatedAt: inWindow }).lean(),
    BillingEvent.find({ userEmail, createdAt: { $lt: args.window.end } })
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
    UsageAccrualLedger.find({ userEmail, status: "billed", billedAt: { $lt: args.window.end } })
      .sort({ billedAt: 1, accruedAt: 1, _id: 1 })
      .lean(),
  ]);

  const aiFindings: any[] = [];
  for (const ledger of aiLedgers as any[]) {
    const callSid = String(ledger.callSid || "");
    const twilio = callSid ? await fetchTwilioCall({ client: twilioClient, callSid }) : { ok: false as const, reason: "not_found" as const };
    if (!twilio.ok) {
      aiFindings.push({
        type: "AI_LEDGER_MISSING_TWILIO",
        callSid,
        idempotencyKey: ledger.idempotencyKey,
        reason: twilio.reason,
        error: twilio.error || null,
      });
      continue;
    }
    const ledgerBillableMinutes = asNumber(ledger.billableMinutes);
    const twilioBilledMinutes = ceilMinutes(twilio.durationSec);
    const rawSecondDelta = asNumber(ledger.durationSec) - twilio.durationSec;
    if (ledgerBillableMinutes > twilioBilledMinutes) {
      aiFindings.push({
        type: "AI_METER_OVER_TWILIO",
        callSid,
        idempotencyKey: ledger.idempotencyKey,
        ledgerBillableMinutes,
        twilioBilledMinutes,
        ledgerDurationSec: asNumber(ledger.durationSec),
        twilioDurationSec: twilio.durationSec,
        rawSecondDelta,
      });
    } else if (Math.abs(rawSecondDelta) > 5) {
      aiFindings.push({
        type: "AI_METER_RAW_DURATION_DELTA",
        callSid,
        idempotencyKey: ledger.idempotencyKey,
        ledgerDurationSec: asNumber(ledger.durationSec),
        twilioDurationSec: twilio.durationSec,
        rawSecondDelta,
        toleranceSeconds: 5,
      });
    }
  }

  const manualFindings: any[] = [];
  for (const call of manualCalls as any[]) {
    const callSid = String(call.callSid || "");
    const twilio = callSid ? await fetchTwilioCall({ client: twilioClient, callSid }) : { ok: false as const, reason: "not_found" as const };
    if (!twilio.ok) {
      manualFindings.push({ type: "MANUAL_CALL_MISSING_TWILIO", callSid, reason: twilio.reason, error: twilio.error || null });
      continue;
    }
    const internalBilledMinutes = ceilMinutes(asNumber(call.billableSeconds));
    const twilioBilledMinutes = ceilMinutes(twilio.durationSec);
    const rawSecondDelta = asNumber(call.billableSeconds) - twilio.durationSec;
    if (internalBilledMinutes > twilioBilledMinutes) {
      manualFindings.push({
        type: "MANUAL_METER_OVER_TWILIO",
        callSid,
        internalBilledMinutes,
        twilioBilledMinutes,
        billableSeconds: asNumber(call.billableSeconds),
        twilioDurationSec: twilio.durationSec,
        rawSecondDelta,
      });
    } else if (Math.abs(rawSecondDelta) > 5) {
      manualFindings.push({
        type: "MANUAL_METER_RAW_DURATION_DELTA",
        callSid,
        billableSeconds: asNumber(call.billableSeconds),
        twilioDurationSec: twilio.durationSec,
        rawSecondDelta,
        toleranceSeconds: 5,
      });
    }
  }

  const transferGapCandidates: any[] = [];
  for (const recording of transferredRecordings as any[]) {
    const leadCallSid = String(recording.callSid || "");
    const [twilio, humanLeg] = await Promise.all([
      leadCallSid ? fetchTwilioCall({ client: twilioClient, callSid: leadCallSid }) : Promise.resolve({ ok: false as const, reason: "not_found" as const }),
      Call.findOne({
        userEmail,
        billedAt: { $ne: null },
        $or: [{ parentCallSid: leadCallSid }, { dialCallSid: leadCallSid }, { pstnCallSid: leadCallSid }],
      }).lean(),
    ]);
    if (!humanLeg) {
      transferGapCandidates.push({
        type: "TRANSFER_GAP_UNRESOLVED_CORRELATION",
        leadCallSid,
        recordingId: String(recording._id),
        transferOutcomeAt: recording.updatedAt,
        twilioLeadDurationSec: twilio.ok ? twilio.durationSec : null,
        twilioFetchReason: twilio.ok ? null : twilio.reason,
        note: "No persisted human-leg billing record is linked by parentCallSid, dialCallSid, or pstnCallSid.",
      });
    }
  }

  const billingEvents = (billingEventsThroughWindow as any[]).filter((event) => event.createdAt >= args.window.start);
  const regularEvents = (billingEventsThroughWindow as any[]).filter((event) => event.source === "regular_usage");
  const aiEvents = (billingEventsThroughWindow as any[]).filter((event) => ["ai_voice_session", "ai_voice_call", "ai_transcript"].includes(event.source));
  const reconciledBatches = [
    ...allocateFifo({ events: regularEvents, accruals: billedAccruals as any[], bucket: "regular" }),
    ...allocateFifo({ events: aiEvents, accruals: billedAccruals as any[], bucket: "ai_voice" }),
  ];
  const stripeBatchCoverage = await Promise.all(reconciledBatches
    .filter((entry) => entry.event.createdAt >= args.window.start)
    .map(async (entry) => {
    const event = entry.event as any;
    let stripeInvoiceItemAmountCents: number | null = null;
    let stripeFetchError: string | null = null;
    if (event.stripeInvoiceItemId) {
      try {
        const item = await stripe.invoiceItems.retrieve(String(event.stripeInvoiceItemId));
        stripeInvoiceItemAmountCents = asNumber((item as any).amount);
      } catch (error: any) {
        stripeFetchError = String(error?.message || error).slice(0, 300);
      }
    }
    const internalMatchesBillingEvent = entry.allocatedCents === asNumber(event.amountCents) && entry.unallocatedCents === 0;
    const stripeItemExpected = ["stripe_created", "paid"].includes(String(event.status || ""));
    const stripeMatchesBillingEvent = !stripeItemExpected || (
      stripeInvoiceItemAmountCents === asNumber(event.amountCents) && !stripeFetchError
    );
    return {
      billingEventId: String(event._id),
      source: event.source,
      sourceId: event.sourceId,
      status: event.status,
      amountCents: asNumber(event.amountCents),
      allocatedInternalAccrualCents: entry.allocatedCents,
      unallocatedInternalAccrualCents: entry.unallocatedCents,
      stripeInvoiceItemId: event.stripeInvoiceItemId || null,
      stripeInvoiceId: event.stripeInvoiceId || null,
      stripeInvoiceItemAmountCents,
      stripeFetchError,
      stripeItemExpected,
      match: internalMatchesBillingEvent && stripeMatchesBillingEvent && !stripeFetchError,
      allocationMethod: "fifo_reconstructed_from_billed_accruals",
      sampledEventKeys: entry.eventKeys.slice(0, 25),
    };
    }));

  return {
    readOnly: true,
    userEmail,
    window: { start: args.window.start.toISOString(), end: args.window.end.toISOString(), label: args.window.label },
    summary: {
      aiLedgerRows: aiLedgers.length,
      manualBilledCalls: manualCalls.length,
      transferredCalls: transferredRecordings.length,
      billingEvents: billingEvents.length,
      aiFindings: aiFindings.length,
      manualFindings: manualFindings.length,
      transferGapCandidates: transferGapCandidates.length,
      stripeBatchMismatches: stripeBatchCoverage.filter((row) => !row.match).length,
    },
    aiFindings,
    manualFindings,
    stripeBatchCoverage,
    transferGapCandidates,
  };
}
