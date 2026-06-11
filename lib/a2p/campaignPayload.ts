import { personalizeA2PSampleMessages } from "@/lib/a2p/flowSelection";

type BuildA2PCampaignPayloadArgs = {
  profile: any;
  brandRegistrationSid: string;
  baseUrl?: string;
  userId?: string;
  usecase?: string;
  messageSamples?: string[];
  messageFlow?: string;
};

type A2PCampaignPayload = {
  brandRegistrationSid: string;
  usAppToPersonUsecase: string;
  description: string;
  messageFlow: string;
  messageSamples: string[];
  hasEmbeddedLinks: boolean;
  hasEmbeddedPhone: boolean;
  subscriberOptIn: true;
  ageGated: false;
  directLending: false;
  privacyPolicyUrl?: string;
  termsAndConditionsUrl?: string;
};

function clean(value: any): string {
  return String(value || "").trim();
}

function isPublicHttpsUrl(value: any): boolean {
  const raw = clean(value);
  if (!/^https:\/\//i.test(raw)) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (!host || !host.includes(".")) return false;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function safeBaseUrl(baseUrl?: string): string {
  const raw = clean(baseUrl);
  return isPublicHttpsUrl(raw) ? raw.replace(/\/$/, "") : "https://www.covecrm.com";
}

function joinUrl(baseUrl: string, path?: string): string {
  const base = safeBaseUrl(baseUrl);
  if (!path) return "";
  return `${base}${path}`;
}

function resolveComplianceUrls(args: BuildA2PCampaignPayloadArgs) {
  const profile = args.profile || {};
  const userId = clean(args.userId || profile.userId);
  const optInUrl = isPublicHttpsUrl(profile.landingOptInUrl)
    ? clean(profile.landingOptInUrl)
    : joinUrl(args.baseUrl || "", userId ? `/sms/optin/${userId}` : "");
  const tosUrl = isPublicHttpsUrl(profile.landingTosUrl)
    ? clean(profile.landingTosUrl)
    : joinUrl(args.baseUrl || "", userId ? `/sms/optin-terms/${userId}` : "");
  const privacyUrl = isPublicHttpsUrl(profile.landingPrivacyUrl)
    ? clean(profile.landingPrivacyUrl)
    : joinUrl(args.baseUrl || "", userId ? `/sms/optin-privacy/${userId}` : "");

  if (!isPublicHttpsUrl(optInUrl) || !isPublicHttpsUrl(tosUrl) || !isPublicHttpsUrl(privacyUrl)) {
    throw new Error("A2P campaign payload missing public compliance URLs");
  }

  return { optInUrl, tosUrl, privacyUrl };
}

function valueAlreadyPresent(text: string, value: string): boolean {
  return Boolean(value) && text.toLowerCase().includes(value.toLowerCase());
}

function appendLineIfMissing(lines: string[], text: string, label: string, value: string) {
  if (value && !valueAlreadyPresent(text, value)) {
    lines.push(`${label}: ${value}`);
  }
}

function ensureDisclosureText(flow: string): string {
  const additions: string[] = [];
  const checks = [
    {
      pattern: /public\s+sms\s+opt-?in\s+page/i,
      text: "End users consent on a public SMS opt-in page.",
    },
    {
      pattern: /separate.*unchecked.*sms\s+consent\s+checkbox|unchecked.*sms\s+consent\s+checkbox/i,
      text: "The page includes a separate unchecked SMS consent checkbox.",
    },
    {
      pattern: /message\s+frequency\s+varies/i,
      text: "Message frequency varies.",
    },
    {
      pattern: /msg\s*&\s*data\s+rates\s+may\s+apply|message\s+and\s+data\s+rates\s+may\s+apply/i,
      text: "Message and data rates may apply.",
    },
    {
      pattern: /stop\s+to\s+(cancel|opt\s*out)|reply\s+stop/i,
      text: "Reply STOP to opt out.",
    },
    {
      pattern: /help\s+for\s+help|reply\s+help/i,
      text: "Reply HELP for help.",
    },
    {
      pattern: /consent\s+is\s+not\s+a\s+condition\s+of\s+purchase/i,
      text: "Consent is not a condition of purchase.",
    },
  ];

  for (const check of checks) {
    if (!check.pattern.test(flow)) additions.push(check.text);
  }

  return additions.length ? `${flow}\n\n${additions.join(" ")}` : flow;
}

function clampMessageFlow(flow: string, linkLines: string[]): string {
  const suffix = linkLines.length ? `\n\n${linkLines.join("\n")}` : "";
  const maxLength = 2048;
  if (`${flow}${suffix}`.length <= maxLength) return `${flow}${suffix}`.trim();

  const available = Math.max(0, maxLength - suffix.length - 1);
  return `${flow.slice(0, available).trim()}${suffix}`.trim();
}

function buildMessageFlow(args: BuildA2PCampaignPayloadArgs): string {
  const profile = args.profile || {};
  const urls = resolveComplianceUrls(args);
  const initial =
    clean(args.messageFlow) ||
    clean(profile.lastSubmittedOptInDetails) ||
    clean(profile.optInDetails) ||
    clean(profile.messageFlow);

  let flow = ensureDisclosureText(
    initial || "End users consent on a public SMS opt-in page using a separate unchecked SMS consent checkbox.",
  );

  const linkLines: string[] = [];
  appendLineIfMissing(linkLines, flow, "Opt-in", urls.optInUrl);
  appendLineIfMissing(linkLines, flow, "Terms", urls.tosUrl);
  appendLineIfMissing(linkLines, flow, "Privacy", urls.privacyUrl);

  return clampMessageFlow(flow, linkLines);
}

function normalizeSamples(args: BuildA2PCampaignPayloadArgs): string[] {
  const profile = args.profile || {};
  const supplied = Array.isArray(args.messageSamples) && args.messageSamples.length
    ? args.messageSamples
    : null;

  const raw =
    supplied ||
    (Array.isArray(profile.lastSubmittedSampleMessages) && profile.lastSubmittedSampleMessages.length
      ? profile.lastSubmittedSampleMessages
      : null) ||
    (Array.isArray(profile.sampleMessagesArr) && profile.sampleMessagesArr.length
      ? profile.sampleMessagesArr
      : null) ||
    [profile.sampleMessage1, profile.sampleMessage2, profile.sampleMessage3].filter(Boolean);

  const list = raw
    .map((sample: any) => clean(sample))
    .filter(Boolean)
    .slice(0, 3);

  if (list.length) return personalizeA2PSampleMessages(list, profile);

  const parsed = clean(profile.sampleMessages)
    .split(/\n{2,}|\r{2,}|\r?\n/)
    .map((sample) => sample.trim())
    .filter(Boolean)
    .slice(0, 3);
  return personalizeA2PSampleMessages(parsed, profile);
}

function buildCampaignDescription(profile: any, usecase: string, messageFlow: string, optInUrl: string): string {
  const storedDescription = clean(profile?.campaignDescription);
  if (storedDescription) {
    return storedDescription.length > 1024 ? storedDescription.slice(0, 1024) : storedDescription;
  }

  const businessName = clean(profile?.businessName) || "this business";
  const useCase = clean(usecase) || "LOW_VOLUME";

  let desc = `Life insurance lead follow-up and appointment reminder SMS campaign for ${businessName}. Use case: ${useCase}. `;
  if (optInUrl) {
    desc += `Public SMS opt-in page: ${optInUrl}. `;
  }
  const flowSnippet = messageFlow.replace(/\s+/g, " ").trim();
  if (flowSnippet) {
    desc += `Opt-in and message flow: ${flowSnippet.slice(0, 300)}`;
  } else {
    desc +=
      "Leads opt in via TCPA-compliant web forms and receive updates about their life insurance options and booked appointments.";
  }

  if (desc.length > 1024) desc = desc.slice(0, 1024);
  if (desc.length < 40) {
    desc += " This campaign sends compliant follow-up and reminder messages to warm leads.";
  }
  return desc;
}

function hasEmbeddedPhone(text: string): boolean {
  return /\+\d{7,}/.test(text) || /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(text);
}

export function buildA2PCampaignPayload(args: BuildA2PCampaignPayloadArgs): A2PCampaignPayload {
  const profile = args.profile || {};
  const urls = resolveComplianceUrls(args);
  const messageFlow = buildMessageFlow(args);
  const messageSamples = normalizeSamples(args);
  const usecase = clean(
    args.usecase ||
      profile.lastSubmittedUseCase ||
      profile.useCase ||
      profile.usecaseCode ||
      profile.useCaseSid ||
      "LOW_VOLUME",
  );
  const searchableText = [messageFlow, ...messageSamples].join(" ");

  return {
    brandRegistrationSid: args.brandRegistrationSid,
    usAppToPersonUsecase: usecase || "LOW_VOLUME",
    description: buildCampaignDescription(profile, usecase, messageFlow, urls.optInUrl),
    messageFlow,
    messageSamples,
    hasEmbeddedLinks: /https?:\/\//i.test(searchableText),
    hasEmbeddedPhone: hasEmbeddedPhone(searchableText),
    subscriberOptIn: true,
    ageGated: false,
    directLending: false,
    ...(urls.privacyUrl ? { privacyPolicyUrl: urls.privacyUrl } : {}),
    ...(urls.tosUrl ? { termsAndConditionsUrl: urls.tosUrl } : {}),
  };
}
