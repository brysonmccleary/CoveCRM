import MetaLeadFormTemplate from "@/models/MetaLeadFormTemplate";
import {
  buildNativeLeadFormFingerprint,
  assertNativeFormComplianceMode,
  verifyNativeLeadFormQualitySettings,
  claimNativeLeadFormTemplate,
  finalizeNativeLeadFormTemplate,
  type NativeLeadFormSpecification,
} from "@/lib/facebook/metaLeadFormTemplate";

jest.mock("@/models/MetaLeadFormTemplate", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  },
}));

const specification: NativeLeadFormSpecification = {
  schemaVersion: "insurance-native-v1",
  leadType: "final_expense",
  audienceSegment: "standard",
  questions: [{ type: "FULL_NAME" }, { type: "PHONE" }],
  privacyPolicy: { url: "https://covecrm.com/privacy", link_text: "Privacy Policy" },
  customDisclaimer: { title: "Consent", checkboxes: [{ is_required: true }] },
  followUpActionUrl: "https://covecrm.com/thank-you",
  formMode: "HIGHER_INTENT",
  flexibleDelivery: false,
  smsVerification: true,
};

function leanResult(value: any) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe("Meta native insurance form templates", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fingerprints the complete deterministic form schema independent of object key order", () => {
    const reordered = {
      ...specification,
      privacyPolicy: { link_text: "Privacy Policy", url: "https://covecrm.com/privacy" },
    };
    expect(buildNativeLeadFormFingerprint(reordered)).toBe(buildNativeLeadFormFingerprint(specification));
    expect(buildNativeLeadFormFingerprint({ ...specification, smsVerification: false })).not.toBe(
      buildNativeLeadFormFingerprint(specification)
    );
  });

  it("fails closed in production until flexible delivery is explicitly confirmed locked", () => {
    expect(() => assertNativeFormComplianceMode({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/flexible form delivery/i);
    expect(() => assertNativeFormComplianceMode({
      NODE_ENV: "production",
      META_NATIVE_FORM_FLEXIBLE_DELIVERY_LOCKED: "true",
    } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("readbacks higher intent and SMS verification before accepting a form", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        id: "form-1",
        is_optimized_for_quality: true,
        is_phone_sms_verify_enabled: true,
      }),
    });
    await expect(verifyNativeLeadFormQualitySettings({
      formId: "form-1",
      accessToken: "token",
      fetchImpl: fetchImpl as any,
      formUrl: (formId) => `https://graph.facebook.com/v24.0/${formId}`,
    })).resolves.toEqual(expect.objectContaining({ id: "form-1" }));
  });

  it("reuses a ready matching form instead of creating a duplicate", async () => {
    (MetaLeadFormTemplate.findOne as jest.Mock).mockReturnValue(leanResult({ formId: "form-1" }));
    await expect(claimNativeLeadFormTemplate({
      userEmail: "Agent@Example.com",
      pageId: "page-1",
      formName: "Final Expense Insurance Lead Form",
      specification,
    })).resolves.toEqual(expect.objectContaining({ formId: "form-1", reused: true }));
    expect(MetaLeadFormTemplate.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("finalizes a newly claimed form only with the matching claim token", async () => {
    (MetaLeadFormTemplate.findOneAndUpdate as jest.Mock).mockReturnValue(leanResult({ formId: "form-2" }));
    await finalizeNativeLeadFormTemplate({
      userEmail: "agent@example.com",
      pageId: "page-1",
      fingerprint: "fp-1",
      claimToken: "claim-1",
      formId: "form-2",
    });
    expect(MetaLeadFormTemplate.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ claimToken: "claim-1", fingerprint: "fp-1" }),
      expect.objectContaining({ $set: expect.objectContaining({ formId: "form-2", status: "ready", claimToken: "" }) }),
      { new: true }
    );
  });
});
