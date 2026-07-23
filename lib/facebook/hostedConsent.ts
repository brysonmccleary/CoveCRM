import { buildLeadGenerationSenderName } from "@/lib/a2p/flowSelection";

export const HOSTED_CONSENT_TEXT_VERSION = "hosted-lead-generation-2026-04-v1";

const LEAD_TYPE_LABELS: Record<string, string> = {
  final_expense: "Final Expense",
  mortgage_protection: "Mortgage Protection",
  iul: "IUL",
  veteran: "Veteran Life Insurance",
  trucker: "Trucker Life Insurance",
  mortgage_protection_veteran: "Veteran Mortgage Protection",
  iul_veteran: "Veteran IUL",
  mortgage_protection_trucker: "Trucker Mortgage Protection",
  iul_trucker: "Trucker IUL",
};

export function hostedLeadTypeLabel(leadType: string, audienceSegment?: string): string {
  const composite = audienceSegment && audienceSegment !== "standard"
    ? `${leadType}_${audienceSegment}`
    : leadType;
  return LEAD_TYPE_LABELS[composite] || LEAD_TYPE_LABELS[leadType] || "Insurance";
}

export function buildHostedConsentText(args: {
  agentName?: string;
  businessName?: string;
  leadType: string;
  audienceSegment?: string;
  complianceOnly?: boolean;
}): string {
  const senderName = buildLeadGenerationSenderName({
    agentName: args.agentName,
    businessName: args.businessName,
  });
  const leadTypeLabel = hostedLeadTypeLabel(args.leadType, args.audienceSegment);
  return args.complianceOnly
    ? `Yes, I agree to receive SMS messages from ${senderName} about my ${leadTypeLabel} request. Messages may include quote discussions, appointment scheduling, application follow-up, customer support, and responses to my inquiry. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not required to submit this request or purchase any product.`
    : `Yes, I agree to receive SMS messages from ${senderName} about my ${leadTypeLabel} request. Messages may include quote discussions, appointment scheduling, application follow-up, customer support, and responses to my inquiry. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. I also agree that a licensed agent may contact me at the phone number I provide via telephone calls, including calls made using artificial or prerecorded voice and AI-assisted voice technology. By checking this box and submitting this form, I agree to the communications described above.`;
}

export function requestIp(headers: Record<string, any>, socketAddress = ""): string {
  const forwarded = String(headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (forwarded || String(headers["x-real-ip"] || "").trim() || socketAddress).slice(0, 200);
}

export function buildHostedConsentEvidence(args: {
  userId: unknown;
  userEmail: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  consentGiven: boolean;
  agentName?: string;
  businessName?: string;
  leadType: string;
  audienceSegment?: string;
  complianceOnly?: boolean;
  pageUrl: string;
  privacyUrl: string;
  termsUrl: string;
  ip: string;
  userAgent: string;
  submittedAt?: Date;
}) {
  return {
    userId: String(args.userId || ""),
    userEmail: String(args.userEmail || "").trim().toLowerCase(),
    flow: "lead_generation" as const,
    firstName: String(args.firstName || "").trim(),
    lastName: String(args.lastName || "").trim(),
    phone: String(args.phone || "").trim(),
    email: String(args.email || "").trim().toLowerCase(),
    consentGiven: args.consentGiven === true,
    consentText: buildHostedConsentText(args),
    consentTextVersion: HOSTED_CONSENT_TEXT_VERSION,
    pageUrl: String(args.pageUrl),
    privacyUrl: String(args.privacyUrl),
    termsUrl: String(args.termsUrl),
    ip: String(args.ip).slice(0, 200),
    userAgent: String(args.userAgent).slice(0, 1000),
    submittedAt: args.submittedAt || new Date(),
  };
}
