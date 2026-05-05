// scripts/generate-email-patterns.ts
// Generates deterministic email patterns for DOI agents once a domain is known.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { Types } from "mongoose";
import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import EmailVerification from "../models/EmailVerification";
import DOIAgentDiscovery from "../models/DOIAgentDiscovery";
import DomainEmailPattern from "../models/DomainEmailPattern";
import { generatePersonalEmailCandidates } from "../lib/doi/personalEmailPatterns";
import { DOI_CONFIG } from "./doi-config";
import type { AnyBulkWriteOperation } from "mongoose";
type EmailVerificationEmailType = "domain" | "personal" | "work" | "";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "live.com",
  "msn.com",
]);
const EMAIL_EXTRACT_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

type AgentForPatterns = {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  agencyDomain?: string;
  domainTrustLevel?: string;
  emailDiscoveryMode?: string;
  pipelineStage?: string;
};

type PatternDoc = {
  email: string;
  label: string;
  confidence: number;
};

const PATTERN_BUILDERS: Array<[string, (first: string, last: string) => string | null, number]> = [
  ["first", (first) => (first ? first : null), 70],
  ["first.last", (first, last) => (first && last ? `${first}.${last}` : null), 82],
  ["firstlast", (first, last) => (first && last ? `${first}${last}` : null), 68],
  [
    "flast",
    (first, last) => (first && last ? `${first.charAt(0)}${last}` : null),
    74,
  ],
  ["first_last", (first, last) => (first && last ? `${first}_${last}` : null), 72],
  ["last.first", (first, last) => (first && last ? `${last}.${first}` : null), 60],
  ["firstl", (first, last) => (first && last ? `${first}${last.charAt(0)}` : null), 65],
];

const PATTERN_LOOKUP: Record<
  string,
  { builder: (first: string, last: string) => string | null; confidence: number }
> = PATTERN_BUILDERS.reduce((acc, [label, builder, confidence]) => {
  acc[label] = { builder, confidence };
  return acc;
}, {} as Record<string, { builder: (first: string, last: string) => string | null; confidence: number }>);

function slug(value?: string): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildPatterns(agent: AgentForPatterns, labels?: string[]): PatternDoc[] {
  const domain = (agent.agencyDomain || "").toLowerCase();
  const first = slug(agent.firstName);
  const last = slug(agent.lastName);
  if (!domain || (!first && !last)) return [];

  const seen = new Set<string>();
  const docs: PatternDoc[] = [];

  const source: Array<[string, (first: string, last: string) => string | null, number]> = labels
    ? labels
        .map((label) => {
          const entry = PATTERN_LOOKUP[label];
          if (!entry) return null;
          return [label, entry.builder, entry.confidence] as [
            string,
            (first: string, last: string) => string | null,
            number
          ];
        })
        .filter((entry): entry is [string, (first: string, last: string) => string | null, number] => !!entry)
    : PATTERN_BUILDERS;

  for (const [label, builder, confidence] of source) {
    const local = builder(first, last);
    if (!local) continue;
    const email = `${local}@${domain}`;
    if (seen.has(email)) continue;
    seen.add(email);
    docs.push({ email, label, confidence });
  }

  return docs;
}

function normalizeEmail(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function determineEmailType(
  email: string,
  agent: AgentForPatterns,
  allowPersonal: boolean
): "work" | "personal" | null {
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) return null;
  const domain = normalized.split("@")[1];
  if (!domain) return null;
  if (agent.agencyDomain && domain === agent.agencyDomain.toLowerCase()) return "work";
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) {
    return allowPersonal ? "personal" : null;
  }
  return "work";
}

async function hasAcceptedDiscovery(agentId: Types.ObjectId): Promise<boolean> {
  const doc = await DOIAgentDiscovery.findOne({ agentId, accepted: true })
    .select("_id")
    .lean();
  return !!doc;
}

export async function generateEmailPatternsForAgent(agent: AgentForPatterns): Promise<{ inserted: number }> {
  const hasDiscovery = await hasAcceptedDiscovery(agent._id);
  let inserted = 0;

  if (
    hasDiscovery &&
    agent.domainTrustLevel &&
    ["generic_directory", "social", "low_trust", "blacklisted"].includes(agent.domainTrustLevel)
  ) {
    await DOIAgent.updateOne(
      { _id: agent._id },
      {
        $set: { lastRejectionReason: "untrusted_domain_patterns" },
        $addToSet: { rejectionReasons: "untrusted_domain_patterns" },
      }
    );
  }

  if (hasDiscovery && agent.agencyDomain) {
    const domain = (agent.agencyDomain || "").toLowerCase();
    const knownPatterns = domain
      ? await DomainEmailPattern.find({ domain })
          .sort({ confidenceScore: -1, successCount: -1 })
          .lean()
      : [];
    const confidentPatterns = knownPatterns.filter((doc) => doc.successCount > doc.failureCount && doc.successCount > 0);

    const domainPatterns = confidentPatterns.length
      ? buildPatterns(
          agent,
          confidentPatterns
            .map((doc) => doc.pattern)
            .filter((label) => !!PATTERN_LOOKUP[label])
        ).map((pattern) => {
          const stats = confidentPatterns.find((doc) => doc.pattern === pattern.label);
          return stats
            ? { ...pattern, confidence: Math.max(pattern.confidence, stats.confidenceScore || 85) }
            : pattern;
        })
      : buildPatterns(agent);

    if (domainPatterns.length) {
      const ops: AnyBulkWriteOperation<any>[] = domainPatterns.map((pattern) => ({
        updateOne: {
          filter: { agentId: agent._id, email: pattern.email },
          update: {
            $setOnInsert: {
              patternUsed: pattern.label,
              smtpValid: false,
              confidenceScore: pattern.confidence,
              emailType: ("work" as EmailVerificationEmailType as EmailVerificationEmailType),
            },
          },
          upsert: true,
        },
      }));
      await EmailVerification.bulkWrite(ops, { ordered: false });
      inserted += domainPatterns.length;

      if (!confidentPatterns.length && domain) {
        const patternOps = domainPatterns.map((pattern) => ({
          updateOne: {
            filter: { domain, pattern: pattern.label },
            update: {
              $setOnInsert: {
                confidenceScore: pattern.confidence,
                successCount: 0,
                failureCount: 0,
                catchAll: false,
                lastTestedAt: new Date(),
              },
            },
            upsert: true,
          },
        }));
        await DomainEmailPattern.bulkWrite(patternOps, { ordered: false });
      }
    }
  }

  const personalInserted = await upsertPersonalEmailCandidates(agent);
  inserted += personalInserted;

  if (inserted > 0) {
    await DOIAgentEnrichment.updateOne(
      { agentId: agent._id },
      {
        $setOnInsert: { stage: "pending" },
        $set: {
          stage: "patterns_generated",
          lastAttemptAt: new Date(),
          notes: "Email patterns generated",
        },
        $inc: { attempts: 1 },
      },
      { upsert: true }
    );
  }

  return { inserted };
}

async function upsertPersonalEmailCandidates(agent: AgentForPatterns) {
  const generated = generatePersonalEmailCandidates(agent);
  const discovered = await DOIAgentDiscovery.find({
    agentId: agent._id,
    personalEmails: { $exists: true, $ne: [] },
  })
    .select("personalEmails")
    .lean();

  const map = new Map<string, { label: string; confidence: number }>();
  generated.forEach((candidate: { email: string; label: string; confidence: number }) =>
    map.set(candidate.email.toLowerCase(), { label: candidate.label, confidence: candidate.confidence })
  );

  discovered.forEach((doc) => {
    (doc.personalEmails || []).forEach((email) => {
      const normalized = email.toLowerCase();
      if (!map.has(normalized)) {
        map.set(normalized, { label: "personal:discovered", confidence: 80 });
      }
    });
  });

  if (!map.size) return 0;

  const ops = Array.from(map.entries()).map(([email, meta]) => ({
    updateOne: {
      filter: { agentId: agent._id, email },
      update: {
        $setOnInsert: {
          patternUsed: meta.label,
          smtpValid: false,
          confidenceScore: meta.confidence,
          emailType: ("personal" as EmailVerificationEmailType),
        },
      },
      upsert: true,
    },
  }));

  await EmailVerification.bulkWrite(ops, { ordered: false });
  return ops.length;
}

async function seedEmailsFromDiscovery(
  agent: AgentForPatterns,
  allowPersonal: boolean
): Promise<{ inserted: number; work: number; personal: number }> {
  const modeLabel = agent.emailDiscoveryMode || (allowPersonal ? "personal_fallback" : "business_domain");
  const docs = await DOIAgentDiscovery.find({
    agentId: agent._id,
    $or: [
      { foundEmails: { $exists: true, $ne: [] } },
      { personalEmails: { $exists: true, $ne: [] } },
      { workEmails: { $exists: true, $ne: [] } },
      { pageText: { $exists: true, $ne: "" } },
    ],
  })
    .select("foundEmails personalEmails workEmails pageText")
    .lean();

  const enrichment = await DOIAgentEnrichment.findOne({ agentId: agent._id })
    .select("discoveredEmails")
    .lean();

  if (!docs.length && !(enrichment?.discoveredEmails?.length)) {
    console.log(
      `[email-seed] agent=${agent._id} mode=${modeLabel} seeded_from_discovery=0 work=0 personal=0`
    );
    return { inserted: 0, work: 0, personal: 0 };
  }

  const map = new Map<
    string,
    {
      type: "work" | "personal";
      confidence: number;
      label: string;
    }
  >();

  const pushEmail = (email: string, suggestedType: "work" | "personal") => {
    const normalized = normalizeEmail(email);
    if (!normalized.includes("@")) return;
    if (map.has(normalized)) return;
    const type = suggestedType === "personal" ? "personal" : "work";
    if (type === "personal" && !allowPersonal) return;
    map.set(normalized, {
      type,
      confidence: type === "work" ? 70 : 60,
      label: "discovered",
    });
  };

  for (const doc of docs) {
    for (const email of doc.personalEmails || []) {
      pushEmail(email, "personal");
    }
    for (const email of doc.foundEmails || []) {
      const typed = determineEmailType(email, agent, allowPersonal);
      if (!typed) continue;
      pushEmail(email, typed);
    }
    for (const email of doc.workEmails || []) {
      pushEmail(email, "work");
    }
    if (doc.pageText) {
      const extracted = extractEmailsFromTextBlock(doc.pageText);
      extracted.work.forEach((email) => pushEmail(email, "work"));
      extracted.personal.forEach((email) => pushEmail(email, "personal"));
    }
  }

  const pushFromDiscovered = (record: { email?: string; emailType?: string }) => {
    if (!record?.email) return;
    const type = record.emailType === "personal" ? "personal" : "work";
    pushEmail(record.email, type);
  };

  if (enrichment?.discoveredEmails?.length) {
    enrichment.discoveredEmails.forEach((record: any) => {
      if (record) pushFromDiscovered(record);
    });
  }

  if (!map.size) {
    console.log(
      `[email-seed] agent=${agent._id} mode=${modeLabel} seeded_from_discovery=0 work=0 personal=0`
    );
    return { inserted: 0, work: 0, personal: 0 };
  }

  const ops = Array.from(map.entries()).map(([email, meta]) => ({
    updateOne: {
      filter: { agentId: agent._id, email },
      update: {
        $setOnInsert: {
          patternUsed: meta.label,
          smtpValid: false,
          confidenceScore: meta.confidence,
          emailType: (meta.type as EmailVerificationEmailType),
        },
      },
      upsert: true,
    },
  }));

  await EmailVerification.bulkWrite(ops, { ordered: false });
  const work = Array.from(map.values()).filter((meta) => meta.type === "work").length;
  const personal = map.size - work;

  await DOIAgent.updateOne(
    { _id: agent._id },
    {
      $set: {
        pipelineStage: "email",
        stuckReason: "",
        lastAttemptAt: new Date(),
        emailDiscoveryMode: allowPersonal ? "personal_fallback" : agent.emailDiscoveryMode || "business_domain",
      },
    }
  );

  console.log(
    `[email-seed] agent=${agent._id} mode=${modeLabel} seeded_from_discovery=${map.size} work=${work} personal=${personal}`
  );

  return { inserted: map.size, work, personal };
}

function extractEmailsFromTextBlock(text: string) {
  if (!text) return { work: [] as string[], personal: [] as string[] };
  const matches = text.match(EMAIL_EXTRACT_REGEX) || [];
  const normalized = dedupeEmails(matches);
  const personal = normalized.filter((email) => {
    const domain = email.split("@")[1] || "";
    return PERSONAL_EMAIL_DOMAINS.has(domain);
  });
  const personalSet = new Set(personal);
  const work = normalized.filter((email) => !personalSet.has(email));
  return { work, personal };
}

function dedupeEmails(emails: string[]) {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const email of emails || []) {
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized.includes("@")) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    list.push(normalized);
  }
  return list.slice(0, 25);
}

export async function generateEmailPatternsBatch(limit = DOI_CONFIG.patternBatchSize) {
  const domainMissingClause = { $or: [{ agencyDomain: "" }, { agencyDomain: { $exists: false } }] };
  const notFallbackClause = {
    $or: [{ emailDiscoveryMode: { $exists: false } }, { emailDiscoveryMode: { $ne: "personal_fallback" } }],
  };

  const domainDemoteResult = await DOIAgent.updateMany(
    {
      pipelineStage: "patterns",
      $and: [domainMissingClause, notFallbackClause],
    },
    { $set: { pipelineStage: "domain", stuckReason: "domain_missing" } }
  );
  if (domainDemoteResult.modifiedCount) {
    console.log(
      `[generate-email-patterns] demoted_domain_agents=${domainDemoteResult.modifiedCount} reason=domain_missing`
    );
  }

  const fallbackToEmail = await DOIAgent.updateMany(
    {
      pipelineStage: "patterns",
      $and: [domainMissingClause, { emailDiscoveryMode: "personal_fallback" }],
    },
    {
      $set: {
        pipelineStage: "email",
        stuckReason: "",
      },
    }
  );
  if (fallbackToEmail.modifiedCount) {
    console.log(
      `[generate-email-patterns] preserved_fallback_agents=${fallbackToEmail.modifiedCount} reason=personal_fallback_no_domain`
    );
  }

  const emailStageAgents = await DOIAgent.find({
    pipelineStage: "email",
    enrichmentStatus: { $ne: "failed" },
  })
    .select("_id emailDiscoveryMode")
    .limit(200)
    .lean();
  for (const stuckAgent of emailStageAgents) {
    if (stuckAgent.emailDiscoveryMode === "personal_fallback") {
      console.log(
        `[generate-email-patterns] preserving_fallback_agent=${stuckAgent._id} stage=email reason=personal_fallback`
      );
      continue;
    }
    const count = await EmailVerification.countDocuments({ agentId: stuckAgent._id });
    if (!count) {
      await DOIAgent.updateOne(
        { _id: stuckAgent._id },
        { $set: { pipelineStage: "patterns", stuckReason: "no_email_patterns" } }
      );
      console.log(
        `[generate-email-patterns] demoted_agent=${stuckAgent._id} reason=no_email_patterns`
      );
    }
  }

  const patternAgents = await DOIAgent.find({
    pipelineStage: "patterns",
    agencyDomain: { $ne: "" },
    enrichmentStatus: { $ne: "failed" },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  let inserted = 0;
  let seededFromDiscovery = 0;
  let processed = 0;

  for (const agent of patternAgents) {
    processed += 1;
    if (!agent.agencyDomain) {
      await DOIAgent.updateOne(
        { _id: agent._id },
        { $set: { pipelineStage: "domain", stuckReason: "domain_missing" } }
      );
      continue;
    }
    const res = await generateEmailPatternsForAgent(agent as AgentForPatterns);
    inserted += res.inserted;
    if (res.inserted > 0) {
      await DOIAgent.updateOne(
        { _id: agent._id },
        {
          $set: {
            pipelineStage: "email",
            stuckReason: "",
            emailDiscoveryMode: agent.emailDiscoveryMode || "business_domain",
            lastAttemptAt: new Date(),
          },
        }
      );
    }
  }

  const emailAgents = await DOIAgent.find({
    pipelineStage: "email",
    enrichmentStatus: { $ne: "failed" },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  for (const agent of emailAgents) {
    processed += 1;
    const allowPersonal = agent.emailDiscoveryMode === "personal_fallback" || !agent.agencyDomain;
    const seeded = await seedEmailsFromDiscovery(agent as AgentForPatterns, allowPersonal);
    inserted += seeded.inserted;
    seededFromDiscovery += seeded.inserted;
    if (!seeded.inserted) {
      await DOIAgent.updateOne(
        { _id: agent._id },
        {
          $set: {
            stuckReason: allowPersonal ? "no_personal_emails_found" : "no_emails_found",
          },
        }
      );
    }
  }

  return { processed, inserted, seededFromDiscovery };
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await generateEmailPatternsBatch();
    console.log(
      `[generate-email-patterns] processed=${summary.processed} inserted=${summary.inserted} seeded_from_discovery=${summary.seededFromDiscovery || 0}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[generate-email-patterns] Fatal error:", err?.message || err);
    process.exit(1);
  });
}
