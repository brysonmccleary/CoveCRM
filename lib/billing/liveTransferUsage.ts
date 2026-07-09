import mongoose from "mongoose";
import LiveTransferUsageLedger from "@/models/LiveTransferUsageLedger";
import User from "@/models/User";
import { MANUAL_TALK_RATE_PER_MIN } from "@/lib/billing/dialerRates";
import { trackUsage } from "@/lib/billing/trackUsage";

const LIVE_TRANSFER_BILLING_ENABLED =
  String(process.env.LIVE_TRANSFER_BILLING_ENABLED || "").trim().toLowerCase() === "true";
const MAX_LIVE_TRANSFER_BILLABLE_SECONDS = 6 * 60 * 60;

function objectIdOrNull(value?: string) {
  return value && mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null;
}

function callbackTime(value?: string) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}

export async function createLiveTransferUsageLedger(args: {
  userEmail: string;
  sessionId?: string;
  leadId?: string;
  leadCallSid: string;
  agentCallSid: string;
  conferenceName: string;
  transferInitiatedAt: Date;
}) {
  const idempotencyKey = `live_transfer:${args.agentCallSid}`;
  return LiveTransferUsageLedger.findOneAndUpdate(
    { idempotencyKey },
    {
      $setOnInsert: {
        userEmail: String(args.userEmail).toLowerCase(),
        aiCallSessionId: objectIdOrNull(args.sessionId),
        leadId: objectIdOrNull(args.leadId),
        leadCallSid: args.leadCallSid,
        agentCallSid: args.agentCallSid,
        conferenceName: args.conferenceName,
        transferInitiatedAt: args.transferInitiatedAt,
        agentAnsweredAt: null,
        endedAt: null,
        billableSeconds: 0,
        billableMinutes: 0,
        ratePerMinute: MANUAL_TALK_RATE_PER_MIN,
        amountCents: 0,
        status: "pending",
        stripeInvoiceItemId: null,
        idempotencyKey,
        runawayCapped: false,
      },
    },
    { upsert: true, new: true },
  ).exec();
}

export async function markLiveTransferAgentAnswered(args: {
  agentCallSid: string;
  answeredAt?: string;
}) {
  return LiveTransferUsageLedger.findOneAndUpdate(
    {
      agentCallSid: args.agentCallSid,
      status: "pending",
      agentAnsweredAt: null,
    },
    {
      $set: {
        agentAnsweredAt: callbackTime(args.answeredAt),
        status: "metering",
      },
    },
    { new: true },
  ).exec();
}

export async function markLiveTransferNoHumanAnswer(agentCallSid: string) {
  return LiveTransferUsageLedger.findOneAndUpdate(
    { agentCallSid, status: "pending" },
    { $set: { status: "no_human_answer", endedAt: new Date() } },
    { new: true },
  ).exec();
}

export async function finalizeLiveTransferUsage(args: {
  agentCallSid: string;
  endedAt?: string;
}) {
  const endedAt = callbackTime(args.endedAt);
  const claimed = await LiveTransferUsageLedger.findOneAndUpdate(
    {
      agentCallSid: args.agentCallSid,
      status: "metering",
      agentAnsweredAt: { $ne: null },
    },
    { $set: { status: "finalizing", endedAt } },
    { new: true },
  ).exec();
  if (!claimed) return null;

  const rawElapsedSeconds = Math.max(
    0,
    Math.floor((endedAt.getTime() - new Date(claimed.agentAnsweredAt as Date).getTime()) / 1000),
  );
  const billableSeconds = Math.min(rawElapsedSeconds, MAX_LIVE_TRANSFER_BILLABLE_SECONDS);
  const billableMinutes = billableSeconds > 0 ? Math.ceil(billableSeconds / 60) : 0;
  const amountCents = Math.round(billableMinutes * MANUAL_TALK_RATE_PER_MIN * 100);
  const runawayCapped = rawElapsedSeconds > MAX_LIVE_TRANSFER_BILLABLE_SECONDS;

  if (!LIVE_TRANSFER_BILLING_ENABLED) {
    return LiveTransferUsageLedger.findOneAndUpdate(
      { _id: claimed._id, status: "finalizing" },
      {
        $set: {
          billableSeconds,
          billableMinutes,
          amountCents,
          runawayCapped,
          status: "recorded_not_billed",
        },
      },
      { new: true },
    ).exec();
  }

  try {
    const user = await User.findOne({ email: claimed.userEmail }).exec();
    if (!user) throw new Error("Live transfer billing owner not found");
    if (amountCents > 0) {
      await trackUsage({
        user,
        amount: amountCents / 100,
        source: "twilio-voice",
        eventKey: claimed.idempotencyKey,
        metadata: {
          billingKind: "live_transfer_human_leg",
          leadCallSid: claimed.leadCallSid,
          agentCallSid: claimed.agentCallSid,
          conferenceName: claimed.conferenceName,
          billableSeconds,
          billableMinutes,
          ratePerMinute: MANUAL_TALK_RATE_PER_MIN,
        },
      });
    }
    return LiveTransferUsageLedger.findOneAndUpdate(
      { _id: claimed._id, status: "finalizing" },
      {
        $set: {
          billableSeconds,
          billableMinutes,
          amountCents,
          runawayCapped,
          status: "accrued",
        },
      },
      { new: true },
    ).exec();
  } catch (error: any) {
    await LiveTransferUsageLedger.updateOne(
      { _id: claimed._id, status: "finalizing" },
      {
        $set: {
          billableSeconds,
          billableMinutes,
          amountCents,
          runawayCapped,
          status: "failed",
        },
      },
    ).exec();
    throw error;
  }
}
