jest.mock("@/models/BillingMeterHealth", () => ({ __esModule: true, default: {} }));
jest.mock("@/models/Call", () => ({ __esModule: true, default: {} }));
jest.mock("@/models/TwilioVoiceUsageCandidate", () => ({ __esModule: true, default: {} }));
jest.mock("@/models/User", () => ({ __esModule: true, default: {} }));
jest.mock("@/lib/billing/billingMeterHealth", () => ({ initializeBillingMeter: jest.fn() }));
jest.mock("@/lib/billing/trackUsage", () => ({ trackUsage: jest.fn() }));
jest.mock("@/lib/twilio/getPlatformClient", () => ({ getPlatformTwilioClientScoped: jest.fn() }));

import { isBillableTwilioVoiceChild } from "@/lib/billing/reconcileTwilioVoiceUsage";

describe("Twilio-first manual voice discovery", () => {
  test("accepts only phone-to-phone outbound-dial child legs", () => {
    expect(
      isBillableTwilioVoiceChild({
        direction: "outbound-dial",
        parentCallSid: "CAparent",
        from: "+14805550100",
        to: "+16025550100",
      }),
    ).toBe(true);
    expect(
      isBillableTwilioVoiceChild({
        direction: "inbound",
        parentCallSid: "CAparent",
        from: "client:user@example.com",
        to: "+16025550100",
      }),
    ).toBe(false);
    expect(
      isBillableTwilioVoiceChild({
        direction: "outbound-dial",
        parentCallSid: "CAparent",
        from: "+14805550100",
        to: "client:user@example.com",
      }),
    ).toBe(false);
    expect(
      isBillableTwilioVoiceChild({
        direction: "outbound-api",
        parentCallSid: "",
        from: "+14805550100",
        to: "+16025550100",
      }),
    ).toBe(false);
  });
});
