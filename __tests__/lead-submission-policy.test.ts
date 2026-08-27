import { renderRepeatOptInNotificationEmail } from "@/lib/email";
import { classifySubmissionState } from "@/lib/leads/submissionStatePolicy";
import { buildAccountWideContactFilter, contactMatches } from "@/lib/leads/accountWideContactMatch";
import FunnelSubmission from "@/models/FunnelSubmission";
import Lead from "@/models/Lead";
import { resolveCampaignAiScriptKey } from "@/lib/ai/campaignScriptKey";

describe("completed lead submission policy", () => {
  test("accepts an out-of-area state and flags it for the agent", () => {
    expect(classifySubmissionState({ state: "NY", licensedStates: ["AZ", "TX"] })).toEqual({
      normalizedState: "NY",
      outsideLicensedArea: true,
      acceptSubmission: true,
    });
  });

  test("accepts an in-area state without a warning", () => {
    expect(classifySubmissionState({ state: "Arizona", licensedStates: ["AZ", "TX"] })).toEqual({
      normalizedState: "AZ",
      outsideLicensedArea: false,
      acceptSubmission: true,
    });
  });

  test("repeat opt-in email tells the agent to call the existing lead", () => {
    const html = renderRepeatOptInNotificationEmail({
      leadName: "Jane Doe",
      leadPhone: "(808) 555-1212",
      campaignName: "Veteran Coverage",
      leadUrl: "https://www.covecrm.com/lead/existing-lead-1",
    });

    expect(html).toContain("Jane Doe opted in again");
    expect(html).toContain("Call them");
    expect(html).toContain("Open Existing Lead and Call");
    expect(html).toContain("/lead/existing-lead-1");
  });

  test("hosted repeat opt-in matching is account-wide and not folder-scoped", () => {
    const filter = buildAccountWideContactFilter("Agent@Example.com", "(602) 555-0199", "Lead@Example.com");
    expect(filter).toEqual(expect.objectContaining({ userEmail: "agent@example.com", $or: expect.any(Array) }));
    expect(filter).not.toHaveProperty("folderId");
    expect(contactMatches({ Phone: "+1 602-555-0199", folderId: "another-folder" }, "6025550199", "")).toBe(true);
  });

  test("exact hosted API retries are deduplicated by tenant and submission event ID", () => {
    const index = FunnelSubmission.schema.indexes().find(([fields]) =>
      fields.userEmail === 1 && fields.submissionEventId === 1
    );
    expect(index?.[1]?.unique).toBe(true);
  });

  test("Spanish product campaigns persist language and route to Spanish-specific scripts", () => {
    expect(Lead.schema.path("preferredLanguage")).toBeDefined();
    expect(resolveCampaignAiScriptKey("final_expense", "spanish")).toBe("spanish_final_expense");
    expect(resolveCampaignAiScriptKey("mortgage_protection", "spanish")).toBe("spanish_mortgage");
    expect(resolveCampaignAiScriptKey("iul", "spanish")).toBe("spanish_iul");
  });
});
