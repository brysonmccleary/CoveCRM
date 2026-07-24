import fs from "fs";
import path from "path";
import { buildA2PCampaignPayload } from "@/lib/a2p/campaignPayload";

describe("A2P Low Volume lock", () => {
  it("keeps the form control disabled with Low Volume as its only option", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/A2PVerificationForm.tsx"),
      "utf8",
    );

    expect(source).toContain('const LOCKED_USE_CASE = "LOW_VOLUME" as const');
    expect(source).toContain('value={LOCKED_USE_CASE}');
    expect(source).toContain('<option value={LOCKED_USE_CASE}>Low Volume (mixed)</option>');
    expect(source).toMatch(/value=\{LOCKED_USE_CASE\}\s+disabled/);
    expect(source).not.toContain('value: "MARKETING"');
    expect(source).not.toContain('value: "MIXED"');
  });

  it("ignores a caller-provided use case override in the final Twilio payload", () => {
    const payload = buildA2PCampaignPayload({
      profile: {
        businessName: "Example Agency",
        optInDetails:
          "Consumers request insurance information and consent to SMS follow-up. Reply STOP to opt out and HELP for help.",
        sampleMessagesArr: [
          "Thanks for requesting information. Reply STOP to opt out.",
          "What time works for your requested follow-up? Reply STOP to opt out.",
        ],
      },
      brandRegistrationSid: "BN123",
      userId: "user-1",
      usecase: "MARKETING",
    });

    expect(payload.usAppToPersonUsecase).toBe("LOW_VOLUME");
  });
});
