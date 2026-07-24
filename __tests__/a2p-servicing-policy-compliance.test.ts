import fs from "fs";
import path from "path";
import { ensureA2PCampaignWithoutDuplicateCreate } from "@/lib/a2p/campaignCreateGuard";
import { buildA2PCampaignPayload } from "@/lib/a2p/campaignPayload";

const privacy = fs.readFileSync(
  path.join(process.cwd(), "pages/sms/optin-privacy/[userId].tsx"),
  "utf8",
);
const terms = fs.readFileSync(
  path.join(process.cwd(), "pages/sms/optin-terms/[userId].tsx"),
  "utf8",
);

describe("hosted servicing A2P policies", () => {
  it("states the required mobile-data restriction and SMS disclosures", () => {
    for (const source of [privacy, terms]) {
      const renderedText = source.replace(/\s+/g, " ");
      expect(renderedText).toContain("mobile phone number");
      expect(renderedText).toContain("messaging consent data");
      expect(renderedText).toContain("third parties or affiliates for marketing or promotional purposes");
    }
    expect(privacy).toContain("Message frequency varies.");
    expect(privacy).toContain("Message and data rates may apply.");
  });

  it("does not link the campaign policies to separate platform policies", () => {
    expect(privacy).not.toContain('href="/legal/privacy"');
    expect(terms).not.toContain('href="/legal/privacy"');
    expect(terms).not.toContain('href="/legal/terms"');
  });

  it("keeps the opt-in URL in message flow and puts policy URLs in dedicated payload fields", () => {
    const payload = buildA2PCampaignPayload({
      profile: {
        a2pFlow: "servicing",
        businessName: "Motion Financial Group LLC",
        optInDetails: "Customers consent using a separate unchecked SMS consent checkbox. Message frequency varies. Message and data rates may apply. Reply STOP to opt out. Reply HELP for help. Consent is not a condition of purchase.",
        sampleMessagesArr: ["Your requested policy update is ready for review.", "Reply with a convenient time to discuss your policy."],
      },
      brandRegistrationSid: "BN123",
      baseUrl: "https://www.covecrm.com",
      userId: "user-1",
    });

    expect(payload.messageFlow).toContain("Opt-in: https://www.covecrm.com/sms/optin/user-1");
    expect(payload.messageFlow).not.toContain("Terms:");
    expect(payload.messageFlow).not.toContain("Privacy:");
    expect(payload.privacyPolicyUrl).toBe("https://www.covecrm.com/sms/optin-privacy/user-1");
    expect(payload.termsAndConditionsUrl).toBe("https://www.covecrm.com/sms/optin-terms/user-1");
  });
});

describe("failed A2P Campaign resubmission", () => {
  function mockClient() {
    const update = jest.fn().mockResolvedValue({ sid: "QEexisting", campaignStatus: "IN_PROGRESS" });
    const create = jest.fn().mockResolvedValue({ sid: "QEnew", campaignStatus: "IN_PROGRESS" });
    const fetch = jest.fn().mockResolvedValue({ sid: "QEexisting", campaignStatus: "FAILED" });
    const usAppToPerson = Object.assign(jest.fn(() => ({ fetch })), {
      list: jest.fn().mockResolvedValue([]),
    });
    return {
      client: { messaging: { v1: { services: jest.fn(() => ({ usAppToPerson })), create, update } } },
      create,
      update,
    };
  }

  const privacyPolicyUrl = "https://www.covecrm.com/sms/optin-privacy/user-1";
  const termsAndConditionsUrl = "https://www.covecrm.com/sms/optin-terms/user-1";
  const args = {
    messagingServiceSid: "MG123",
    brandSid: "BN123",
    existingCampaignSid: "QEexisting",
    createPayload: {
      brandRegistrationSid: "BN123",
      description: "Campaign description",
      messageFlow: "Opt-in: https://www.covecrm.com/sms/optin/user-1",
      messageSamples: ["Sample one", "Sample two"],
      usAppToPersonUsecase: "LOW_VOLUME",
      hasEmbeddedLinks: true,
      hasEmbeddedPhone: false,
      subscriberOptIn: true,
      ageGated: false,
      directLending: false,
      privacyPolicyUrl,
      termsAndConditionsUrl,
    },
  };

  it("preserves a failed Campaign without updating it during automatic continuation", async () => {
    const twilio = mockClient();
    const result = await ensureA2PCampaignWithoutDuplicateCreate({ client: twilio.client, ...args });

    expect(twilio.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      campaignSid: "QEexisting",
      didUpdate: false,
      reason: "existing_failed_campaign_requires_explicit_resubmission",
    });
  });

  it("updates the existing Campaign only when explicit resubmission is allowed", async () => {
    const twilio = mockClient();
    const result = await ensureA2PCampaignWithoutDuplicateCreate({
      client: twilio.client,
      ...args,
      allowFailedUpdate: true,
    });

    expect(twilio.update).toHaveBeenCalledWith(expect.objectContaining({
      uri: "/Services/MG123/Compliance/Usa2p/QEexisting",
      data: expect.objectContaining({
        PrivacyPolicyUrl: privacyPolicyUrl,
        TermsAndConditionsUrl: termsAndConditionsUrl,
      }),
    }));
    expect(result).toMatchObject({ campaignSid: "QEexisting", didUpdate: true });
  });

  it("puts privacy and terms URLs in their dedicated fields when creating a Campaign", async () => {
    const twilio = mockClient();

    await ensureA2PCampaignWithoutDuplicateCreate({
      client: twilio.client,
      messagingServiceSid: args.messagingServiceSid,
      brandSid: args.brandSid,
      createPayload: args.createPayload,
    });

    expect(twilio.create).toHaveBeenCalledWith(expect.objectContaining({
      uri: "/Services/MG123/Compliance/Usa2p",
      data: expect.objectContaining({
        PrivacyPolicyUrl: privacyPolicyUrl,
        TermsAndConditionsUrl: termsAndConditionsUrl,
      }),
    }));
  });
});
