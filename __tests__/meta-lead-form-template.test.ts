import fs from "fs";
import path from "path";
import MetaLeadFormTemplate from "@/models/MetaLeadFormTemplate";
import {
  assertNativeLeadFormMatchesSpecification,
  buildNativeLeadFormFingerprint,
  assertNativeFormComplianceMode,
  claimNativeLeadFormTemplate,
  finalizeNativeLeadFormTemplate,
  isMetaDuplicateNativeLeadFormNameError,
  recordCreatedNativeLeadForm,
  recoverExactNativeLeadForm,
  verifyNativeLeadFormQualitySettings,
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
  beforeEach(() => {
    jest.resetAllMocks();
    (MetaLeadFormTemplate.findOne as jest.Mock).mockReturnValue(leanResult(null));
  });

  function formReadback(overrides: Record<string, any> = {}) {
    return {
      id: "form-1",
      name: "Final Expense Insurance Lead Form",
      status: "ACTIVE",
      is_optimized_for_quality: true,
      questions: specification.questions,
      privacy_policy: specification.privacyPolicy,
      custom_disclaimer: specification.customDisclaimer,
      follow_up_action_url: specification.followUpActionUrl,
      ...overrides,
    };
  }

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

  it("reports the production flexible-delivery lock as a Cove warning, not a veto", () => {
    expect(assertNativeFormComplianceMode({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toEqual([
      expect.stringMatching(/flexible form delivery/i),
    ]);
    expect(assertNativeFormComplianceMode({
      NODE_ENV: "production",
      META_NATIVE_FORM_FLEXIBLE_DELIVERY_LOCKED: "true",
    } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("readbacks higher intent and SMS verification before accepting a form", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: "form-1", status: "ACTIVE", is_optimized_for_quality: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: "form-1", is_phone_sms_verify_enabled: true }),
      });
    await expect(verifyNativeLeadFormQualitySettings({
      formId: "form-1",
      accessToken: "token",
      fetchImpl: fetchImpl as any,
      formUrl: (formId) => `https://graph.facebook.com/v24.0/${formId}`,
    })).resolves.toEqual(expect.objectContaining({ id: "form-1" }));
  });

  it("keeps accepted forms launchable when Cove quality preferences are absent", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: "form-1", status: "ACTIVE", is_optimized_for_quality: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ id: "form-1", is_phone_sms_verify_enabled: false }),
      });
    await expect(verifyNativeLeadFormQualitySettings({
      formId: "form-1",
      accessToken: "token",
      fetchImpl: fetchImpl as any,
      formUrl: (formId) => `https://graph.facebook.com/v24.0/${formId}`,
    })).resolves.toEqual(expect.objectContaining({
      id: "form-1",
      policyWarnings: expect.arrayContaining([
        expect.stringMatching(/higher-intent/i),
        expect.stringMatching(/phone\/SMS verification/i),
      ]),
    }));
  });

  it("keeps a created form valid when Meta does not support the optional SMS verification readback field", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(formReadback()),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: jest.fn().mockResolvedValue({
          error: {
            code: 100,
            message: "(#100) Tried accessing nonexisting field (is_phone_sms_verify_enabled)",
          },
        }),
      });

    await expect(verifyNativeLeadFormQualitySettings({
      formId: "form-1",
      accessToken: "token",
      fetchImpl: fetchImpl as any,
      formUrl: (formId) => `https://graph.facebook.com/v24.0/${formId}`,
      expectedFormName: "Final Expense Insurance Lead Form",
      expectedSpecification: specification,
    })).resolves.toEqual(expect.objectContaining({
      id: "form-1",
      policyWarnings: expect.arrayContaining([expect.stringMatching(/does not support phone\/SMS verification readback/i)]),
    }));
  });

  it("still blocks when Meta rejects the form readback request", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: { message: "Invalid access token" } }),
    });
    await expect(verifyNativeLeadFormQualitySettings({
      formId: "form-1",
      accessToken: "bad-token",
      fetchImpl: fetchImpl as any,
      formUrl: (formId) => `https://graph.facebook.com/v24.0/${formId}`,
    })).rejects.toThrow(/Meta lead-form verification failed/i);
  });

  it("reuses a ready matching form instead of creating a duplicate", async () => {
    (MetaLeadFormTemplate.findOne as jest.Mock).mockReturnValue(leanResult({
      formId: "form-1",
      formName: "Final Expense Insurance Lead Form",
      status: "ready",
    }));
    await expect(claimNativeLeadFormTemplate({
      userEmail: "Agent@Example.com",
      pageId: "page-1",
      formName: "Final Expense Insurance Lead Form",
      specification,
    })).resolves.toEqual(expect.objectContaining({ formId: "form-1", reused: true }));
    expect(MetaLeadFormTemplate.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reclaims a preserved failed form ID for verification instead of creating another form", async () => {
    (MetaLeadFormTemplate.findOne as jest.Mock).mockReturnValue(leanResult({
      formId: "form-2",
      formName: "Final Expense Insurance Lead Form",
      status: "failed",
    }));
    (MetaLeadFormTemplate.findOneAndUpdate as jest.Mock).mockImplementation((_filter, update) =>
      leanResult({ formId: "form-2", claimToken: update.$set.claimToken })
    );

    await expect(claimNativeLeadFormTemplate({
      userEmail: "agent@example.com",
      pageId: "page-1",
      formName: "Final Expense Insurance Lead Form",
      specification,
    })).resolves.toEqual(expect.objectContaining({
      formId: "form-2",
      reused: true,
      claimToken: expect.any(String),
    }));
  });

  it("records Meta's returned form ID before the optional verification block", async () => {
    (MetaLeadFormTemplate.findOneAndUpdate as jest.Mock).mockReturnValue(leanResult({ formId: "form-2" }));
    await recordCreatedNativeLeadForm({
      userEmail: "agent@example.com",
      pageId: "page-1",
      fingerprint: "fp-1",
      claimToken: "claim-1",
      formId: "form-2",
    });
    expect(MetaLeadFormTemplate.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ claimToken: "claim-1", fingerprint: "fp-1" }),
      expect.objectContaining({ $set: expect.objectContaining({ formId: "form-2", status: "creating" }) }),
      { new: true }
    );

    const source = fs.readFileSync(path.resolve("pages/api/facebook/publish-ad.ts"), "utf8");
    const creationBranch = source.slice(source.indexOf("metaFormId = String(metaFormJson.id)"));
    expect(creationBranch.indexOf("await recordCreatedNativeLeadForm")).toBeGreaterThanOrEqual(0);
    expect(creationBranch.indexOf("await recordCreatedNativeLeadForm")).toBeLessThan(
      creationBranch.indexOf("await verifyNativeLeadFormQualitySettings")
    );
  });

  it("recognizes only Meta's exact duplicate-form-name error", () => {
    expect(isMetaDuplicateNativeLeadFormNameError({
      error: { code: 100, error_subcode: 1892019 },
    })).toBe(true);
    expect(isMetaDuplicateNativeLeadFormNameError({
      error: { code: 100, error_subcode: 999 },
    })).toBe(false);
  });

  it("recovers the one exact Page/name/schema match after a duplicate-name response", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [{ id: "form-1", name: "Final Expense Insurance Lead Form" }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(formReadback()) })
      .mockResolvedValueOnce({
        ok: false,
        json: jest.fn().mockResolvedValue({
          error: { code: 100, message: "Tried accessing nonexisting field (is_phone_sms_verify_enabled)" },
        }),
      });

    await expect(recoverExactNativeLeadForm({
      pageId: "page-1",
      formName: "Final Expense Insurance Lead Form",
      expectedFingerprint: buildNativeLeadFormFingerprint(specification),
      specification,
      accessToken: "token",
      fetchImpl: fetchImpl as any,
      pageFormsUrl: (pageId) => `https://graph.facebook.com/v24.0/${pageId}/leadgen_forms`,
      formUrl: (formId) => `https://graph.facebook.com/v24.0/${formId}`,
    })).resolves.toEqual(expect.objectContaining({ formId: "form-1" }));
  });

  it("rejects a same-name form whose required schema does not match", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [{ id: "wrong-form", name: "Final Expense Insurance Lead Form" }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(formReadback({
          id: "wrong-form",
          questions: [{ type: "FULL_NAME" }],
        })),
      });

    await expect(recoverExactNativeLeadForm({
      pageId: "page-1",
      formName: "Final Expense Insurance Lead Form",
      expectedFingerprint: buildNativeLeadFormFingerprint(specification),
      specification,
      accessToken: "token",
      fetchImpl: fetchImpl as any,
      pageFormsUrl: (pageId) => `https://graph.facebook.com/v24.0/${pageId}/leadgen_forms`,
      formUrl: (formId) => `https://graph.facebook.com/v24.0/${formId}`,
    })).rejects.toThrow(/found 0/i);
  });

  it("rejects a form with the wrong Page-derived schema instead of weakening required validation", () => {
    expect(() => assertNativeLeadFormMatchesSpecification({
      actual: formReadback({ privacy_policy: { url: "https://unrelated.example/privacy", link_text: "Privacy Policy" } }),
      expectedFormId: "form-1",
      expectedFormName: "Final Expense Insurance Lead Form",
      expectedSpecification: specification,
    })).toThrow(/privacy policy/i);
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
