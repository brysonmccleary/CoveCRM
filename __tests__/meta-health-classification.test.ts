import { classifyMetaHealthError } from "@/lib/meta/metaHealth";

describe("Meta launch blocker classification", () => {
  it("recognizes Meta security authentication error 3858385", () => {
    expect(classifyMetaHealthError({ code: 3858385, message: "Due to recent activity and login location, authenticate your account" }))
      .toEqual(expect.objectContaining({ status: "securityVerificationRequired", cooldown: true }));
  });

  it("recognizes missing legal business information", () => {
    expect(classifyMetaHealthError("Update your legal business name and business address"))
      .toEqual(expect.objectContaining({ status: "missingBusinessInformation", cooldown: true }));
  });
});
