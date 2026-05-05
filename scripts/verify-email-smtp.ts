// scripts/verify-email-smtp.ts
// Verifies generated DOI agent emails via SMTP handshake + MX lookup.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import dns from "dns/promises";
import net from "net";
import mongooseConnect from "../lib/mongooseConnect";
import EmailVerification from "../models/EmailVerification";
import DOIAgent from "../models/DOIAgent";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import DomainEmailPattern from "../models/DomainEmailPattern";
import { selectBestEmail } from "../lib/doi/selectBestEmail";
import { DOI_CONFIG } from "./doi-config";

const SMTP_TIMEOUT_MS = 8000;
const DEFAULT_HELO = "covecrm.com";
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
]);

type VerifySummary = {
  processed: number;
  valid: number;
  invalid: number;
  catchAll: number;
  errors: number;
  readyWork: number;
  readyPersonal: number;
};

type HandshakeResult = {
  ok: boolean;
  code?: number;
  reason?: string;
  mxHost?: string;
};

const emailDomain = (email: string) => email.split("@")[1]?.toLowerCase() || "";
const inferEmailType = (email: string) => (PERSONAL_EMAIL_DOMAINS.has(emailDomain(email)) ? "personal" : "domain");
const normalizeVerificationType = (type?: string | null) =>
  type === "personal" ? "personal" : "work";

async function smtpHandshake(email: string): Promise<HandshakeResult> {
  const domain = email.split("@")[1];
  if (!domain) return { ok: false, reason: "invalid_email" };

  const mxRecords = await dns
    .resolveMx(domain)
    .then((records) => records.sort((a, b) => a.priority - b.priority))
    .catch(() => []);

  if (!mxRecords.length) {
    return { ok: false, reason: "no_mx" };
  }

  for (const record of mxRecords) {
    try {
      const result = await attemptServer(record.exchange, email);
      if (result.ok) return { ...result, mxHost: record.exchange };
      if (result.reason === "connect_timeout") continue;
    } catch {
      // try next record
    }
  }

  return { ok: false, reason: "unreachable" };
}

function attemptServer(host: string, email: string): Promise<HandshakeResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection(25, host);
    let resolved = false;
    let lastCode = 0;

    const finish = (ok: boolean, reason?: string) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve({ ok, code: lastCode, reason, mxHost: host });
    };

    socket.setTimeout(SMTP_TIMEOUT_MS, () => finish(false, "connect_timeout"));
    socket.on("error", () => finish(false, "connect_error"));

    let step = 0;
    const commands = [
      `HELO ${DEFAULT_HELO}\r\n`,
      `MAIL FROM:<verify@${DEFAULT_HELO}>\r\n`,
      `RCPT TO:<${email}>\r\n`,
      "QUIT\r\n",
    ];

    socket.on("data", (buffer) => {
      const response = buffer.toString();
      const code = Number(response.slice(0, 3));
      if (!Number.isNaN(code)) {
        lastCode = code;
      }

      if (code >= 400 && code < 600 && step >= 2) {
        finish(false, `smtp_${code}`);
        return;
      }

      if (commands[step]) {
        socket.write(commands[step]);
        step++;
      } else {
        finish(code === 250 || code === 251, `smtp_${code}`);
      }
    });
  });
}

async function detectCatchAll(domain: string, mxHost?: string): Promise<boolean> {
  if (!DOI_CONFIG.detectCatchAll || !mxHost) return false;
  const randomEmail = `probe-${Date.now()}${Math.random().toString(16).slice(2)}@${domain}`;
  const result = await attemptServer(mxHost, randomEmail);
  return !!result.ok;
}

function classifyStatus(outcome: HandshakeResult & { catchAll?: boolean }): string {
  if (outcome.ok && outcome.catchAll) return "catch_all_suspected";
  if (outcome.ok) return "valid";
  if (outcome.reason === "no_mx") return "no_mx";
  if (outcome.reason === "connect_timeout") return "timeout";
  if (outcome.reason?.startsWith("smtp_4")) return "temp_failure";
  if (outcome.reason?.startsWith("smtp_5")) return "invalid";
  if (outcome.reason === "connect_error") return "blocked";
  return "error";
}

const STATUS_BUCKET_MAP: Record<string, string> = {
  valid: "",
  catch_all_suspected: "catch_all",
  no_mx: "no_mx",
  timeout: "timeout",
  temp_failure: "temp_failure",
  blocked: "blocked",
  error: "error",
};

async function recordDomainPatternOutcome(params: {
  domain: string;
  pattern: string;
  status: string;
  catchAll: boolean;
}): Promise<{ confidenceScore: number } | null> {
  const { domain, pattern, status, catchAll } = params;
  if (!domain) return null;
  const normalizedDomain = domain.toLowerCase();
  const normalizedPattern = pattern || "unknown";
  const inc: Record<string, number> = {};
  if (status === "valid") inc.successCount = 1;
  else if (status === "catch_all_suspected") {
    // no-op
  } else {
    inc.failureCount = 1;
  }

  const update: Record<string, any> = {
    $set: { lastTestedAt: new Date() },
    $inc: inc,
    $setOnInsert: {
      confidenceScore: 0,
      catchAll: false,
      pattern: normalizedPattern,
      totalTests: 0,
      totalSuccess: 0,
      totalFailures: 0,
      patternSuccessRate: 0,
      lastSuccessfulPattern: "",
    },
  };
  if (catchAll) update.$set.catchAll = true;

  const doc = await DomainEmailPattern.findOneAndUpdate(
    { domain: normalizedDomain, pattern: normalizedPattern },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const successCount = doc.successCount || 0;
  const failureCount = doc.failureCount || 0;
  const total = successCount + failureCount;
  const confidenceScore = total ? Math.round((successCount / total) * 100) : 0;

  await DomainEmailPattern.updateOne(
    { _id: doc._id },
    {
      $set: {
        confidenceScore,
        patternSuccessRate: confidenceScore,
        totalTests: total,
        totalSuccess: successCount,
        totalFailures: failureCount,
        ...(status === "valid" ? { lastSuccessfulPattern: normalizedPattern } : {}),
      },
    }
  );

  if (status === "valid") {
    await DOIAgent.updateMany(
      { agencyDomain: normalizedDomain },
      { $set: { domainTrustLevel: "trusted_business" } }
    );
  }

  return { confidenceScore };
}

export async function verifyEmail(record: any): Promise<string> {
  const domain = record.email.split("@")[1];
  const timestamp = new Date();
  await EmailVerification.updateOne(
    { _id: record._id },
    { $inc: { attempts: 1 }, $set: { lastAttemptAt: timestamp } }
  );

  if (record.manualDecision === "approved") {
    await EmailVerification.updateOne(
      { _id: record._id },
      {
        $set: {
          smtpValid: true,
          verificationStatus: "valid",
          confidenceScore: Math.max(record.confidenceScore || 0, 90),
          verifiedAt: new Date(),
          reasonBucket: "",
          rejectionReason: "",
        },
      }
    );
    const stats = await recordDomainPatternOutcome({
      domain,
      pattern: record.patternUsed || "unknown",
      status: "valid",
      catchAll: false,
    });
    if (stats?.confidenceScore) {
      await EmailVerification.updateOne(
        { _id: record._id },
        { $max: { confidenceScore: stats.confidenceScore } }
      );
    }
    return "valid";
  }

  if (record.manualDecision === "rejected") {
    await EmailVerification.updateOne(
      { _id: record._id },
      {
        $set: {
          smtpValid: false,
          verificationStatus: "invalid",
          confidenceScore: Math.min(record.confidenceScore || 50, 10),
          verifiedAt: new Date(),
          reasonBucket: "manual_reject",
          rejectionReason: "manual_reject",
        },
      }
    );
    await recordDomainPatternOutcome({
      domain,
      pattern: record.patternUsed || "unknown",
      status: "invalid",
      catchAll: false,
    });
    return "invalid";
  }

  try {
    const outcome = await smtpHandshake(record.email);
    const catchAll = outcome.ok ? await detectCatchAll(domain, outcome.mxHost) : false;
    const status = classifyStatus({ ...outcome, catchAll });
    const smtpValid = status === "valid";
    const verifiedAt = smtpValid ? new Date() : null;
    const reasonBucket = STATUS_BUCKET_MAP[status] || status;
    await EmailVerification.updateOne(
      { _id: record._id },
      {
        $set: {
          smtpValid,
          confidenceScore: smtpValid
            ? Math.max(record.confidenceScore || 0, 90)
            : Math.min(record.confidenceScore || 50, 25),
          verifiedAt,
          verificationStatus: status,
          smtpCode: outcome.code ?? null,
          smtpReason: outcome.reason || "",
          mxHost: outcome.mxHost || "",
          catchAllSuspected: catchAll,
          reasonBucket,
          rejectionReason: smtpValid ? "" : reasonBucket || status,
        },
      }
    );

    const stats = await recordDomainPatternOutcome({
      domain,
      pattern: record.patternUsed || "unknown",
      status,
      catchAll,
    });
    if (stats?.confidenceScore) {
      await EmailVerification.updateOne(
        { _id: record._id },
        { $max: { confidenceScore: stats.confidenceScore } }
      );
    }

    if (smtpValid) {
      await DOIAgentEnrichment.updateOne(
        { agentId: record.agentId },
        { $set: { stage: "verified", lastAttemptAt: timestamp, notes: "SMTP verified" } },
        { upsert: true }
      );
    }

    return status;
  } catch (err: any) {
    const status = "error";
    await EmailVerification.updateOne(
      { _id: record._id },
      {
        $set: {
          smtpValid: false,
          confidenceScore: Math.min(record.confidenceScore || 50, 20),
          verificationStatus: status,
          smtpReason: err?.message || "exception",
          verifiedAt: new Date(),
          reasonBucket: "error",
          rejectionReason: "error",
        },
      }
    );
    await DOIAgentEnrichment.updateOne(
      { agentId: record.agentId },
      { $set: { stage: "failed", notes: err?.message || "SMTP verification error" } },
      { upsert: true }
    );
    await recordDomainPatternOutcome({
      domain,
      pattern: record.patternUsed || "unknown",
      status,
      catchAll: false,
    });
    return status;
  }
}

function mapDomainTrustBand(level?: string | null): "low" | "medium" | "high" | undefined {
  switch (level) {
    case "trusted_business":
    case "government":
      return "high";
    case "generic_directory":
    case "social":
      return "medium";
    case "low_trust":
    case "blacklisted":
      return "low";
    default:
      return undefined;
  }
}

export async function refreshBestEmailForAgent(agent: any) {
  if (!agent?._id) return { bestEmailType: null };

  const verifications = await EmailVerification.find({ agentId: agent._id, smtpValid: true })
    .select("email smtpValid confidenceScore emailType patternUsed catchAllSuspected")
    .lean();

  const result = selectBestEmail({
    agent,
    identityScore: agent.identityScore || 0,
    domainTrustLevel: mapDomainTrustBand(agent.domainTrustLevel),
    verifications,
  });

  let workEmail = "";
  let workEmailConfidence = 0;
  let personalEmail = "";
  let personalEmailConfidence = 0;

  for (const verification of verifications) {
    if (!verification?.smtpValid) continue;
    const type = normalizeVerificationType(verification.emailType as string | undefined);
    if (type === "work" && (verification.confidenceScore || 0) >= workEmailConfidence) {
      workEmail = verification.email;
      workEmailConfidence = verification.confidenceScore || 0;
    } else if (type === "personal" && (verification.confidenceScore || 0) >= personalEmailConfidence) {
      personalEmail = verification.email;
      personalEmailConfidence = verification.confidenceScore || 0;
    }
  }

  const normalizedBestType = result.bestEmailType ? result.bestEmailType : null;

  await DOIAgentEnrichment.updateOne(
    { agentId: agent._id },
    {
      $setOnInsert: { stage: "pending" },
      $set: {
        bestEmail: result.bestEmail || "",
        bestEmailType: normalizedBestType || "",
        bestEmailConfidence: result.bestEmailConfidence || 0,
        workEmail,
        workEmailConfidence,
        personalEmail,
        personalEmailConfidence,
        emailDiscoveryMode: agent.emailDiscoveryMode || "",
      },
    },
    { upsert: true }
  );

  const agentStageUpdate: Record<string, any> = {};
  if (result.bestEmail) {
    agentStageUpdate.pipelineStage = "ready";
    agentStageUpdate.stuckReason = "";
    agentStageUpdate.lastAttemptAt = new Date();
  } else if (agent.pipelineStage === "ready") {
    agentStageUpdate.pipelineStage = "email";
    agentStageUpdate.stuckReason = "no_verified_email";
  }

  if (Object.keys(agentStageUpdate).length) {
    await DOIAgent.updateOne(
      { _id: agent._id },
      { $set: agentStageUpdate }
    );
  }

  return { bestEmailType: normalizedBestType, bestEmail: result.bestEmail || null };
}

export async function verifyQueuedEmails(limit = DOI_CONFIG.verifyBatchSize): Promise<VerifySummary> {
  const cooldownBoundary = new Date(Date.now() - DOI_CONFIG.verifyAttemptCooldownMinutes * 60 * 1000);
  const records = await EmailVerification.find({
    verificationStatus: { $in: ["pending", "temp_failure", "timeout"] },
    $or: [
      { attempts: { $lt: DOI_CONFIG.verifyMaxAttempts } },
      { lastAttemptAt: { $lt: cooldownBoundary } },
      { lastAttemptAt: { $exists: false } },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  const summary: VerifySummary = {
    processed: records.length,
    valid: 0,
    invalid: 0,
    catchAll: 0,
    errors: 0,
    readyWork: 0,
    readyPersonal: 0,
  };

  for (const record of records) {
    const agent = await DOIAgent.findById(record.agentId).lean();
    if (!agent) {
      summary.errors += 1;
      continue;
    }

    const status = await verifyEmail(record);
    await refreshBestEmailForAgent(agent);
    if (status === "valid") summary.valid += 1;
    else if (status === "catch_all_suspected") summary.catchAll += 1;
    else if (["invalid", "no_mx", "timeout", "temp_failure", "blocked"].includes(status)) summary.invalid += 1;
    else summary.errors += 1;
  }

  const readyCounts = await countReadyByType();
  summary.readyWork = readyCounts.readyWork;
  summary.readyPersonal = readyCounts.readyPersonal;

  return summary;
}

async function countReadyByType(): Promise<{ readyWork: number; readyPersonal: number }> {
  const readyAgents = await DOIAgent.find({ pipelineStage: "ready" }).select("_id").lean();
  if (!readyAgents.length) return { readyWork: 0, readyPersonal: 0 };
  const readyIds = readyAgents.map((doc) => doc._id);
  const enrichments = await DOIAgentEnrichment.find({ agentId: { $in: readyIds } })
    .select("bestEmailType")
    .lean();
  let readyWork = 0;
  let readyPersonal = 0;
  for (const enr of enrichments) {
    if (enr.bestEmailType === "personal") readyPersonal += 1;
    else if (enr.bestEmailType === "work" || enr.bestEmailType === "domain") readyWork += 1;
  }
  return { readyWork, readyPersonal };
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await verifyQueuedEmails();
    console.log(
      `[verify-email-smtp] processed=${summary.processed} valid=${summary.valid} catchAll=${summary.catchAll} invalid=${summary.invalid} errors=${summary.errors} ready_work=${summary.readyWork} ready_personal=${summary.readyPersonal}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[verify-email-smtp] Fatal error:", err?.message || err);
    process.exit(1);
  });
}
