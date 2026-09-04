import crypto from "crypto";
import MetaLeadFormTemplate from "@/models/MetaLeadFormTemplate";

export type NativeLeadFormSpecification = {
  schemaVersion: "insurance-native-v2-dob";
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

function normalizedQuestions(questions: unknown): Array<Record<string, any>> {
  if (!Array.isArray(questions)) return [];
  return questions.map((question: any) => {
    const type = String(question?.type || "");
    if (["FULL_NAME", "PHONE", "EMAIL", "STATE"].includes(type)) {
      return { type };
    }

    const normalized: Record<string, any> = { type };
    if (question?.label !== undefined) normalized.label = String(question.label);
    if (question?.key !== undefined) normalized.key = String(question.key);
    if (Array.isArray(question?.options)) {
      normalized.options = question.options.map((option: any) => ({
        key: String(option?.key || ""),
        value: String(option?.value || ""),
      }));
    }
    return normalized;
  });
}

function metaErrorPayload(value: any) {
  return value?.error && typeof value.error === "object" ? value.error : {};
}

function isUnsupportedSmsVerificationReadback(value: any): boolean {
  const error = metaErrorPayload(value);
  return Number(error?.code) === 100 &&
    /is_phone_sms_verify_enabled|nonexisting field/i.test(String(error?.message || ""));
}

export function isMetaDuplicateNativeLeadFormNameError(value: any): boolean {
  const error = metaErrorPayload(value);
  return Number(error?.code) === 100 && Number(error?.error_subcode) === 1892019;
}

export function assertNativeLeadFormMatchesSpecification(input: {
  actual: any;
  expectedFormId: string;
  expectedFormName: string;
  expectedSpecification: NativeLeadFormSpecification;
}) {
  const actualId = String(input.actual?.id || "");
  if (actualId !== input.expectedFormId) {
    throw new Error(`Meta lead-form verification failed: expected id=${input.expectedFormId}, got ${actualId || "missing"}`);
  }
  if (String(input.actual?.name || "") !== input.expectedFormName) {
    throw new Error("Meta lead-form verification failed: deterministic form name does not match");
  }
  if (String(input.actual?.status || "").toUpperCase() !== "ACTIVE") {
    throw new Error(`Meta lead-form verification failed: expected ACTIVE status, got ${String(input.actual?.status || "missing")}`);
  }
  if (JSON.stringify(normalizedQuestions(input.actual?.questions)) !==
      JSON.stringify(normalizedQuestions(input.expectedSpecification.questions))) {
    throw new Error("Meta lead-form verification failed: question schema does not match the intended Cove form");
  }
  if (String(input.actual?.follow_up_action_url || "") !== input.expectedSpecification.followUpActionUrl) {
    throw new Error("Meta lead-form verification failed: follow-up URL does not match the intended Cove form");
  }
}

export function buildNativeLeadFormFingerprint(specification: NativeLeadFormSpecification): string {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(specification))).digest("hex");
}

export function assertNativeFormComplianceMode(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === "production" && String(env.META_NATIVE_FORM_FLEXIBLE_DELIVERY_LOCKED || "").toLowerCase() !== "true") {
    return [
      "Cove preference warning: flexible form delivery is not confirmed locked off for the configured Graph API version.",
    ];
  }
  return [];
}

export async function verifyNativeLeadFormQualitySettings(input: {
  formId: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  formUrl: (formId: string) => string;
  expectedFormName?: string;
  expectedSpecification?: NativeLeadFormSpecification;
}) {
  const url = new URL(input.formUrl(input.formId));
  url.searchParams.set(
    "fields",
    input.expectedFormName && input.expectedSpecification
      ? "id,name,status,is_optimized_for_quality,questions,follow_up_action_url"
      : "id,status,is_optimized_for_quality"
  );
  url.searchParams.set("access_token", input.accessToken);
  const response = await (input.fetchImpl || fetch)(url.toString());
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Meta lead-form verification failed: ${JSON.stringify(json)}`);
  if (String(json?.id || "") !== input.formId) {
    throw new Error(`Meta lead-form verification failed: expected id=${input.formId}, got ${String(json?.id || "missing")}`);
  }
  if (input.expectedFormName && input.expectedSpecification) {
    assertNativeLeadFormMatchesSpecification({
      actual: json,
      expectedFormId: input.formId,
      expectedFormName: input.expectedFormName,
      expectedSpecification: input.expectedSpecification,
    });
  }
  const policyWarnings: string[] = [];
  if (json?.is_optimized_for_quality !== true) {
    policyWarnings.push("Cove preference warning: Meta did not report higher-intent optimization on the accepted lead form.");
  }

  const optionalUrl = new URL(input.formUrl(input.formId));
  optionalUrl.searchParams.set("fields", "id,is_phone_sms_verify_enabled");
  optionalUrl.searchParams.set("access_token", input.accessToken);
  const optionalResponse = await (input.fetchImpl || fetch)(optionalUrl.toString());
  const optionalJson = await optionalResponse.json().catch(() => ({}));
  if (!optionalResponse.ok && !isUnsupportedSmsVerificationReadback(optionalJson)) {
    throw new Error(`Meta lead-form verification failed: ${JSON.stringify(optionalJson)}`);
  }
  if (!optionalResponse.ok && isUnsupportedSmsVerificationReadback(optionalJson)) {
    policyWarnings.push("Cove preference warning: Meta does not support phone/SMS verification readback for this Graph API path.");
  } else if (optionalJson?.is_phone_sms_verify_enabled !== true) {
    policyWarnings.push("Cove preference warning: Meta did not report phone/SMS verification on the accepted lead form.");
  }
  return { ...json, policyWarnings, optionalQualityReadback: optionalJson };
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
  const existing = await MetaLeadFormTemplate.findOne({ userEmail, pageId, fingerprint }).lean() as any;
  if (existing?.formName && String(existing.formName) !== input.formName) {
    throw new Error("An exact Meta lead-form schema is already recorded under a different deterministic form name");
  }
  if (existing?.status === "ready" && existing?.formId) {
    return { fingerprint, formId: String(existing.formId), reused: true, claimToken: "" };
  }

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
    const formId = String(claimed?.formId || "");
    return { fingerprint, formId, reused: Boolean(formId), claimToken };
  } catch (error: any) {
    if (error?.code === 11000) throw new Error("An identical Meta lead form is already being created");
    throw error;
  }
}

export async function recordCreatedNativeLeadForm(input: {
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
    { $set: { formId: input.formId, status: "creating", lastError: "" } },
    { new: true }
  ).lean();
  if (!updated) throw new Error("Lead-form template claim was lost before recording the created Meta form ID");
}

export async function recoverExactNativeLeadForm(input: {
  pageId: string;
  formName: string;
  expectedFingerprint: string;
  specification: NativeLeadFormSpecification;
  accessToken: string;
  fetchImpl?: typeof fetch;
  pageFormsUrl: (pageId: string) => string;
  formUrl: (formId: string) => string;
}) {
  if (buildNativeLeadFormFingerprint(input.specification) !== input.expectedFingerprint) {
    throw new Error("Meta lead-form duplicate recovery failed: expected Cove schema fingerprint does not match");
  }
  const listUrl = new URL(input.pageFormsUrl(input.pageId));
  listUrl.searchParams.set("fields", "id,name,status");
  listUrl.searchParams.set("limit", "100");
  listUrl.searchParams.set("access_token", input.accessToken);
  const listResponse = await (input.fetchImpl || fetch)(listUrl.toString());
  const listJson = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok) {
    throw new Error(`Meta lead-form duplicate recovery failed: ${JSON.stringify(listJson)}`);
  }
  const candidates = Array.isArray(listJson?.data)
    ? listJson.data.filter((form: any) => String(form?.name || "") === input.formName)
    : [];
  const matches: Array<{ formId: string; review: any }> = [];
  for (const candidate of candidates) {
    const formId = String(candidate?.id || "");
    if (!formId) continue;
    try {
      const review = await verifyNativeLeadFormQualitySettings({
        formId,
        accessToken: input.accessToken,
        fetchImpl: input.fetchImpl,
        formUrl: input.formUrl,
        expectedFormName: input.formName,
        expectedSpecification: input.specification,
      });
      matches.push({ formId, review });
    } catch {
      // A same-name form is not reusable unless every required field matches.
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `Meta lead-form duplicate recovery failed: expected exactly one matching Page/name/schema form, found ${matches.length}`
    );
  }
  return matches[0];
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
