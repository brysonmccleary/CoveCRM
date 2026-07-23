import crypto from "crypto";
import MetaLeadFormTemplate from "@/models/MetaLeadFormTemplate";

export type NativeLeadFormSpecification = {
  schemaVersion: "insurance-native-v1";
  leadType: string;
  audienceSegment: string;
  questions: Array<Record<string, any>>;
  privacyPolicy: { url: string; link_text: string };
  customDisclaimer: Record<string, any>;
  followUpActionUrl: string;
  formMode: "HIGHER_INTENT";
  flexibleDelivery: false;
  smsVerification: boolean;
};

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out: Record<string, any>, key) => {
    out[key] = stableValue(value[key]);
    return out;
  }, {});
}

export function buildNativeLeadFormFingerprint(specification: NativeLeadFormSpecification): string {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(specification))).digest("hex");
}

export function assertNativeFormComplianceMode(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production" && String(env.META_NATIVE_FORM_FLEXIBLE_DELIVERY_LOCKED || "").toLowerCase() !== "true") {
    throw new Error(
      "Native Meta forms are disabled until flexible form delivery is confirmed locked off for the configured Graph API version"
    );
  }
}

export async function verifyNativeLeadFormQualitySettings(input: {
  formId: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  formUrl: (formId: string) => string;
}) {
  const url = new URL(input.formUrl(input.formId));
  url.searchParams.set("fields", "id,is_optimized_for_quality,is_phone_sms_verify_enabled,status");
  url.searchParams.set("access_token", input.accessToken);
  const response = await (input.fetchImpl || fetch)(url.toString());
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Meta lead-form verification failed: ${JSON.stringify(json)}`);
  if (json?.is_optimized_for_quality !== true || json?.is_phone_sms_verify_enabled !== true) {
    throw new Error("Meta did not apply required higher-intent and SMS-verification settings to the lead form");
  }
  return json;
}

export async function claimNativeLeadFormTemplate(input: {
  userEmail: string;
  pageId: string;
  formName: string;
  specification: NativeLeadFormSpecification;
}) {
  const userEmail = String(input.userEmail || "").trim().toLowerCase();
  const pageId = String(input.pageId || "").trim();
  if (!userEmail || !pageId) throw new Error("Lead-form template requires a tenant and Facebook Page");
  const fingerprint = buildNativeLeadFormFingerprint(input.specification);
  const ready = await MetaLeadFormTemplate.findOne({ userEmail, pageId, fingerprint, status: "ready", formId: { $ne: "" } }).lean() as any;
  if (ready?.formId) return { fingerprint, formId: String(ready.formId), reused: true, claimToken: "" };

  const claimToken = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  try {
    const claimed = await MetaLeadFormTemplate.findOneAndUpdate(
      {
        userEmail,
        pageId,
        fingerprint,
        $or: [
          { claimToken: { $exists: false } },
          { claimToken: "" },
          { claimedAt: { $lt: staleBefore } },
          { status: "failed" },
        ],
      },
      {
        $setOnInsert: { userEmail, pageId, fingerprint },
        $set: {
          formName: input.formName,
          specification: input.specification,
          status: "creating",
          claimToken,
          claimedAt: new Date(),
          lastError: "",
        },
      },
      { upsert: true, new: true }
    ).lean() as any;
    if (!claimed || claimed.claimToken !== claimToken) throw new Error("An identical Meta lead form is already being created");
    return { fingerprint, formId: "", reused: false, claimToken };
  } catch (error: any) {
    if (error?.code === 11000) throw new Error("An identical Meta lead form is already being created");
    throw error;
  }
}

export async function finalizeNativeLeadFormTemplate(input: {
  userEmail: string;
  pageId: string;
  fingerprint: string;
  claimToken: string;
  formId: string;
}) {
  const updated = await MetaLeadFormTemplate.findOneAndUpdate(
    {
      userEmail: input.userEmail.toLowerCase(),
      pageId: input.pageId,
      fingerprint: input.fingerprint,
      claimToken: input.claimToken,
    },
    { $set: { formId: input.formId, status: "ready", claimToken: "", claimedAt: null, lastError: "" } },
    { new: true }
  ).lean();
  if (!updated) throw new Error("Lead-form template claim was lost before finalization");
}

export async function failNativeLeadFormTemplate(input: {
  userEmail: string;
  pageId: string;
  fingerprint: string;
  claimToken: string;
  error: unknown;
}) {
  await MetaLeadFormTemplate.updateOne(
    {
      userEmail: input.userEmail.toLowerCase(),
      pageId: input.pageId,
      fingerprint: input.fingerprint,
      claimToken: input.claimToken,
    },
    {
      $set: {
        status: "failed",
        claimToken: "",
        claimedAt: null,
        lastError: String(input.error instanceof Error ? input.error.message : input.error || "Meta lead-form creation failed").slice(0, 1000),
      },
    }
  );
}
