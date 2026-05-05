import { callKimiProvider } from "@/lib/ai/providers/kimiProvider";
import { callOpenAIChatProvider } from "@/lib/ai/providers/openaiProvider";
import { sanitizeProviderError } from "@/lib/ai/providers/providerEnv";
import type { AiProviderChatResult } from "@/lib/ai/providers/types";
import AdminAiAuditLog from "@/models/AdminAiAuditLog";
import { classifyA2PIssue, type A2PClassification, type A2PIssueType } from "./a2pClassification";

export type ComplianceWarning = {
  severity: "low" | "medium" | "high";
  message: string;
};

export type A2PCorrectionDraft = {
  classification: A2PClassification;
  issueType: A2PIssueType;
  confidence: number;
  rejectionReason: string;
  likelyCause: string;
  correctedCampaignDescription: string;
  correctedOptInDescription: string;
  correctedSampleMessages: string[];
  correctedPrivacyPolicyNotes: string;
  correctedTermsNotes: string;
  missingInfoNeeded: string[];
  complianceWarnings: ComplianceWarning[];
  shouldAutoResubmit: boolean;
  customerEmailSubject: string;
  customerEmailBody: string;
  internalAdminSummary: string;
  proposedPayload: Record<string, any>;
  provider?: string;
};

type GenerateA2PCorrectionArgs = {
  user: any;
  a2pRecord: any;
  rejectionReason?: string;
  existingSubmission?: any;
  supportContext?: any;
};

const PROVIDER_FAILURE_CAUSE = "AI correction could not be generated automatically. Admin review is required.";
const PROVIDER_FAILURE_MISSING_INFO = "Admin review required before corrected A2P content can be submitted.";
const WEBSITE_MISSING_INFO = "Valid business website URL";
const PRIVACY_MISSING_INFO = "Privacy policy URL";
const TERMS_MISSING_INFO = "Terms of service URL";
const CUSTOMER_ACTION_SUBJECT = "Action needed to complete your CoveCRM texting approval";

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function text(value: any, max = 4000) {
  const out = String(value || "").trim();
  return out.length > max ? out.slice(0, max).trim() : out;
}

function addMissingInfo(list: string[], item: string) {
  if (!list.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
    list.push(item);
  }
}

function isPlaceholderValue(value: any) {
  const lower = String(value || "").trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("example.com") ||
    lower.includes("test.com") ||
    lower.includes("placeholder") ||
    lower === "https://www.yourwebsite.com" ||
    lower === "https://yourwebsite.com" ||
    lower === "http://yourwebsite.com"
  );
}

function cleanUrl(value: any): string | null {
  const candidate = text(value, 500);
  if (!candidate || isPlaceholderValue(candidate)) return null;
  if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(candidate)) return null;
  return candidate;
}

function getStoredWebsite(args: GenerateA2PCorrectionArgs): string | null {
  return (
    cleanUrl(args.user?.website) ||
    cleanUrl(args.user?.businessWebsite) ||
    cleanUrl(args.user?.companyWebsite) ||
    cleanUrl(args.a2pRecord?.website) ||
    cleanUrl(args.a2pRecord?.businessWebsite) ||
    cleanUrl(args.existingSubmission?.website) ||
    null
  );
}

function getStoredPrivacyPolicyUrl(args: GenerateA2PCorrectionArgs): string | null {
  return (
    cleanUrl(args.user?.privacyPolicyUrl) ||
    cleanUrl(args.user?.privacyUrl) ||
    cleanUrl(args.a2pRecord?.landingPrivacyUrl) ||
    cleanUrl(args.a2pRecord?.privacyPolicyUrl) ||
    cleanUrl(args.existingSubmission?.landingPrivacyUrl) ||
    cleanUrl(args.existingSubmission?.privacyPolicyUrl) ||
    null
  );
}

function getStoredTermsUrl(args: GenerateA2PCorrectionArgs): string | null {
  return (
    cleanUrl(args.user?.termsUrl) ||
    cleanUrl(args.user?.termsOfServiceUrl) ||
    cleanUrl(args.a2pRecord?.landingTosUrl) ||
    cleanUrl(args.a2pRecord?.termsUrl) ||
    cleanUrl(args.a2pRecord?.termsOfServiceUrl) ||
    cleanUrl(args.existingSubmission?.landingTosUrl) ||
    cleanUrl(args.existingSubmission?.termsUrl) ||
    cleanUrl(args.existingSubmission?.termsOfServiceUrl) ||
    null
  );
}

function scrubPlaceholderPayload(value: any): any {
  if (Array.isArray(value)) {
    return value.map(scrubPlaceholderPayload).filter((item) => item !== undefined && item !== "");
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, nested]) => [key, scrubPlaceholderPayload(nested)])
        .filter(([, nested]) => nested !== undefined && nested !== "")
    );
  }
  if (typeof value === "string" && isPlaceholderValue(value)) return undefined;
  return value;
}

function stringArray(value: any, limit = 6): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value
        .split(/\n+|(?:^|\s)[-•]\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  return values.map((item) => text(item, 600)).filter(Boolean).slice(0, limit);
}

function sampleMessageArray(raw: any): string[] {
  const candidates = [
    raw?.correctedSampleMessages,
    raw?.sampleMessages,
    raw?.proposedPayload?.correctedSampleMessages,
    raw?.proposedPayload?.sampleMessages,
    raw?.proposedPayload?.sampleMessagesArr,
  ];
  for (const candidate of candidates) {
    const messages = stringArray(candidate);
    if (messages.length) return messages;
  }
  return [];
}

function buildCustomerEmailBody(missingInfoNeeded: string[]) {
  const normalized = missingInfoNeeded.map((item) => String(item || "").toLowerCase());
  const missingUrlItems = [
    normalized.some((item) => item.includes("website")) ? "Business website URL" : "",
    normalized.some((item) => item.includes("privacy")) ? PRIVACY_MISSING_INFO : "",
    normalized.some((item) => item.includes("terms") || item.includes("tos")) ? TERMS_MISSING_INFO : "",
  ].filter(Boolean);

  if (missingUrlItems.length) {
    return [
      "Hi there,",
      "",
      "We’re close to finishing your CoveCRM texting approval, but we need a few details before we can complete it:",
      "",
      ...missingUrlItems.map((item) => `• ${item}`),
      "",
      "Once you send those over, we’ll prepare the corrected texting submission and take care of the next step for you.",
      "",
      "Thanks,",
      "CoveCRM Support",
    ].join("\n");
  }

  return [
    "Hi there,",
    "",
    "We’re close to finishing your CoveCRM texting approval, but we need a couple details before we can complete it.",
    "",
    "Once you send those over, we’ll prepare the corrected texting submission and take care of the next step for you.",
    "",
    "Thanks,",
    "CoveCRM Support",
  ].join("\n");
}

function warningArray(value: any): ComplianceWarning[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      severity: ["low", "medium", "high"].includes(String(item?.severity || "").toLowerCase())
        ? (String(item.severity).toLowerCase() as "low" | "medium" | "high")
        : "medium",
      message: text(item?.message, 400),
    }))
    .filter((item) => item.message)
    .slice(0, 8);
}

function hasHighWarning(warnings: ComplianceWarning[]) {
  return warnings.some((warning) => warning.severity === "high");
}

function correctedPayloadValid(draft: Pick<A2PCorrectionDraft, "correctedCampaignDescription" | "correctedOptInDescription" | "correctedSampleMessages">) {
  return Boolean(
    text(draft.correctedCampaignDescription, 4000).length >= 20 &&
      text(draft.correctedOptInDescription, 4000).length >= 20 &&
      Array.isArray(draft.correctedSampleMessages) &&
      draft.correctedSampleMessages.length > 0
  );
}

function getUserId(args: GenerateA2PCorrectionArgs) {
  return String(args.user?.id || args.user?._id || args.a2pRecord?.userId || "");
}

function getUserEmail(args: GenerateA2PCorrectionArgs) {
  return String(args.user?.email || args.a2pRecord?.userEmail || "").toLowerCase();
}

async function auditProviderFailure(args: GenerateA2PCorrectionArgs, result: Partial<AiProviderChatResult> & { error?: any }) {
  try {
    const userId = getUserId(args);
    const userEmail = getUserEmail(args);
    await AdminAiAuditLog.create({
      userId,
      userEmail,
      targetUserId: userId,
      targetUserEmail: userEmail,
      source: "a2p_failure_detector",
      taskType: "a2p_correction",
      provider: result.provider || "",
      inputSummary: "A2P correction provider request failed.",
      outputSummary: "Returned safe admin-review fallback.",
      status: "failed",
      error: sanitizeProviderError(result.error || result.errorCode || "provider_error"),
      eventType: "a2p_correction_provider_failed",
      metadata: {
        status: result.status || null,
        model: result.model || "",
        errorCode: result.errorCode || "",
      },
    });
  } catch (auditErr) {
    console.warn("[a2pCorrectionService] Failed to write provider failure audit log", sanitizeProviderError(auditErr));
  }
}

function fallbackDraft(args: GenerateA2PCorrectionArgs, options?: { providerFailure?: boolean; internalReason?: string }): A2PCorrectionDraft {
  const local = classifyA2PIssue({
    rejectionReason: args.rejectionReason,
    a2pRecord: args.a2pRecord,
    existingSubmission: args.existingSubmission,
  });
  const providerFailure = Boolean(options?.providerFailure);
  const safeReason = providerFailure ? PROVIDER_FAILURE_CAUSE : text(options?.internalReason || local.reason, 500);
  return {
    classification: providerFailure ? "needs_user_input" : local.classification,
    issueType: providerFailure ? "unknown" : local.issueType,
    confidence: 0,
    rejectionReason: text(args.rejectionReason || args.a2pRecord?.lastError || args.a2pRecord?.declinedReason),
    likelyCause: safeReason,
    correctedCampaignDescription: "",
    correctedOptInDescription: "",
    correctedSampleMessages: [],
    correctedPrivacyPolicyNotes: "",
    correctedTermsNotes: "",
    missingInfoNeeded: [PROVIDER_FAILURE_MISSING_INFO],
    complianceWarnings: [{ severity: "medium", message: "AI correction unavailable or incomplete." }],
    shouldAutoResubmit: false,
    customerEmailSubject: CUSTOMER_ACTION_SUBJECT,
    customerEmailBody: buildCustomerEmailBody([PROVIDER_FAILURE_MISSING_INFO]),
    internalAdminSummary: safeReason,
    proposedPayload: {},
  };
}

function buildPrompt(args: GenerateA2PCorrectionArgs) {
  const local = classifyA2PIssue({
    rejectionReason: args.rejectionReason,
    a2pRecord: args.a2pRecord,
    existingSubmission: args.existingSubmission,
  });

  return [
    {
      role: "system" as const,
      content: [
        "You are CoveCRM's internal A2P compliance correction assistant.",
        "Diagnose Twilio A2P failures using user, CRM, Twilio, and submission context.",
        "Do not perform actions. Do not promise approval. Generate review-ready content only.",
        "Return strict JSON only. No markdown.",
        "Required keys: classification, issueType, confidence, rejectionReason, likelyCause, correctedCampaignDescription, correctedOptInDescription, correctedSampleMessages, correctedPrivacyPolicyNotes, correctedTermsNotes, missingInfoNeeded, complianceWarnings, shouldAutoResubmit, customerEmailSubject, customerEmailBody, internalAdminSummary, proposedPayload.",
        "classification must be one of: simple, complex, needs_user_input, unsafe.",
        "issueType must be one of: missing_opt_out, weak_opt_in_language, bad_sample_message, missing_business_info, invalid_website, business_mismatch, prohibited_content, unclear_use_case, unknown.",
        "Never invent website URLs, privacy policy URLs, terms URLs, business names, EINs, addresses, or legal identity details.",
        "If required business identity or website data is missing, leave proposedPayload fields empty and add the exact missing item to missingInfoNeeded.",
        "Never use placeholder domains such as example.com, test.com, yourwebsite.com, or placeholder URLs.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        localClassification: local,
        user: args.user,
        a2pRecord: args.a2pRecord,
        rejectionReason: args.rejectionReason,
        existingSubmission: args.existingSubmission,
        supportContext: args.supportContext,
      }),
    },
  ];
}

function normalizeDraft(raw: any, args: GenerateA2PCorrectionArgs, provider?: string): A2PCorrectionDraft {
  const local = classifyA2PIssue({
    rejectionReason: args.rejectionReason,
    a2pRecord: args.a2pRecord,
    existingSubmission: args.existingSubmission,
  });

  const confidence = Number(raw?.confidence || 0);
  let classification = ["simple", "complex", "needs_user_input", "unsafe"].includes(String(raw?.classification || ""))
    ? (String(raw.classification) as A2PClassification)
    : local.classification;
  const issueType = [
    "missing_opt_out",
    "weak_opt_in_language",
    "bad_sample_message",
    "missing_business_info",
    "invalid_website",
    "business_mismatch",
    "prohibited_content",
    "unclear_use_case",
    "unknown",
  ].includes(String(raw?.issueType || ""))
    ? (String(raw.issueType) as A2PIssueType)
    : local.issueType;

  const storedWebsite = getStoredWebsite(args);
  const storedPrivacyPolicyUrl = getStoredPrivacyPolicyUrl(args);
  const storedTermsUrl = getStoredTermsUrl(args);
  const rawPayload = raw?.proposedPayload && typeof raw.proposedPayload === "object" ? scrubPlaceholderPayload(raw.proposedPayload) : {};
  const payloadHadPlaceholder = JSON.stringify(raw?.proposedPayload || {}).toLowerCase().match(/example\.com|test\.com|placeholder|yourwebsite\.com/);

  const draft: A2PCorrectionDraft = {
    classification,
    issueType,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    rejectionReason: text(raw?.rejectionReason || args.rejectionReason || args.a2pRecord?.lastError || args.a2pRecord?.declinedReason),
    likelyCause: text(raw?.likelyCause || local.reason),
    correctedCampaignDescription: text(raw?.correctedCampaignDescription),
    correctedOptInDescription: text(raw?.correctedOptInDescription),
    correctedSampleMessages: sampleMessageArray(raw),
    correctedPrivacyPolicyNotes: text(raw?.correctedPrivacyPolicyNotes),
    correctedTermsNotes: text(raw?.correctedTermsNotes),
    missingInfoNeeded: stringArray(raw?.missingInfoNeeded),
    complianceWarnings: warningArray(raw?.complianceWarnings),
    shouldAutoResubmit: Boolean(raw?.shouldAutoResubmit),
    customerEmailSubject: CUSTOMER_ACTION_SUBJECT,
    customerEmailBody: "",
    internalAdminSummary: text(raw?.internalAdminSummary || raw?.likelyCause || local.reason),
    proposedPayload: rawPayload && typeof rawPayload === "object" ? rawPayload : {},
    provider,
  };

  if (!storedWebsite) {
    classification = "needs_user_input";
    draft.classification = "needs_user_input";
    addMissingInfo(draft.missingInfoNeeded, WEBSITE_MISSING_INFO);
    draft.proposedPayload.website = null;
  } else {
    draft.proposedPayload.website = storedWebsite;
  }
  if (!storedPrivacyPolicyUrl) {
    draft.classification = "needs_user_input";
    addMissingInfo(draft.missingInfoNeeded, PRIVACY_MISSING_INFO);
    draft.proposedPayload.privacyPolicyUrl = null;
  } else {
    draft.proposedPayload.privacyPolicyUrl = storedPrivacyPolicyUrl;
  }
  if (!storedTermsUrl) {
    draft.classification = "needs_user_input";
    addMissingInfo(draft.missingInfoNeeded, TERMS_MISSING_INFO);
    draft.proposedPayload.termsOfServiceUrl = null;
  } else {
    draft.proposedPayload.termsOfServiceUrl = storedTermsUrl;
  }

  const payloadValues = [
    draft.correctedCampaignDescription,
    draft.correctedOptInDescription,
    draft.correctedPrivacyPolicyNotes,
    draft.correctedTermsNotes,
    ...draft.correctedSampleMessages,
    JSON.stringify(draft.proposedPayload || {}),
  ];
  if (payloadHadPlaceholder || payloadValues.some(isPlaceholderValue)) {
    draft.classification = "needs_user_input";
    addMissingInfo(draft.missingInfoNeeded, "Non-placeholder business URLs and compliance links");
    draft.correctedCampaignDescription = isPlaceholderValue(draft.correctedCampaignDescription) ? "" : draft.correctedCampaignDescription;
    draft.correctedOptInDescription = isPlaceholderValue(draft.correctedOptInDescription) ? "" : draft.correctedOptInDescription;
    draft.correctedPrivacyPolicyNotes = isPlaceholderValue(draft.correctedPrivacyPolicyNotes) ? "" : draft.correctedPrivacyPolicyNotes;
    draft.correctedTermsNotes = isPlaceholderValue(draft.correctedTermsNotes) ? "" : draft.correctedTermsNotes;
    draft.correctedSampleMessages = draft.correctedSampleMessages.filter((message) => !isPlaceholderValue(message));
    draft.proposedPayload = scrubPlaceholderPayload(draft.proposedPayload) || {};
    if (!storedWebsite) draft.proposedPayload.website = null;
    if (!storedPrivacyPolicyUrl) draft.proposedPayload.privacyPolicyUrl = null;
    if (!storedTermsUrl) draft.proposedPayload.termsOfServiceUrl = null;
  }

  if (!correctedPayloadValid(draft)) {
    draft.shouldAutoResubmit = false;
    if (!draft.missingInfoNeeded.length) draft.missingInfoNeeded.push("Corrected campaign, opt-in, or sample message content is incomplete.");
  }
  if (draft.missingInfoNeeded.length > 0 || hasHighWarning(draft.complianceWarnings) || draft.classification !== "simple") {
    draft.shouldAutoResubmit = false;
  }
  draft.proposedPayload = {
    ...draft.proposedPayload,
    correctedCampaignDescription: draft.correctedCampaignDescription,
    correctedOptInDescription: draft.correctedOptInDescription,
    correctedSampleMessages: draft.correctedSampleMessages,
    correctedPrivacyPolicyNotes: draft.correctedPrivacyPolicyNotes,
    correctedTermsNotes: draft.correctedTermsNotes,
  };
  delete draft.proposedPayload.sampleMessages;
  delete draft.proposedPayload.sampleMessagesArr;
  if (!storedWebsite) draft.proposedPayload.website = null;
  if (!storedPrivacyPolicyUrl) draft.proposedPayload.privacyPolicyUrl = null;
  if (!storedTermsUrl) draft.proposedPayload.termsOfServiceUrl = null;
  draft.customerEmailBody = buildCustomerEmailBody(draft.missingInfoNeeded);

  return draft;
}

export function validateA2PCorrectionPayload(draft: A2PCorrectionDraft) {
  const payloadText = JSON.stringify(draft.proposedPayload || {});
  return correctedPayloadValid(draft) && !draft.missingInfoNeeded.length && !isPlaceholderValue(payloadText) && Boolean(cleanUrl(draft.proposedPayload?.website));
}

export async function generateA2PCorrection(args: GenerateA2PCorrectionArgs): Promise<A2PCorrectionDraft> {
  const messages = buildPrompt(args);

  try {
    const kimi = await callKimiProvider({ messages, temperature: 0.1, maxTokens: 1800 });
    const preferred = kimi.ok
      ? kimi
      : await callOpenAIChatProvider({ messages, temperature: 0.1, maxTokens: 1800 });

    if (!preferred.ok || !preferred.content) {
      await auditProviderFailure(args, preferred);
      return fallbackDraft(args, { providerFailure: true, internalReason: preferred.error || "provider_not_available" });
    }

    const parsed = safeJsonParse(preferred.content);
    if (!parsed) {
      const draft = fallbackDraft(args, { internalReason: "AI response could not be parsed as JSON." });
      draft.complianceWarnings.push({ severity: "medium", message: preferred.content.slice(0, 300) });
      return draft;
    }

    return normalizeDraft(parsed, args, preferred.provider);
  } catch (err: any) {
    await auditProviderFailure(args, { provider: "openai", error: err, errorCode: "a2p_correction_failed" });
    return fallbackDraft(args, { providerFailure: true, internalReason: sanitizeProviderError(err) });
  }
}
