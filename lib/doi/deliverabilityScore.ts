import EmailBounce from "../../models/EmailBounce";
import EmailEngagement from "../../models/EmailEngagement";
import { calculateEngagementScore } from "./engagementScore";

type DeliverabilityInput = {
  email?: string;
  domain?: string;
  domainTrustLevel?: string;
  catchAllSuspected?: boolean;
  smtpReason?: string;
};

export async function calculateDeliverabilityScore(input: DeliverabilityInput): Promise<number> {
  let score = 80;

  const domain = (input.domain || "").toLowerCase();
  const email = (input.email || "").toLowerCase();

  if (input.domainTrustLevel === "trusted_business") score += 10;
  else if (input.domainTrustLevel === "government") score += 5;
  else if (input.domainTrustLevel === "generic_directory") score -= 5;
  else if (input.domainTrustLevel === "low_trust" || input.domainTrustLevel === "blacklisted") score -= 15;

  if (input.catchAllSuspected) score -= 10;
  if (input.smtpReason?.startsWith("smtp_5")) score -= 15;
  if (input.smtpReason?.startsWith("smtp_4")) score -= 5;

  if (domain) {
    const recentBounces = await EmailBounce.countDocuments({ domain });
    score -= Math.min(20, recentBounces * 2);
  }

  if (email) {
    const engagement = await EmailEngagement.findOne({ email }).lean();
    if (engagement) {
      const engagementScore = calculateEngagementScore({
        opened: engagement.opened,
        clicked: engagement.clicked,
        replied: engagement.replied,
        unsubscribed: engagement.unsubscribed,
      });
      score += Math.min(15, engagementScore);
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
