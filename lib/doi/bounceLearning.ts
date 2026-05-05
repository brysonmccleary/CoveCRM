import DomainEmailPattern from "../../models/DomainEmailPattern";
import DOIAgent from "../../models/DOIAgent";
import EmailVerification from "../../models/EmailVerification";
import EmailBounce from "../../models/EmailBounce";

export async function recordEmailBounce(params: {
  email: string;
  agentId?: string;
  domain?: string;
  bounceType?: "hard" | "soft";
  reason?: string;
  source?: "domain_pattern" | "personal_guess" | "website" | "manual";
}) {
  const normalizedEmail = params.email?.toLowerCase();
  const normalizedDomain =
    params.domain?.toLowerCase() || normalizedEmail?.split("@")[1]?.toLowerCase() || "";

  await EmailBounce.create({
    email: normalizedEmail,
    agentId: params.agentId || undefined,
    domain: normalizedDomain,
    bounceType: params.bounceType || "hard",
    reason: params.reason || "",
    source: params.source || "",
  });

  let patternUsed: string | undefined;
  if (normalizedEmail) {
    const verification = await EmailVerification.findOne({ email: normalizedEmail }).lean();
    patternUsed = verification?.patternUsed;
  }

  if (normalizedDomain) {
    await updatePatternConfidenceFromBounces(normalizedDomain, patternUsed);
    await updateDomainTrustFromBounces(normalizedDomain);
  }

  if (normalizedEmail) {
    await updateEmailConfidenceFromBounce(normalizedEmail);
  }
}

export async function updatePatternConfidenceFromBounces(domain: string, pattern?: string) {
  if (!domain) return;
  const normalized = domain.toLowerCase();
  const query = pattern ? { domain: normalized, pattern } : { domain: normalized };
  const patterns = await DomainEmailPattern.find(query).lean();
  for (const doc of patterns) {
    const failureCount = (doc.failureCount || 0) + 1;
    const successCount = doc.successCount || 0;
    const total = successCount + failureCount;
    const rate = total ? Math.round((successCount / total) * 100) : 0;
    await DomainEmailPattern.updateOne(
      { _id: doc._id },
      {
        $set: {
          failureCount,
          totalFailures: failureCount,
          totalSuccess: successCount,
          totalTests: total,
          patternSuccessRate: rate,
          confidenceScore: Math.max(0, (doc.confidenceScore || 0) - 10),
        },
      }
    );
  }
}

export async function updateDomainTrustFromBounces(domain: string) {
  if (!domain) return;
  const normalized = domain.toLowerCase();
  await DOIAgent.updateMany(
    { agencyDomain: normalized },
    {
      $set: { domainTrustLevel: "low_trust" },
      $addToSet: { rejectionReasons: "domain_bounce" },
    }
  );
}

export async function updateEmailConfidenceFromBounce(email: string) {
  if (!email) return;
  await EmailVerification.updateOne(
    { email: email.toLowerCase() },
    {
      $set: {
        smtpValid: false,
        verificationStatus: "bounced",
        reasonBucket: "bounced",
        rejectionReason: "bounced",
      },
      $mul: { confidenceScore: 0.5 },
    }
  );
}
