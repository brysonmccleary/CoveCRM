import { getMetaInsightEligibleEmails } from "@/pages/api/cron/sync-meta-insights";

describe("Meta insights cron eligibility", () => {
  it("includes campaign owners even when no billing subscription record exists", () => {
    const eligible = getMetaInsightEligibleEmails([], ["Campaign.Owner@Example.com"]);

    expect(eligible.has("campaign.owner@example.com")).toBe(true);
  });

  it("retains active subscription owners and ignores blank identities", () => {
    const eligible = getMetaInsightEligibleEmails(
      [{ userEmail: "Subscriber@Example.com" }, { userEmail: "" }],
      [""]
    );

    expect([...eligible]).toEqual(["subscriber@example.com"]);
  });
});
