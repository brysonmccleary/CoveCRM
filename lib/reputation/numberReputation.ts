export const SHORT_CALL_MAX_SECONDS = 5;
export const MIN_DIALS_FOR_EVAL = 30;
export const DECAY_DROP_POINTS = 10;
export const PEER_BELOW_MEDIAN_POINTS = 8;
export const ABSOLUTE_RISK_ANSWER_RATE = 7;
export const ABSOLUTE_WATCH_ANSWER_RATE = 10;
export const MIN_FLEET_SIZE_FOR_PEER = 3;
export const SHORT_CALL_RISK_RATE = 35;

export type ReputationTier = "insufficient_data" | "healthy" | "watch" | "spam_risk";

export type NumberCallStats = {
  total: number;
  completed: number;
  voicemail: number;
  answeredUnder5s: number;
};

export type ClassificationInput = {
  answerRate: number | null;
  priorAnswerRate?: number | null;
  shortCallRate: number | null;
  peerMedian?: number | null;
  dials: number;
  fleetSize?: number;
};

export type ClassificationResult = {
  tier: ReputationTier;
  reasons: string[];
};

export type AlertTransitionInput = {
  previousTier?: ReputationTier | string | null;
  nextTier: ReputationTier;
  lastAlertTier?: ReputationTier | string | null;
};

export type AlertTransitionResult = {
  shouldAlert: boolean;
  shouldClearAlertState: boolean;
};

function clampRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasRate(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function computeAnswerRate({
  completed,
  voicemail,
  total,
}: {
  completed: number;
  voicemail: number;
  total: number;
}): number | null {
  const denominator = Math.max(0, Number(total || 0) - Number(voicemail || 0));
  if (denominator <= 0) return null;
  return clampRate((Number(completed || 0) / denominator) * 100);
}

export function computeShortCallRate({
  answeredUnder5s,
  answered,
}: {
  answeredUnder5s: number;
  answered: number;
}): number | null {
  const denominator = Math.max(0, Number(answered || 0));
  if (denominator <= 0) return null;
  return clampRate((Number(answeredUnder5s || 0) / denominator) * 100);
}

export function median(values: Array<number | null | undefined>): number | null {
  const sorted = values
    .filter(hasRate)
    .slice()
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function classifyNumber({
  answerRate,
  priorAnswerRate = null,
  shortCallRate,
  peerMedian = null,
  dials,
  fleetSize = 0,
}: ClassificationInput): ClassificationResult {
  const reasons: string[] = [];
  if (dials < MIN_DIALS_FOR_EVAL) {
    return {
      tier: "insufficient_data",
      reasons: [`insufficient_data:${dials}/${MIN_DIALS_FOR_EVAL}`],
    };
  }

  const decayDrop =
    hasRate(answerRate) && hasRate(priorAnswerRate)
      ? priorAnswerRate - answerRate
      : 0;
  const hasDecay = decayDrop >= DECAY_DROP_POINTS;
  const highShortCallRate = hasRate(shortCallRate) && shortCallRate >= SHORT_CALL_RISK_RATE;
  const absoluteRisk = hasRate(answerRate) && answerRate < ABSOLUTE_RISK_ANSWER_RATE;
  const absoluteWatch = hasRate(answerRate) && answerRate < ABSOLUTE_WATCH_ANSWER_RATE;
  const hasPeerBaseline = fleetSize >= MIN_FLEET_SIZE_FOR_PEER && hasRate(peerMedian);
  const belowPeer =
    hasPeerBaseline && hasRate(answerRate)
      ? peerMedian - answerRate >= PEER_BELOW_MEDIAN_POINTS
      : absoluteRisk;

  if (hasDecay) reasons.push(`answer_rate_decay:${decayDrop}`);
  if (highShortCallRate) reasons.push(`high_short_call_rate:${shortCallRate}`);
  if (absoluteRisk) reasons.push(`absolute_risk_answer_rate:${answerRate}`);
  else if (absoluteWatch) reasons.push(`absolute_watch_answer_rate:${answerRate}`);
  if (hasPeerBaseline && belowPeer) reasons.push(`below_peer_median:${peerMedian}`);
  if (!hasPeerBaseline) reasons.push("peer_baseline_unavailable");

  const badSignal = highShortCallRate || hasDecay || absoluteRisk;
  if (badSignal && belowPeer) {
    return { tier: "spam_risk", reasons };
  }

  if (hasDecay || (hasPeerBaseline && belowPeer) || absoluteWatch) {
    return { tier: "watch", reasons };
  }

  return { tier: "healthy", reasons: [] };
}

export function formatReputationAlertCopy(args: {
  tier: ReputationTier;
  formattedNumber: string;
}): string {
  const { tier, formattedNumber } = args;
  if (tier === "spam_risk") {
    return `SPAM RISK - your number ${formattedNumber} may be flagged by carriers. We recommend replacing it.`;
  }
  return `Heads up - your number ${formattedNumber} is showing a drop in answer rate. Keep daily call volume steady and avoid bursts to protect it.`;
}

export function evaluateAlertTransition({
  previousTier,
  nextTier,
  lastAlertTier,
}: AlertTransitionInput): AlertTransitionResult {
  if (nextTier === "healthy") {
    return {
      shouldAlert: false,
      shouldClearAlertState: lastAlertTier === "watch" || lastAlertTier === "spam_risk",
    };
  }

  if (nextTier !== "watch" && nextTier !== "spam_risk") {
    return { shouldAlert: false, shouldClearAlertState: false };
  }

  const newlyEnteredTier = previousTier !== nextTier;
  const alreadyAlertedForTier = lastAlertTier === nextTier;
  return {
    shouldAlert: newlyEnteredTier && !alreadyAlertedForTier,
    shouldClearAlertState: false,
  };
}
