type DomainTrustBand = "high" | "medium" | "low" | "";
type EmailType = "domain" | "personal" | "work" | "";

interface LeadScoreInput {
  identityScore?: number;
  bestEmailConfidence?: number;
  emailType?: EmailType;
  domainTrustLevel?: DomainTrustBand;
  hasPhone?: boolean;
  hasWebsite?: boolean;
  yearsLicensed?: number;
  multiStateLicensed?: boolean;
  catchAllSuspected?: boolean;
  engagementOpened?: boolean;
  engagementClicked?: boolean;
  engagementReplied?: boolean;
  engagementUnsubscribed?: boolean;
}

interface LeadScoreResult {
  leadScore: number;
  leadGrade: "A" | "B" | "C" | "D";
  engagementScore: number;
}

const clampScore = (score: number) => Math.max(0, Math.min(100, Math.round(score)));

const gradeForScore = (score: number): LeadScoreResult["leadGrade"] => {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
};

export function calculateLeadScore(input: LeadScoreInput): LeadScoreResult {
  let score = 0;
  const identityScore = input.identityScore ?? 0;
  const emailConfidence = input.bestEmailConfidence ?? 0;
  const yearsLicensed = input.yearsLicensed ?? 0;

  score += identityScore * 0.3;
  score += emailConfidence * 0.3;

  if (input.emailType === "domain" || input.emailType === "work") score += 5;
  else if (input.emailType === "personal") score += 3;

  if (input.domainTrustLevel === "high") score += 10;
  else if (input.domainTrustLevel === "medium") score += 5;

  if (input.hasPhone) score += 5;
  if (input.hasWebsite) score += 5;

  if (yearsLicensed > 10) score += 5;
  if (input.multiStateLicensed) score += 5;

  if (input.catchAllSuspected) score -= 15;

  let engagementScore = 0;
  if (input.engagementReplied) engagementScore += 25;
  if (input.engagementClicked) engagementScore += 10;
  if (input.engagementOpened) engagementScore += 5;
  if (input.engagementUnsubscribed) engagementScore -= 30;

  score += engagementScore;

  const leadScore = clampScore(score);
  return {
    leadScore,
    leadGrade: gradeForScore(leadScore),
    engagementScore,
  };
}
