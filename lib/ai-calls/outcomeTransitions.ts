import { Types } from "mongoose";
import AICallRecording from "@/models/AICallRecording";
import AICallSession from "@/models/AICallSession";

export type AICallTerminalOutcome =
  | "booked"
  | "not_interested"
  | "no_answer"
  | "callback"
  | "do_not_call"
  | "disconnected"
  | "transferred"
  | "voicemail";

const OUTCOME_PRIORITY: Record<string, number> = {
  unknown: 0,
  disconnected: 1,
  no_answer: 2,
  voicemail: 2,
  callback: 4,
  not_interested: 4,
  do_not_call: 4,
  transferred: 4,
  booked: 5,
};

const STAT_FIELDS = new Set([
  "booked",
  "not_interested",
  "no_answer",
  "callback",
  "do_not_call",
  "disconnected",
  "transferred",
  "voicemail",
  "skipped",
]);

export function normalizeAICallOutcome(raw: any): AICallTerminalOutcome | "unknown" | null {
  const outcome = String(raw || "").trim().toLowerCase();
  if (!outcome) return null;
  if (outcome === "callback_requested") return "callback";
  if (
    outcome === "unknown" ||
    outcome === "booked" ||
    outcome === "not_interested" ||
    outcome === "no_answer" ||
    outcome === "callback" ||
    outcome === "do_not_call" ||
    outcome === "disconnected" ||
    outcome === "transferred" ||
    outcome === "voicemail"
  ) {
    return outcome;
  }
  return null;
}

function priority(outcome: string) {
  return OUTCOME_PRIORITY[outcome] ?? 0;
}

function lowerPriorityOutcomes(nextOutcome: string) {
  const nextPriority = priority(nextOutcome);
  return Object.entries(OUTCOME_PRIORITY)
    .filter(([, p]) => p < nextPriority)
    .map(([outcome]) => outcome);
}

function buildStatsInc(prevOutcome: string, nextOutcome: string) {
  const prev = normalizeAICallOutcome(prevOutcome) || "unknown";
  const next = normalizeAICallOutcome(nextOutcome) || "unknown";
  const inc: Record<string, number> = {};

  if (prev === next) return inc;

  if (prev !== "unknown" && STAT_FIELDS.has(prev)) {
    inc[`stats.${prev}`] = (inc[`stats.${prev}`] || 0) - 1;
  }
  if (next !== "unknown" && STAT_FIELDS.has(next)) {
    inc[`stats.${next}`] = (inc[`stats.${next}`] || 0) + 1;
  }

  if (prev === "unknown" && next !== "unknown") {
    inc["stats.completed"] = (inc["stats.completed"] || 0) + 1;
  } else if (prev !== "unknown" && next === "unknown") {
    inc["stats.completed"] = (inc["stats.completed"] || 0) - 1;
  }

  return inc;
}

export async function maybeMarkAICallSessionCompleted(args: {
  sessionId: string | Types.ObjectId;
  userEmail?: string | null;
}) {
  const sessionId = args.sessionId;
  const filter: Record<string, any> = { _id: sessionId };
  if (args.userEmail) filter.userEmail = String(args.userEmail).toLowerCase();

  const session: any = await AICallSession.findOne(filter)
    .select("status total leadIds stats activeCallSid")
    .lean();

  if (!session || session.status === "completed") {
    return { completed: false, reason: "not_found_or_already_completed" };
  }

  const leadCount = Array.isArray(session.leadIds) ? session.leadIds.length : 0;
  const total = typeof session.total === "number" ? session.total : leadCount;
  const completed = Number(session.stats?.completed || 0);
  const skipped = Number(session.stats?.skipped || 0);
  const activeCallSid = String(session.activeCallSid || "").trim();

  if (total > 0 && completed + skipped >= total && !activeCallSid) {
    const updated = await AICallSession.updateOne(
      { ...filter, status: { $ne: "completed" } },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    ).exec();

    return {
      completed: ((updated as any)?.modifiedCount ?? 0) > 0,
      reason: "threshold_met",
      total,
      accountedFor: completed + skipped,
    };
  }

  return {
    completed: false,
    reason: "threshold_not_met",
    total,
    accountedFor: completed + skipped,
    hasActiveCall: !!activeCallSid,
  };
}

export async function transitionAICallRecordingOutcome(args: {
  callSid: string;
  outcome: any;
  outcomeSource?: string;
  userEmail?: string | null;
  aiCallSessionId?: string | Types.ObjectId | null;
  allowHigherPriorityOverride?: boolean;
}) {
  const callSid = String(args.callSid || "").trim();
  const normalized = normalizeAICallOutcome(args.outcome);

  if (!callSid || !normalized || normalized === "unknown") {
    return { changed: false, reason: "invalid_or_unknown_outcome" };
  }

  const now = new Date();
  const eligibleOutcomes = args.allowHigherPriorityOverride === false
    ? ["unknown", "disconnected"]
    : lowerPriorityOutcomes(normalized);

  const previous: any = await AICallRecording.findOneAndUpdate(
    {
      callSid,
      $or: [
        { outcome: { $exists: false } },
        { outcome: null },
        { outcome: { $in: eligibleOutcomes } },
      ],
    },
    {
      $set: {
        outcome: normalized,
        ...(args.outcomeSource ? { outcomeSource: args.outcomeSource } : {}),
        updatedAt: now,
      },
    },
    { new: false }
  ).lean();

  if (!previous) {
    return { changed: false, reason: "not_eligible_or_already_set" };
  }

  const prevOutcome = normalizeAICallOutcome(previous.outcome) || "unknown";
  const inc = buildStatsInc(prevOutcome, normalized);
  const sessionId = args.aiCallSessionId || previous.aiCallSessionId;
  const userEmail = String(args.userEmail || previous.userEmail || "").toLowerCase();

  if (sessionId && userEmail && Object.keys(inc).length > 0) {
    await AICallSession.updateOne(
      { _id: sessionId, userEmail },
      { $inc: inc, $set: { updatedAt: now } }
    ).exec();

    await maybeMarkAICallSessionCompleted({ sessionId, userEmail });
  }

  return {
    changed: true,
    previousOutcome: prevOutcome,
    outcome: normalized,
    statsInc: inc,
    aiCallSessionId: sessionId ? String(sessionId) : null,
  };
}
