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
  schemaVersion: "insurance-native-v2-dob",
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

const veteranSpecification: NativeLeadFormSpecification = {
  ...specification,
  leadType: "veteran",
  audienceSegment: "veteran",
  questions: [
    { type: "FULL_NAME" },
    { type: "PHONE" },
    { type: "EMAIL" },
    { type: "STATE" },
    {
      type: "CUSTOM",
      key: "age",
      label: "What is your age range?",
      options: [
        { key: "18_39", value: "18-39" },
        { key: "40_49", value: "40-49" },
        { key: "50_59", value: "50-59" },
        { key: "60_69", value: "60-69" },
        { key: "70_79", value: "70-79" },
        { key: "80_plus", value: "80+" },
      ],
    },
    {
      type: "CUSTOM",
      key: "who_needs_coverage",
      label: "Who needs coverage?",
      options: [
        { key: "veteran", value: "Veteran" },
        { key: "spouse", value: "Spouse" },
        { key: "military_family_dependent", value: "Military family / dependent" },
      ],
    },
    {
      type: "CUSTOM",
      key: "coverage_amount",
      label: "How much coverage would you like to review?",
      options: [
        { key: "10000_24999", value: "$10,000-$24,999" },
        { key: "25000_49999", value: "$25,000-$49,999" },
        { key: "50000_99999", value: "$50,000-$99,999" },
        { key: "100000_plus", value: "$100,000+" },
      ],
    },
  ],
  followUpActionUrl: "https://www.covecrm.com/insurance-request-received",
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
      questions: [
        { type: "FULL_NAME", key: "full_name", label: "Full name", id: "generated-full-name-id" },
        { type: "PHONE", key: "phone_number", label: "Phone number", id: "generated-phone-id" },
      ],
      follow_up_action_url: specification.followUpActionUrl,
      ...overrides,
    };
  }

  function veteranFormReadback(overrides: Record<string, any> = {}) {
    return formReadback({
      id: "1674879020241223",
      name: "General Veteran Leads - 49 states Campaign Insurance Lead Form",
      questions: veteranSpecification.questions.map((question, index) =>
        question.type === "CUSTOM"
          ? { ...question, id: `generated-custom-${index}` }
          : {
              ...question,
              key: ["full_name", "phone_number", "email", "state"][index],
              label: ["Full name", "Phone number", "Email", "State"][index],
              id: `generated-standard-${index}`,
            }
      ),
      follow_up_action_url: veteranSpecification.followUpActionUrl,
      ...overrides,
    });
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
    const requiredReadbackUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(requiredReadbackUrl.searchParams.get("fields")).toBe(
      "id,name,status,is_optimized_for_quality,questions,follow_up_action_url"
    );
    expect(requiredReadbackUrl.searchParams.get("fields")).not.toMatch(/privacy_policy|custom_disclaimer/);
  });

  it("ignores generated key, label, and ID metadata for standard Meta questions", () => {
    expect(() => assertNativeLeadFormMatchesSpecification({
      actual: formReadback(),
      expectedFormId: "form-1",
      expectedFormName: "Final Expense Insurance Lead Form",
      expectedSpecification: specification,
    })).not.toThrow();
  });

  it("ignores Meta-generated key, label, and ID metadata for native DOB questions", () => {
    const expectedSpecification: NativeLeadFormSpecification = {
      ...specification,
      questions: [{ type: "DOB" }],
    };

    expect(() => assertNativeLeadFormMatchesSpecification({
      actual: formReadback({
        questions: [
          {
            type: "DOB",
            key: "date_of_birth",
            label: "Date of birth",
            id: "generated-dob-id",
          },
        ],
      }),
      expectedFormId: "form-1",
      expectedFormName: "Final Expense Insurance Lead Form",
      expectedSpecification,
    })).not.toThrow();
  });

  it("still rejects a real standard Meta question type mismatch", () => {
    expect(() => assertNativeLeadFormMatchesSpecification({
      actual: formReadback({
        questions: [
          { type: "FULL_NAME", key: "full_name", label: "Full name" },
          { type: "EMAIL", key: "phone_number", label: "Phone number" },
        ],
      }),
      expectedFormId: "form-1",
      expectedFormName: "Final Expense Insurance Lead Form",
      expectedSpecification: specification,
    })).toThrow(/question schema/i);
  });

  it("keeps matching custom question schema strict while ignoring Meta-generated IDs", () => {
    expect(() => assertNativeLeadFormMatchesSpecification({
      actual: veteranFormReadback(),
      expectedFormId: "1674879020241223",
      expectedFormName: "General Veteran Leads - 49 states Campaign Insurance Lead Form",
      expectedSpecification: veteranSpecification,
    })).not.toThrow();
  });

  it.each([
    ["key", { key: "different_age" }],
    ["label", { label: "Different age question" }],
    ["options", { options: [{ key: "different", value: "Different" }] }],
  ])("rejects a custom question %s mismatch", (_field, mismatch) => {
    const questions = veteranFormReadback().questions.map((question: any) =>
      question.key === "age" ? { ...question, ...mismatch } : question
    );
    expect(() => assertNativeLeadFormMatchesSpecification({
      actual: veteranFormReadback({ questions }),
      expectedFormId: "1674879020241223",
      expectedFormName: "General Veteran Leads - 49 states Campaign Insurance Lead Form",
      expectedSpecification: veteranSpecification,
    })).toThrow(/question schema/i);
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

  it("recovers the current live Veteran form from its captured readable Meta response", async () => {
    const formName = "General Veteran Leads - 49 states Campaign Insurance Lead Form";
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ data: [{ id: "1674879020241223", name: formName, status: "ACTIVE" }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(veteranFormReadback()) })
      .mockResolvedValueOnce({
        ok: false,
        json: jest.fn().mockResolvedValue({
          error: { code: 100, message: "(#100) Tried accessing nonexisting field (is_phone_sms_verify_enabled)" },
        }),
      });

    await expect(recoverExactNativeLeadForm({
      pageId: "1230981476765824",
      formName,
      expectedFingerprint: buildNativeLeadFormFingerprint(veteranSpecification),
      specification: veteranSpecification,
      accessToken: "token",
      fetchImpl: fetchImpl as any,
      pageFormsUrl: (pageId) => `https://graph.facebook.com/v21.0/${pageId}/leadgen_forms`,
      formUrl: (formId) => `https://graph.facebook.com/v21.0/${formId}`,
    })).resolves.toEqual(expect.objectContaining({ formId: "1674879020241223" }));
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/1230981476765824/leadgen_forms");
  });

  it("rejects two genuinely matching duplicate candidates as ambiguous", async () => {
    const formName = "General Veteran Leads - 49 states Campaign Insurance Lead Form";
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [
            { id: "1674879020241223", name: formName },
            { id: "second-form", name: formName },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(veteranFormReadback()) })
      .mockResolvedValueOnce({ ok: false, json: jest.fn().mockResolvedValue({ error: { code: 100, message: "nonexisting field (is_phone_sms_verify_enabled)" } }) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(veteranFormReadback({ id: "second-form" })) })
      .mockResolvedValueOnce({ ok: false, json: jest.fn().mockResolvedValue({ error: { code: 100, message: "nonexisting field (is_phone_sms_verify_enabled)" } }) });

    await expect(recoverExactNativeLeadForm({
      pageId: "1230981476765824",
      formName,
      expectedFingerprint: buildNativeLeadFormFingerprint(veteranSpecification),
      specification: veteranSpecification,
      accessToken: "token",
      fetchImpl: fetchImpl as any,
      pageFormsUrl: (pageId) => `https://graph.facebook.com/v21.0/${pageId}/leadgen_forms`,
      formUrl: (formId) => `https://graph.facebook.com/v21.0/${formId}`,
    })).rejects.toThrow(/found 2/i);
  });

  it("does not recover a same-name form returned outside the selected Page lookup", async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValue({ data: [] }),
    });

    await expect(recoverExactNativeLeadForm({
      pageId: "selected-page",
      formName: "Final Expense Insurance Lead Form",
      expectedFingerprint: buildNativeLeadFormFingerprint(specification),
      specification,
      accessToken: "token",
      fetchImpl: fetchImpl as any,
      pageFormsUrl: (pageId) => `https://graph.facebook.com/v21.0/${pageId}/leadgen_forms`,
      formUrl: (formId) => `https://graph.facebook.com/v21.0/${formId}`,
    })).rejects.toThrow(/found 0/i);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/selected-page/leadgen_forms");
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

  it("rejects a form with a wrong follow-up URL instead of weakening required validation", () => {
    expect(() => assertNativeLeadFormMatchesSpecification({
      actual: formReadback({ follow_up_action_url: "https://unrelated.example/thank-you" }),
      expectedFormId: "form-1",
      expectedFormName: "Final Expense Insurance Lead Form",
      expectedSpecification: specification,
    })).toThrow(/follow-up URL/i);
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
