import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const toNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: string | undefined, fallback: boolean) => {
  if (typeof value === "undefined") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

export const DOI_CONFIG = {
  discoveryBatchSize: toNumber(process.env.DOI_DISCOVERY_BATCH_SIZE, 10),
  scoringBatchSize: toNumber(process.env.DOI_SCORING_BATCH_SIZE, 15),
  patternBatchSize: toNumber(process.env.DOI_PATTERN_BATCH_SIZE, 25),
  verifyBatchSize: toNumber(process.env.DOI_VERIFY_BATCH_SIZE, 15),
  promotionBatchSize: toNumber(process.env.DOI_PROMOTION_BATCH_SIZE, 25),
  searchBatchSize: toNumber(process.env.DOI_SEARCH_BATCH_SIZE, 10),
  parseBatchSize: toNumber(process.env.DOI_PARSE_BATCH_SIZE, 15),
  identityBatchSize: toNumber(process.env.DOI_IDENTITY_BATCH_SIZE, 15),
  pipelineBatchSize: toNumber(process.env.DOI_PIPELINE_BATCH_SIZE, 50),
  pipelineCooldownMinutes: toNumber(process.env.DOI_PIPELINE_COOLDOWN_MINUTES, 60),
  pipelineMaxAttempts: toNumber(process.env.DOI_PIPELINE_MAX_ATTEMPTS, 6),
  minDiscoveryScore: toNumber(process.env.DOI_MIN_DISCOVERY_SCORE, 70),
  minPromotionConfidence: toNumber(
    process.env.DOI_MIN_PROMOTION_SCORE ?? process.env.DOI_MIN_PROMOTION_CONFIDENCE,
    85
  ),
  identityScoreThreshold: toNumber(process.env.DOI_MIN_IDENTITY_SCORE, 60),
  identityHighConfidence: toNumber(process.env.DOI_HIGH_IDENTITY_SCORE, 80),
  enableOpenAIAssist: toBoolean(process.env.DOI_ENABLE_OPENAI_ASSIST, false),
  allowSocialDomains: toBoolean(process.env.DOI_ALLOWED_SOCIAL_DOMAINS, false),
  detectCatchAll: toBoolean(process.env.DOI_DETECT_CATCH_ALL ?? "true", true),
  verifyMaxAttempts: toNumber(process.env.DOI_MAX_VERIFICATION_ATTEMPTS ?? process.env.DOI_VERIFY_MAX_ATTEMPTS, 3),
  verifyAttemptCooldownMinutes: toNumber(
    process.env.DOI_VERIFY_ATTEMPT_COOLDOWN_MINUTES,
    360
  ),
  stuckThresholdHours: {
    discovery: toNumber(process.env.DOI_DISCOVERY_STUCK_HOURS, 6),
    domain: toNumber(process.env.DOI_DOMAIN_STUCK_HOURS, 12),
    patterns: toNumber(process.env.DOI_PATTERNS_STUCK_HOURS, 12),
    verification: toNumber(process.env.DOI_VERIFICATION_STUCK_HOURS, 18),
    promotion: toNumber(process.env.DOI_PROMOTION_STUCK_HOURS, 24),
  },
};
