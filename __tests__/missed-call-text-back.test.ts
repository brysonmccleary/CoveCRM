import fs from "fs";
import path from "path";
import InboundCall from "@/models/InboundCall";
import AISettings from "@/models/AISettings";
import { sendSMS } from "@/lib/twilio/sendSMS";
import { sendMissedCallTextOnce } from "@/lib/sms/sendMissedCallText";

jest.mock("@/models/InboundCall", () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn(), updateOne: jest.fn() },
}));

jest.mock("@/models/AISettings", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("@/lib/twilio/sendSMS", () => ({
  __esModule: true,
  sendSMS: jest.fn(),
}));

function leanUpdate(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function leanSettings(value: unknown) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) };
}

const mockedInboundCall = InboundCall as unknown as { findOneAndUpdate: jest.Mock; updateOne: jest.Mock };
const mockedAISettings = AISettings as unknown as { findOne: jest.Mock };
const mockedSendSMS = sendSMS as jest.Mock;

describe("missed-call text-back", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: feature enabled for the owner, so existing behavior tests
    // exercise the rest of the logic unaffected by the new toggle.
    mockedAISettings.findOne.mockReturnValue(leanSettings({ missedCallTextBackEnabled: true }));
  });

  test.each(["completed", "in-progress", "ringing"])(
    "does nothing for a non-missed status (%s)",
    async (status) => {
      await sendMissedCallTextOnce({ callSid: "CA1", status });
      expect(mockedInboundCall.findOneAndUpdate).not.toHaveBeenCalled();
      expect(mockedSendSMS).not.toHaveBeenCalled();
    },
  );

  test.each(["busy", "failed", "no-answer", "canceled"])(
    "claims and texts back on a missed status (%s)",
    async (status) => {
      mockedInboundCall.findOneAndUpdate.mockReturnValue(
        leanUpdate({ ownerEmail: "agent@example.com", from: "+18085551212", leadId: "L1" }),
      );

      await sendMissedCallTextOnce({ callSid: "CA1", status });

      expect(mockedInboundCall.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ callSid: "CA1", $and: expect.any(Array) }),
        { $set: { missedTextSendingAt: expect.any(Date) } },
        { new: false },
      );
      expect(mockedSendSMS).toHaveBeenCalledWith(
        "+18085551212",
        expect.stringContaining("Reply STOP to opt out."),
        "agent@example.com",
        expect.objectContaining({ source: "missed_call_text_back", leadId: "L1" }),
      );
      expect(mockedInboundCall.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ callSid: "CA1" }),
        expect.objectContaining({ $set: { missedTextSentAt: expect.any(Date) } }),
      );
    },
  );

  test("already-sent (atomic claim already taken) sends nothing — no double text on a webhook retry", async () => {
    mockedInboundCall.findOneAndUpdate.mockReturnValue(leanUpdate(null));
    await sendMissedCallTextOnce({ callSid: "CA1", status: "no-answer" });
    expect(mockedSendSMS).not.toHaveBeenCalled();
  });

  test("no phone number on the inbound record sends nothing", async () => {
    mockedInboundCall.findOneAndUpdate.mockReturnValue(leanUpdate({ ownerEmail: "agent@example.com", from: "" }));
    await sendMissedCallTextOnce({ callSid: "CA1", status: "no-answer" });
    expect(mockedSendSMS).not.toHaveBeenCalled();
  });

  test("off by default: an owner who hasn't enabled the toggle gets no text, and the dedup slot is never claimed", async () => {
    mockedAISettings.findOne.mockReturnValue(leanSettings({ missedCallTextBackEnabled: false }));

    await sendMissedCallTextOnce({ callSid: "CA1", status: "no-answer", ownerEmail: "agent@example.com" });

    expect(mockedSendSMS).not.toHaveBeenCalled();
    // Checked via the ownerEmail hint, so the claim (which would have
    // permanently consumed the one-time slot) never even runs.
    expect(mockedInboundCall.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("toggle enabled via the ownerEmail hint sends normally", async () => {
    mockedAISettings.findOne.mockReturnValue(leanSettings({ missedCallTextBackEnabled: true }));
    mockedInboundCall.findOneAndUpdate.mockReturnValue(
      leanUpdate({ ownerEmail: "agent@example.com", from: "+18085551212" }),
    );

    await sendMissedCallTextOnce({ callSid: "CA1", status: "no-answer", ownerEmail: "agent@example.com" });

    expect(mockedAISettings.findOne).toHaveBeenCalledWith({ userEmail: "agent@example.com" });
    expect(mockedSendSMS).toHaveBeenCalled();
  });

  test("no AISettings row for the owner (never configured) defaults to off", async () => {
    mockedAISettings.findOne.mockReturnValue(leanSettings(null));
    await sendMissedCallTextOnce({ callSid: "CA1", status: "no-answer", ownerEmail: "agent@example.com" });
    expect(mockedSendSMS).not.toHaveBeenCalled();
  });

  test("a failed SMS releases the claim so a later webhook can retry", async () => {
    mockedInboundCall.findOneAndUpdate.mockReturnValue(
      leanUpdate({ ownerEmail: "agent@example.com", from: "+18085551212" }),
    );
    mockedInboundCall.updateOne.mockResolvedValue({});
    mockedSendSMS.mockRejectedValue(new Error("Twilio unavailable"));

    await expect(sendMissedCallTextOnce({ callSid: "CA1", status: "no-answer" })).rejects.toThrow("Twilio unavailable");
    expect(mockedInboundCall.updateOne).toHaveBeenLastCalledWith(
      expect.anything(),
      { $unset: { missedTextSendingAt: "" } },
    );
  });
});

describe("voice-status.ts wiring", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "pages/api/twilio/voice-status.ts"), "utf8");

  test("calls sendMissedCallTextOnce alongside the missed-call email, inside the same inbound+terminal gate, in its own try/catch", () => {
    expect(source).toContain('import { sendMissedCallTextOnce } from "@/lib/sms/sendMissedCallText";');

    const gateStart = source.indexOf('if (effDirection === "inbound" && terminalForBilling) {');
    expect(gateStart).toBeGreaterThan(-1);
    const gateBlock = source.slice(gateStart, gateStart + 900);

    expect(gateBlock).toContain("sendMissedInboundCallEmailOnce(");
    expect(gateBlock).toContain("sendMissedCallTextOnce(");
    // Each call is independently try/caught so a text-send failure can't
    // break the email notification or fall through into the billing block below.
    const textCallIndex = gateBlock.indexOf("sendMissedCallTextOnce(");
    const precedingTry = gateBlock.lastIndexOf("try {", textCallIndex);
    const followingCatch = gateBlock.indexOf("catch (e: any) {", textCallIndex);
    expect(precedingTry).toBeGreaterThan(-1);
    expect(followingCatch).toBeGreaterThan(textCallIndex);
  });
});
