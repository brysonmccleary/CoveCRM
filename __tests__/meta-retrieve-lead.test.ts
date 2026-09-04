import { retrieveMetaLead } from "@/lib/meta/retrieveLead";

describe("retrieveMetaLead", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("normalizes Instant Form contact fields and retains consent evidence", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        id: "leadgen-1",
        form_id: "form-1",
        ad_id: "ad-1",
        adset_id: "adset-1",
        campaign_id: "campaign-1",
        page_id: "page-1",
        created_time: "2026-08-30T12:00:00Z",
        field_data: [
          { name: "full_name", values: ["Jane Q Doe"] },
          { name: "phone_number", values: ["+16025550123"] },
          { name: "email", values: ["JANE@EXAMPLE.COM"] },
          { name: "state", values: ["Arizona"] },
          { name: "age", values: ["60-69"] },
          { name: "who_needs_coverage", values: ["Veteran"] },
          { name: "coverage_amount", values: ["$25,000-$49,999"] },
        ],
        custom_disclaimer_responses: [
          { checkbox_key: "covecrm_contact_consent", is_checked: true },
        ],
      }),
    }) as any;

    const lead = await retrieveMetaLead("leadgen-1", "server-token");

    expect(lead).toEqual(expect.objectContaining({
      firstName: "Jane",
      lastName: "Q Doe",
      phone: "+16025550123",
      email: "jane@example.com",
      state: "Arizona",
      customDisclaimerResponses: [
        { checkbox_key: "covecrm_contact_consent", is_checked: true },
      ],
    }));
    const requestedUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(requestedUrl.searchParams.get("fields")).toContain("custom_disclaimer_responses");
    expect(requestedUrl.searchParams.get("fields")).not.toContain("page_id");
    expect(lead.pageId).toBe("");
  });
});
