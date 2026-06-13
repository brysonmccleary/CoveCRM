export type A2PFlow = "lead_generation" | "servicing";

export type A2PCampaignType =
  | "mortgage_protection"
  | "final_expense"
  | "iul"
  | "veteran"
  | "trucker"
  | "retention"
  | "sold_follow_up";

type FlowSelectionArgs = {
  explicitFlow?: string;
  campaignType?: string;
  leadType?: string;
  optInDetails?: string;
};

type ComplianceUrlArgs = {
  baseUrl?: string;
  userId: string;
  flow?: A2PFlow;
  landingOptInUrl?: string;
  landingTosUrl?: string;
  landingPrivacyUrl?: string;
  useHostedCompliancePages?: boolean;
};

function clean(value: any): string {
  return String(value || "").trim();
}

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = clean(baseUrl).replace(/\/$/, "");
  if (/^https?:\/\//i.test(raw)) return raw;
  return "https://www.covecrm.com";
}

function normalizeCampaignType(value?: string): A2PCampaignType {
  const raw = clean(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (raw.includes("mortgage")) return "mortgage_protection";
  if (raw.includes("final") || raw.includes("expense")) return "final_expense";
  if (raw.includes("iul")) return "iul";
  if (raw.includes("veteran")) return "veteran";
  if (raw.includes("truck")) return "trucker";
  if (raw.includes("sold")) return "sold_follow_up";
  if (raw.includes("retention") || raw.includes("servicing") || raw.includes("customer")) return "retention";
  return "final_expense";
}

export function resolveA2PFlow(args: FlowSelectionArgs = {}): {
  flow: A2PFlow;
  campaignType: A2PCampaignType;
} {
  const campaignType = normalizeCampaignType(args.campaignType || args.leadType);
  const explicit = clean(args.explicitFlow).toLowerCase();
  const text = `${args.campaignType || ""} ${args.leadType || ""} ${args.optInDetails || ""}`.toLowerCase();

  if (explicit === "servicing" || explicit === "lead_generation") {
    return { flow: explicit as A2PFlow, campaignType };
  }

  if (
    campaignType === "retention" ||
    campaignType === "sold_follow_up" ||
    /\b(retention|sold|servicing|existing customer|current policy|policy update|account servicing)\b/i.test(text)
  ) {
    return { flow: "servicing", campaignType };
  }

  return { flow: "lead_generation", campaignType };
}

export function resolveA2PComplianceUrls(args: ComplianceUrlArgs) {
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  const userId = encodeURIComponent(clean(args.userId));
  const flow = args.flow || "lead_generation";
  const hosted = args.useHostedCompliancePages !== false;

  const hostedUrls =
    flow === "servicing"
      ? {
          optInUrl: `${baseUrl}/sms/optin/${userId}`,
          tosUrl: `${baseUrl}/sms/optin-terms/${userId}`,
          privacyUrl: `${baseUrl}/sms/optin-privacy/${userId}`,
        }
      : {
          optInUrl: `${baseUrl}/sms/lead-optin/${userId}`,
          tosUrl: `${baseUrl}/sms/lead-optin-terms/${userId}`,
          privacyUrl: `${baseUrl}/sms/lead-optin-privacy/${userId}`,
        };

  return {
    ...(!hosted
      ? {
          optInUrl: clean(args.landingOptInUrl) || hostedUrls.optInUrl,
          tosUrl: clean(args.landingTosUrl) || hostedUrls.tosUrl,
          privacyUrl: clean(args.landingPrivacyUrl) || hostedUrls.privacyUrl,
        }
      : hostedUrls),
    hosted,
    flow,
  };
}

export function buildLeadGenerationMessageFlow(urls: {
  optInUrl: string;
  tosUrl: string;
  privacyUrl: string;
}): string {
  return buildLeadGenerationOptInDetails(urls.optInUrl);
}

export function buildLeadGenerationOptInDetails(optInUrl = "{{LANDING_OPTIN_URL}}"): string {
  const url = clean(optInUrl) || "{{LANDING_OPTIN_URL}}";
  return `This campaign sends SMS messages from the sender to consumers who request information about final expense coverage, life insurance, and related insurance options. Messages may include follow-up communication, appointment coordination, application follow-up, customer support, and responses to consumer requests. End users opt in through the sender's public CoveCRM-hosted Final Expense landing page at ${url} with a separate unchecked SMS consent checkbox. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for assistance. Consent is not a condition of purchase.

Before submission, users see a disclosure similar to:

"By checking this box, you agree to receive SMS messages from the sender about final expense coverage, life insurance, and related insurance options. Messages may include follow-up communication, appointment coordination, application follow-up, customer support, and responses to your request. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase."

The opt-in page displays SMS Terms and SMS Privacy links on the same page as the form submission. Consent records may be retained as needed for compliance and audit purposes.`;
}

export function buildServicingMessageFlow(urls: {
  optInUrl: string;
  tosUrl: string;
  privacyUrl: string;
}): string {
  return `This campaign sends service-related SMS messages to existing insurance customers who explicitly opt in after becoming customers. Messages are used for policy updates, account servicing, retention-related communications, customer support, and other non-promotional messages related to the customer's existing policy relationship.

End users opt in through a dedicated SMS opt-in page provided by CoveCRM for the sender. The form collects name and mobile phone number and presents a separate unchecked SMS consent checkbox directly above the Submit button. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase.

Opt-in: ${urls.optInUrl}
Terms: ${urls.tosUrl}
Privacy: ${urls.privacyUrl}`;
}

export function buildA2PMessageFlowForFlow(flow: A2PFlow, urls: {
  optInUrl: string;
  tosUrl: string;
  privacyUrl: string;
}): string {
  return flow === "servicing" ? buildServicingMessageFlow(urls) : buildLeadGenerationMessageFlow(urls);
}

export function resolveA2PSampleAgentName(args: {
  contactFirstName?: any;
  contactLastName?: any;
  businessName?: any;
}): string {
  const fullName = [args.contactFirstName, args.contactLastName]
    .map((part) => clean(part))
    .filter(Boolean)
    .join(" ");
  return fullName || clean(args.businessName) || "a licensed insurance agent";
}

export function personalizeA2PSampleMessage(sample: any, args: {
  contactFirstName?: any;
  contactLastName?: any;
  businessName?: any;
}): string {
  const agent = resolveA2PSampleAgentName(args);
  const personalized = clean(sample)
    .replace(/\{\{\s*agentName\s*\}\}/gi, agent)
    .replace(/\{\{\s*agent_name\s*\}\}/gi, agent);

  if (agent === "your insurance agent") return personalized;
  return personalized.replace(/\bthis is your insurance agent\b/gi, `this is ${agent}`);
}

export function personalizeA2PSampleMessages(samples: any[], args: {
  contactFirstName?: any;
  contactLastName?: any;
  businessName?: any;
}): string[] {
  return samples.map((sample) => personalizeA2PSampleMessage(sample, args)).filter(Boolean);
}

export function buildLeadGenerationSampleMessages(): string[] {
  return [
    `Hi {{first_name}}, this is {{agent_name}}. I received the Final Expense request you submitted and wanted to help you review your options. When would be a good time for a quick call? Reply STOP to opt out.`,
    `Hi {{first_name}}, this is {{agent_name}} following up on the Final Expense request you recently submitted. Do you have a few minutes later today or tomorrow to connect? Reply STOP to opt out.`,
    `Hi {{first_name}}, this is {{agent_name}}. I didn't want to miss you regarding your Final Expense request. If you're still interested in reviewing your options, let me know a good time to reach you. Reply STOP to opt out.`,
  ];
}
