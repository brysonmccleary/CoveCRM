import fs from "fs";
import path from "path";
import { ensureA2PCampaignWithoutDuplicateCreate } from "@/lib/a2p/campaignCreateGuard";

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
});

describe("failed A2P Campaign resubmission", () => {
  function mockClient() {
    const update = jest.fn().mockResolvedValue({ sid: "QEexisting", campaignStatus: "IN_PROGRESS" });
    const fetch = jest.fn().mockResolvedValue({ sid: "QEexisting", campaignStatus: "FAILED" });
    const usAppToPerson = Object.assign(jest.fn(() => ({ fetch, update })), {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    });
    return {
      client: { messaging: { v1: { services: jest.fn(() => ({ usAppToPerson })) } } },
      update,
    };
  }

  const args = {
    messagingServiceSid: "MG123",
    brandSid: "BN123",
    existingCampaignSid: "QEexisting",
    createPayload: {},
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

    expect(twilio.update).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ campaignSid: "QEexisting", didUpdate: true });
  });
});
