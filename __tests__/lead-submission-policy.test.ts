import { renderRepeatOptInNotificationEmail } from "@/lib/email";
import { classifySubmissionState } from "@/lib/leads/submissionStatePolicy";

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
});
