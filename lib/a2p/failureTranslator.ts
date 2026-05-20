import crypto from "crypto";

export type A2PFailureStage =
  | "business_profile"
  | "trust_product"
  | "brand"
  | "campaign"
  | "unknown";

type FailureTranslation = {
  simpleTitle: string;
  simpleExplanation: string;
  requiredFields: string[];
  userActionNeeded: boolean;
  canAutoResubmit: boolean;
};

function normalizeStage(stage?: string): A2PFailureStage {
  const raw = String(stage || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (raw === "business_profile" || raw === "profile" || raw === "customer_profile") return "business_profile";
  if (raw === "trust_product" || raw === "trusthub" || raw === "trust_hub") return "trust_product";
  if (raw === "brand" || raw === "brand_registration") return "brand";
  if (raw === "campaign" || raw === "us_a2p" || raw === "usa2p") return "campaign";
  return "unknown";
}

function normalizeText(value: any): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  try {
    return JSON.stringify(value).replace(/\s+/g, " ").trim();
  } catch {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
}

function signatureFor(stage: A2PFailureStage, rawCode: string, rawMessage: string) {
  const normalizedMessage = rawMessage.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto
    .createHash("sha256")
    .update([stage, rawCode.toLowerCase(), normalizedMessage].join("|"))
    .digest("hex")
    .slice(0, 32);
}

function translate(rawCode: string, rawMessage: string, stage: A2PFailureStage): FailureTranslation {
  const haystack = `${rawCode} ${rawMessage}`.toLowerCase();

  if (haystack.includes("22218") || haystack.includes("company_type") || haystack.includes("company type")) {
    return {
      simpleTitle: "Business type needs to be updated",
      simpleExplanation:
        "Twilio could not verify the selected business type. Please confirm the business is listed as a private company, sole proprietor, nonprofit, or another matching legal type.",
      requiredFields: ["businessType"],
      userActionNeeded: true,
      canAutoResubmit: true,
    };
  }

  if (
    haystack.includes("ein") ||
    haystack.includes("tax id") ||
    haystack.includes("taxid") ||
    haystack.includes("business name mismatch") ||
    haystack.includes("legal business name") ||
    haystack.includes("does not match")
  ) {
    return {
      simpleTitle: "Business name or EIN does not match",
      simpleExplanation:
        "The legal business name and EIN must match IRS or business registration records exactly.",
      requiredFields: ["businessName", "ein"],
      userActionNeeded: true,
      canAutoResubmit: true,
    };
  }

  if (
    haystack.includes("address") ||
    haystack.includes("street") ||
    haystack.includes("postal") ||
    haystack.includes("zip")
  ) {
    return {
      simpleTitle: "Business address could not be verified",
      simpleExplanation:
        "Twilio could not match the business address to public records. Please enter the exact address used on your EIN, IRS, or business registration records.",
      requiredFields: ["address", "addressCity", "addressState", "addressPostalCode"],
      userActionNeeded: true,
      canAutoResubmit: true,
    };
  }

  if (
    haystack.includes("website") ||
    haystack.includes("privacy") ||
    haystack.includes("terms") ||
    haystack.includes("tos") ||
    haystack.includes("opt-in") ||
    haystack.includes("opt in") ||
    haystack.includes("consent")
  ) {
    return {
      simpleTitle: "Compliance page information is missing",
      simpleExplanation:
        "Twilio needs a working website, privacy policy, terms page, and SMS opt-in explanation before registration can be approved.",
      requiredFields: ["website", "landingPrivacyUrl", "landingTosUrl", "optInDetails"],
      userActionNeeded: true,
      canAutoResubmit: true,
    };
  }

  if (
    haystack.includes("sample message") ||
    haystack.includes("sample_messages") ||
    haystack.includes("samplemessages") ||
    haystack.includes("opt-out") ||
    haystack.includes("opt out") ||
    haystack.includes(" stop") ||
    haystack.includes(" help")
  ) {
    return {
      simpleTitle: "Sample messages need updates",
      simpleExplanation:
        "The sample text messages need to clearly match your use case and include opt-out language such as Reply STOP to opt out.",
      requiredFields: ["sampleMessages"],
      userActionNeeded: true,
      canAutoResubmit: true,
    };
  }

  if (stage === "brand" || stage === "campaign") {
    return {
      simpleTitle: "SMS registration needs review",
      simpleExplanation:
        "Twilio rejected the registration, but did not provide a clear reason. CoveCRM will review the registration details and prepare the next safe resubmission step.",
      requiredFields: [],
      userActionNeeded: false,
      canAutoResubmit: false,
    };
  }

  return {
    simpleTitle: "SMS registration needs review",
    simpleExplanation:
      "The SMS registration could not be approved yet. CoveCRM will review the registration details and guide the next step.",
    requiredFields: [],
    userActionNeeded: false,
    canAutoResubmit: false,
  };
}

export function buildA2PFailureObject(args: {
  stage?: string;
  rawCode?: any;
  rawMessage?: any;
  previousSignature?: string;
}): {
  stage: A2PFailureStage;
  rawCode?: string;
  rawMessage?: string;
  simpleTitle: string;
  simpleExplanation: string;
  requiredFields: string[];
  userActionNeeded: boolean;
  canAutoResubmit: boolean;
  signature: string;
  lastDetectedAt: Date;
} {
  void args.previousSignature;
  const stage = normalizeStage(args.stage);
  const rawCode = normalizeText(args.rawCode);
  const rawMessage = normalizeText(args.rawMessage);
  const translated = translate(rawCode, rawMessage, stage);
  const signature = signatureFor(stage, rawCode, rawMessage);

  return {
    stage,
    ...(rawCode ? { rawCode } : {}),
    ...(rawMessage ? { rawMessage } : {}),
    ...translated,
    signature,
    lastDetectedAt: new Date(),
  };
}
