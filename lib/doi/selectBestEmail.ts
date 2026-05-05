import { DOIAgent } from "../../models/DOIAgent";
import { EmailVerification } from "../../models/EmailVerification";

type EmailType = "work" | "personal";

interface BestEmailResult {
  bestEmail: string | null;
  bestEmailType: EmailType | null;
  bestEmailConfidence: number;
  reason: string;
}

interface Options {
  agent: Partial<DOIAgent> | null | undefined;
  identityScore: number;
  domainTrustLevel?: "low" | "medium" | "high";
  verifications: Array<
    Pick<
      EmailVerification,
      | "email"
      | "smtpValid"
      | "confidenceScore"
      | "emailType"
      | "patternUsed"
      | "catchAllSuspected"
    >
  >;
}

const normalizeType = (type?: string | null): EmailType =>
  type === "personal" ? "personal" : "work";

export function selectBestEmail({
  identityScore,
  domainTrustLevel,
  verifications,
}: Options): BestEmailResult {
  let bestScore = -Infinity;
  let bestEmail: string | null = null;
  let bestEmailType: EmailType | null = null;
  let bestReason = "No verified emails available.";

  if (!verifications?.length) {
    return {
      bestEmail,
      bestEmailType,
      bestEmailConfidence: 0,
      reason: bestReason,
    };
  }

  for (const verification of verifications || []) {
    if (!verification?.smtpValid) continue;

    let score = verification.confidenceScore || 0;
    const type = normalizeType(verification.emailType as string | undefined);
    const isPersonal = type === "personal";
    const isWork = type === "work";

    if (isPersonal && identityScore > 70) {
      score += 15;
    }

    if (isWork && domainTrustLevel === "high") {
      score += 10;
    }

    if (verification.patternUsed) {
      score += 10;
    }

    if (verification.catchAllSuspected) {
      score -= 20;
    }

    if (identityScore < 50) {
      score -= 15;
    }

    if (score > bestScore) {
      bestScore = score;
      bestEmail = verification.email;
      bestEmailType = type;
      bestReason = buildReason({
        verification,
        score,
        identityScore,
        domainTrustLevel,
        isPersonal,
        isWork,
      });
    }
  }

  if (!bestEmail) {
    return {
      bestEmail: null,
      bestEmailType: null,
      bestEmailConfidence: 0,
      reason: "No verified emails passed scoring.",
    };
  }

  return {
    bestEmail,
    bestEmailType,
    bestEmailConfidence: Math.max(0, Math.round(bestScore)),
    reason: bestReason,
  };
}

function buildReason({
  verification,
  score,
  identityScore,
  domainTrustLevel,
  isPersonal,
  isWork,
}: {
  verification: Pick<EmailVerification, "confidenceScore" | "patternUsed" | "catchAllSuspected">;
  score: number;
  identityScore: number;
  domainTrustLevel?: "low" | "medium" | "high";
  isPersonal: boolean;
  isWork: boolean;
}): string {
  const reasons: string[] = [];

  reasons.push(`base:${verification.confidenceScore ?? 0}`);

  if (isPersonal && identityScore > 70) {
    reasons.push("personal+identity boost");
  }

  if (isWork && domainTrustLevel === "high") {
    reasons.push("trusted domain boost");
  }

  if (verification.patternUsed) {
    reasons.push("known pattern boost");
  }

  if (verification.catchAllSuspected) {
    reasons.push("catch-all penalty");
  }

  if (identityScore < 50) {
    reasons.push("low identity penalty");
  }

  reasons.push(`final:${Math.round(score)}`);

  return reasons.join("; ");
}
