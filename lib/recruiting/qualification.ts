import OpenAI from "openai";
import type { SocialPlatform } from "@/lib/recruiting/social/types";

export type RecruitingConfidenceTier = "high" | "medium" | "low";
export type AdultSafetyStatus = "adult_verified" | "minor_or_youth" | "unknown";
export type EngagementAudience = "everyone" | "women" | "men";
export type ExplicitEngagementAudience = "women" | "men" | "unknown";

export type RecruitingQualificationCandidate = {
  candidateId: string;
  evidence: string;
};

export type RecruitingQualification = {
  candidateId: string;
  confidenceScore: number;
  confidenceTier: RecruitingConfidenceTier;
  adultSafety: AdultSafetyStatus;
  adultEvidence: string;
  reason: string;
  evidence: string[];
};

export const HIGH_CONFIDENCE_THRESHOLD = 0.85;
export const MEDIUM_CONFIDENCE_THRESHOLD = 0.6;
export const RECRUITING_QUALIFICATION_MODEL = process.env.RECRUITING_QUALIFICATION_MODEL || "gpt-5.6-luna";

export function confidenceTierForScore(score: number): RecruitingConfidenceTier {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
}

export function actionsForConfidence(
  platform: SocialPlatform,
  tier: RecruitingConfidenceTier,
): ("dm" | "like_post" | "like_story" | "follow" | "connect")[] {
  if (tier === "low") return [];
  if (platform === "instagram") {
    return tier === "high" ? ["like_post", "like_story", "follow", "dm"] : ["like_post", "like_story"];
  }
  return tier === "high" ? ["connect", "dm"] : ["like_post"];
}

export function applyAdultSafetyGate<T>(actions: T[], status: AdultSafetyStatus): T[] {
  return status === "adult_verified" ? actions : [];
}

export function explicitEngagementAudienceFromEvidence(evidence: string): ExplicitEngagementAudience {
  const normalized = String(evidence || "").toLowerCase().replace(/\s+/g, " ");
  const womenEvidence = /\b(she\s*\/\s*her|she\s*[·|]\s*her|woman|female)\b/i.test(normalized);
  const menEvidence = /\b(he\s*\/\s*him|he\s*[·|]\s*him|man|male)\b/i.test(normalized);
  if (womenEvidence === menEvidence) return "unknown";
  return womenEvidence ? "women" : "men";
}

export function applyEngagementAudiencePreference(
  actions: ("dm" | "like_post" | "like_story" | "follow" | "connect")[],
  preference: EngagementAudience,
  evidence: string,
) {
  if (preference === "everyone") return actions;
  const explicitAudience = explicitEngagementAudienceFromEvidence(evidence);
  if (explicitAudience === preference) return actions;
  return actions.filter((action) => action !== "like_post" && action !== "like_story");
}

export async function qualifyRecruitingCandidates(input: {
  platform: SocialPlatform;
  audienceDescription: string;
  location: string;
  candidates: RecruitingQualificationCandidate[];
}): Promise<RecruitingQualification[]> {
  if (!input.candidates.length) return [];
  if (!process.env.OPENAI_API_KEY) throw new Error("Recruiting qualification is unavailable.");

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: RECRUITING_QUALIFICATION_MODEL,
    store: false,
    max_output_tokens: 1800,
    input: [
      {
        role: "system",
        content: [
          "Score how strongly each public profile matches the customer's job-related recruiting criteria.",
          "Use only explicit professional, interest, skill, activity, and location evidence supplied in the input.",
          "Never infer or use sex, gender, gender identity, race, color, ethnicity, religion, age, disability, medical information, sexual orientation, pregnancy, national origin, or any other protected trait.",
          "Do not use a person's name, photo assumptions, or pronouns as evidence.",
          "Separately classify adultSafety. Use adult_verified only when the supplied text explicitly establishes that the person is at least 18, or supplies an unambiguous adult-only professional credential or role. Use minor_or_youth when the text explicitly says the person is under 18, a minor, a high-school or middle-school student, or a youth athlete. Otherwise use unknown. Never estimate age from a name, photo, graduation appearance, or vague career-stage language.",
          "Interpret criteria joined by 'or' as alternatives. A profile does not need to match every example or alternative.",
          "Use matchStrength direct when explicit evidence satisfies at least one stated professional alternative and every explicitly required location constraint. Use plausible for adjacent or transferable evidence. Use weak when evidence is insufficient, unrelated, or misses a required location.",
          "Do not downgrade a direct match merely because another optional example, alternative, or preference is absent.",
          "Return short reasons and only quote or paraphrase evidence actually present. If input is unrelated or insufficient, return a low score and explain that evidence is insufficient.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          platform: input.platform,
          recruitingCriteria: input.audienceDescription,
          requestedUSLocation: input.location || "United States",
          candidates: input.candidates,
        }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "recruiting_qualification",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            qualifications: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  candidateId: { type: "string" },
                  matchStrength: { type: "string", enum: ["direct", "plausible", "weak"] },
                  adultSafety: { type: "string", enum: ["adult_verified", "minor_or_youth", "unknown"] },
                  adultEvidence: { type: "string" },
                  reason: { type: "string" },
                  evidence: { type: "array", items: { type: "string" }, maxItems: 3 },
                },
                required: ["candidateId", "matchStrength", "adultSafety", "adultEvidence", "reason", "evidence"],
              },
            },
          },
          required: ["qualifications"],
        },
      },
    },
  });

  if (!response.output_text) throw new Error("Recruiting qualification returned no result.");
  const parsed = JSON.parse(response.output_text) as { qualifications?: unknown[] };
  const allowedIds = new Set(input.candidates.map((candidate) => candidate.candidateId));
  const seen = new Set<string>();
  const qualifications: RecruitingQualification[] = [];
  for (const raw of Array.isArray(parsed.qualifications) ? parsed.qualifications : []) {
    const item = raw as Record<string, unknown>;
    const candidateId = String(item.candidateId || "");
    const matchStrength = String(item.matchStrength || "");
    const adultSafety = String(item.adultSafety || "") as AdultSafetyStatus;
    if (!allowedIds.has(candidateId) || seen.has(candidateId) || !["direct", "plausible", "weak"].includes(matchStrength)
      || !["adult_verified", "minor_or_youth", "unknown"].includes(adultSafety)) continue;
    seen.add(candidateId);
    const confidenceScore = matchStrength === "direct" ? 0.9 : matchStrength === "plausible" ? 0.7 : 0.3;
    qualifications.push({
      candidateId,
      confidenceScore,
      confidenceTier: confidenceTierForScore(confidenceScore),
      adultSafety,
      adultEvidence: String(item.adultEvidence || "No explicit adult evidence supplied.").slice(0, 300),
      reason: String(item.reason || "Insufficient public job-related evidence.").slice(0, 500),
      evidence: (Array.isArray(item.evidence) ? item.evidence : []).map(String).map((value) => value.slice(0, 300)).slice(0, 3),
    });
  }
  if (qualifications.length !== input.candidates.length) throw new Error("Recruiting qualification was incomplete.");
  return qualifications;
}
