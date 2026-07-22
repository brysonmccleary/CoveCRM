describe("Twilio subaccount webhook authentication", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("uses the callback subaccount Auth Token, never the parent token", async () => {
    const fetch = jest.fn().mockResolvedValue({
      authToken: "subaccount-token",
      ownerAccountSid: "AC11111111111111111111111111111111",
    });
    const validateRequest = jest.fn((token: string) => token === "subaccount-token");
    jest.doMock("twilio", () => ({
      __esModule: true,
      default: { validateRequest },
    }));
    jest.doMock("@/lib/twilio/getPlatformClient", () => ({
      getPlatformTwilioAuth: () => ({
        mode: "authToken",
        accountSid: "AC11111111111111111111111111111111",
        authToken: "parent-token",
      }),
      getPlatformTwilioClient: () => ({
        api: { v2010: { accounts: () => ({ fetch }) } },
      }),
    }));

    const { validateSubaccountWebhook } = await import(
      "@/lib/twilio/validateSubaccountWebhook"
    );
    await expect(
      validateSubaccountWebhook({
        accountSid: "AC22222222222222222222222222222222",
        signature: "signature",
        urls: ["https://www.covecrm.com/api/twilio/voice-status"],
        params: { AccountSid: "AC22222222222222222222222222222222" },
      }),
    ).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(validateRequest).toHaveBeenCalledWith(
      "subaccount-token",
      "signature",
      expect.any(String),
      expect.any(Object),
    );
  });

  test("rejects malformed AccountSid before any Twilio API lookup", async () => {
    const getPlatformTwilioClient = jest.fn();
    jest.doMock("twilio", () => ({
      __esModule: true,
      default: { validateRequest: jest.fn() },
    }));
    jest.doMock("@/lib/twilio/getPlatformClient", () => ({
      getPlatformTwilioAuth: jest.fn(),
      getPlatformTwilioClient,
    }));
    const { validateSubaccountWebhook } = await import(
      "@/lib/twilio/validateSubaccountWebhook"
    );
    await expect(
      validateSubaccountWebhook({
        accountSid: "not-an-account",
        signature: "signature",
        urls: ["https://www.covecrm.com/api/twilio/voice-status"],
        params: {},
      }),
    ).rejects.toThrow("valid AccountSid");
    expect(getPlatformTwilioClient).not.toHaveBeenCalled();
  });
});
