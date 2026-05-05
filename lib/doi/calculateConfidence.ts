type ConfidenceInputs = {
  discoveryScore?: number;
  patternType?: string;
  smtpStatus?: string;
  domain?: string;
  catchAll?: boolean;
  matchedName?: boolean;
  domainPatternConfidence?: number;
};

const clamp = (val: number, min = 0, max = 100) => Math.max(min, Math.min(max, val));

export function calculateConfidence(inputs: ConfidenceInputs) {
  let score = 0;
  const reasons: string[] = [];

  if ((inputs.discoveryScore || 0) > 0) {
    const scaled = Math.min(inputs.discoveryScore || 0, 100) * 0.4;
    score += scaled;
    reasons.push("discovery");
  }

  switch ((inputs.patternType || "").toLowerCase()) {
    case "first.last":
    case "last.first":
      score += 10;
      reasons.push("pattern-high");
      break;
    case "first":
    case "flast":
    case "first_last":
    case "firstl":
      score += 6;
      reasons.push("pattern-medium");
      break;
    default:
      score += 3;
      reasons.push("pattern-low");
  }

  if (inputs.smtpStatus === "valid") {
    score += 30;
    reasons.push("smtp-valid");
  } else if (inputs.smtpStatus === "catch_all_suspected") {
    score -= 10;
    reasons.push("catch-all");
  } else if (inputs.smtpStatus && inputs.smtpStatus.startsWith("smtp_5")) {
    score -= 20;
    reasons.push("smtp-hardfail");
  }

  if (inputs.domain?.endsWith(".com")) {
    score += 5;
  }

  if ((inputs.domainPatternConfidence || 0) > 0) {
    const boost = Math.min(inputs.domainPatternConfidence || 0, 100) * 0.2;
    score += boost;
    reasons.push("domain-pattern");
  }

  if (inputs.catchAll) {
    score -= 15;
    reasons.push("catch-all-detected");
  }

  if (inputs.matchedName) {
    score += 5;
    reasons.push("name-match");
  }

  return { score: clamp(score), reasons };
}
