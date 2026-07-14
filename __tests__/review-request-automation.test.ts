import fs from "fs";
import path from "path";
import AISettings from "@/models/AISettings";
import Lead from "@/models/Lead";
import { sendSMS } from "@/lib/twilio/sendSMS";
import { sendReviewRequestOnce } from "@/lib/reviews/sendReviewRequest";

jest.mock("@/models/AISettings", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("@/models/Lead", () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn(), updateOne: jest.fn() },
}));

jest.mock("@/lib/twilio/sendSMS", () => ({
  __esModule: true,
  sendSMS: jest.fn(),
}));

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

const mockedAISettings = AISettings as unknown as { findOne: jest.Mock };
const mockedLead = Lead as unknown as { findOneAndUpdate: jest.Mock; updateOne: jest.Mock };
const mockedSendSMS = sendSMS as jest.Mock;

describe("review-request automation", () => {
  beforeEach(() => jest.clearAllMocks());

  test("does nothing when the tenant hasn't enabled review requests", async () => {
    mockedAISettings.findOne.mockReturnValue(lean({ reviewRequestEnabled: false, reviewRequestUrl: "" }));
    await sendReviewRequestOnce({ leadId: "L1", userEmail: "agent@example.com" });
    expect(mockedLead.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mockedSendSMS).not.toHaveBeenCalled();
  });

  test("does nothing when enabled but no URL is configured", async () => {
    mockedAISettings.findOne.mockReturnValue(lean({ reviewRequestEnabled: true, reviewRequestUrl: "" }));
    await sendReviewRequestOnce({ leadId: "L1", userEmail: "agent@example.com" });
    expect(mockedSendSMS).not.toHaveBeenCalled();
  });

  test("sends a tenant-scoped, one-time review request when enabled with a URL", async () => {
    mockedAISettings.findOne.mockReturnValue(
      lean({ reviewRequestEnabled: true, reviewRequestUrl: "https://g.page/r/example/review" }),
    );
    mockedLead.findOneAndUpdate.mockReturnValue(lean({ Phone: "+18085551212" }));

    await sendReviewRequestOnce({ leadId: "L1", userEmail: "Agent@Example.com" });

    expect(mockedAISettings.findOne).toHaveBeenCalledWith({ userEmail: "agent@example.com" });
    expect(mockedLead.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "L1", userEmail: "agent@example.com", $and: expect.any(Array) }),
      { $set: { reviewRequestSendingAt: expect.any(Date) } },
      { new: false },
    );
    expect(mockedSendSMS).toHaveBeenCalledWith(
      "+18085551212",
      expect.stringContaining("https://g.page/r/example/review"),
      "agent@example.com",
      expect.objectContaining({ source: "review_request", leadId: "L1" }),
    );
    expect(mockedSendSMS.mock.calls[0][1]).toContain("Reply STOP to opt out.");
    expect(mockedLead.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "L1", userEmail: "agent@example.com" }),
      expect.objectContaining({ $set: { reviewRequestSentAt: expect.any(Date) } }),
    );
  });

  test("already-sent (atomic claim already taken) sends nothing — one review request per lead, ever", async () => {
    mockedAISettings.findOne.mockReturnValue(
      lean({ reviewRequestEnabled: true, reviewRequestUrl: "https://g.page/r/example/review" }),
    );
    mockedLead.findOneAndUpdate.mockReturnValue(lean(null));

    await sendReviewRequestOnce({ leadId: "L1", userEmail: "agent@example.com" });

    expect(mockedSendSMS).not.toHaveBeenCalled();
  });

  test("lead with no phone number sends nothing", async () => {
    mockedAISettings.findOne.mockReturnValue(
      lean({ reviewRequestEnabled: true, reviewRequestUrl: "https://g.page/r/example/review" }),
    );
    mockedLead.findOneAndUpdate.mockReturnValue(lean({ Phone: "" }));

    await sendReviewRequestOnce({ leadId: "L1", userEmail: "agent@example.com" });

    expect(mockedSendSMS).not.toHaveBeenCalled();
    expect(mockedLead.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      { $unset: { reviewRequestSendingAt: "" } },
    );
  });

  test("a failed SMS releases the claim so a later attempt can retry", async () => {
    mockedAISettings.findOne.mockReturnValue(
      lean({ reviewRequestEnabled: true, reviewRequestUrl: "https://example.com/review" }),
    );
    mockedLead.findOneAndUpdate.mockReturnValue(lean({ Phone: "+18085551212" }));
    mockedLead.updateOne.mockResolvedValue({});
    mockedSendSMS.mockRejectedValue(new Error("Twilio unavailable"));

    await expect(sendReviewRequestOnce({ leadId: "L1", userEmail: "agent@example.com" })).rejects.toThrow("Twilio unavailable");
    expect(mockedLead.updateOne).toHaveBeenLastCalledWith(
      expect.anything(),
      { $unset: { reviewRequestSendingAt: "" } },
    );
  });
});

describe("disposition-lead.ts wiring", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "pages/api/disposition-lead.ts"), "utf8");

  test("triggers the review request only on a Sold transition, as a non-blocking best-effort call", () => {
    expect(source).toContain('import { sendReviewRequestOnce } from "@/lib/reviews/sendReviewRequest";');

    const triggerIndex = source.indexOf("sendReviewRequestOnce({");
    expect(triggerIndex).toBeGreaterThan(-1);

    const guardStart = source.lastIndexOf('if (desiredLower === "sold")', triggerIndex);
    expect(guardStart).toBeGreaterThan(-1);
    expect(guardStart).toBeLessThan(triggerIndex);

    const block = source.slice(triggerIndex, triggerIndex + 200);
    expect(block).toContain(".catch(");
  });
});

describe("automation settings wiring", () => {
  const apiSource = fs.readFileSync(path.join(process.cwd(), "pages/api/settings/ai-settings.ts"), "utf8");
  const panelSource = fs.readFileSync(path.join(process.cwd(), "components/settings/AISettingsPanel.tsx"), "utf8");

  test("review and missed-call settings can be saved and are visible in Settings", () => {
    for (const field of ["reviewRequestEnabled", "reviewRequestUrl", "missedCallTextBackEnabled"]) {
      expect(apiSource).toContain(`\"${field}\"`);
      expect(panelSource).toContain(field);
    }
  });
});
