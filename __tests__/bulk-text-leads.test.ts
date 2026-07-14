import Lead from "@/models/Lead";
import User from "@/models/User";
import { sendSms } from "@/lib/twilio/sendSMS";
import { runBulkTextLeadsTool } from "@/lib/ai/assistant/bulkTextLeadsTool";
import { createBulkTextConfirmation } from "@/lib/ai/assistant/bulkTextConfirmation";

jest.mock("@/models/Lead", () => ({
  __esModule: true,
  default: { find: jest.fn(), countDocuments: jest.fn().mockResolvedValue(0) },
}));

jest.mock("@/models/User", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("@/models/Folder", () => ({
  __esModule: true,
  default: { find: jest.fn(() => ({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) })) },
}));

jest.mock("@/lib/twilio/sendSMS", () => ({
  __esModule: true,
  sendSms: jest.fn(),
}));

function chainable(value: unknown) {
  const chain: any = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(value),
  };
  return chain;
}

const mockedLead = Lead as unknown as { find: jest.Mock; countDocuments: jest.Mock };
const mockedUser = User as unknown as { findOne: jest.Mock };
const mockedSendSms = sendSms as jest.Mock;

const LEAD_1 = { _id: "507f1f77bcf86cd799439011", "First Name": "Jane", "Last Name": "Doe", Phone: "+18085551212" };
const LEAD_2 = { _id: "507f1f77bcf86cd799439012", "First Name": "John", Phone: "+18085551213" };

describe("bulk_text_leads", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXTAUTH_SECRET = "test-secret";
    mockedUser.findOne.mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ name: "Agent Smith" }) });
  });

  test("requires a message", async () => {
    const result = await runBulkTextLeadsTool("agent@example.com", { leadIds: ["507f1f77bcf86cd799439011"] } as any);
    expect(result.error).toBeTruthy();
    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  test("without confirm, previews only — sends nothing and reports counts and sample names", async () => {
    mockedLead.countDocuments.mockResolvedValue(2);
    mockedLead.find.mockReturnValue(chainable([LEAD_1, LEAD_2]));

    const result = await runBulkTextLeadsTool("agent@example.com", {
      leadIds: [LEAD_1._id, LEAD_2._id],
      message: "Hi {{first_name}}!",
    });

    expect(result.preview).toBe(true);
    expect(result.willTextCount).toBe(2);
    expect(result.sampleNames).toEqual(["Jane Doe", "John"]);
    expect(mockedSendSms).not.toHaveBeenCalled();
  });

  test("with confirm:true, renders merge fields, appends opt-out, and sends via sendSms with the assistant_bulk_text source", async () => {
    mockedLead.find.mockReturnValue(chainable([LEAD_1]));
    mockedSendSms.mockResolvedValue({});

    const result = await runBulkTextLeadsTool("agent@example.com", {
      leadIds: [LEAD_1._id],
      message: "Hi {{first_name}}, checking in!",
      confirm: true,
      confirmationToken: createBulkTextConfirmation({ userEmail: "agent@example.com", message: "Hi {{first_name}}, checking in!", leadIds: [LEAD_1._id] }),
    });

    expect(mockedSendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+18085551212",
        body: expect.stringContaining("Hi Jane, checking in!"),
        userEmail: "agent@example.com",
        leadId: LEAD_1._id,
        source: "assistant_bulk_text",
      }),
    );
    expect(mockedSendSms.mock.calls[0][0].body).toContain("Reply STOP to opt out");
    expect(result.preview).toBe(false);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  test("a lead with no phone number is skipped, not counted as failed", async () => {
    mockedLead.find.mockReturnValue(chainable([{ _id: "507f1f77bcf86cd799439013", "First Name": "NoPhone" }]));

    const result = await runBulkTextLeadsTool("agent@example.com", {
      leadIds: ["507f1f77bcf86cd799439013"],
      message: "hi",
      confirm: true,
      confirmationToken: createBulkTextConfirmation({ userEmail: "agent@example.com", message: "hi", leadIds: ["507f1f77bcf86cd799439013"] }),
    });

    expect(mockedSendSms).not.toHaveBeenCalled();
    expect(result.skippedNoPhone).toBe(1);
    expect(result.sent).toBe(0);
  });

  test("a send failure for one lead doesn't stop the rest, and is counted", async () => {
    mockedLead.find.mockReturnValue(chainable([LEAD_1, LEAD_2]));
    mockedSendSms.mockRejectedValueOnce(new Error("twilio down")).mockResolvedValueOnce({});

    const result = await runBulkTextLeadsTool("agent@example.com", {
      leadIds: [LEAD_1._id, LEAD_2._id],
      message: "hi",
      confirm: true,
      confirmationToken: createBulkTextConfirmation({ userEmail: "agent@example.com", message: "hi", leadIds: [LEAD_1._id, LEAD_2._id] }),
    });

    expect(mockedSendSms).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });

  test("caps at the max bulk size even if more leads match", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ _id: `id${i}`, "First Name": `L${i}`, Phone: `+1808555${1000 + i}` }));
    mockedLead.countDocuments.mockResolvedValue(200);
    // resolveLeadIds calls query_leads under the hood, which itself is capped at 200;
    // bulk_text_leads' own cap (50 default request) further limits this to <= 50.
    mockedLead.find.mockReturnValueOnce(chainable(many)).mockReturnValue(chainable(many.slice(0, 25)));

    const result = await runBulkTextLeadsTool("agent@example.com", { leadType: "Mortgage Protection", message: "hi" } as any);

    expect(result.willTextCount).toBeLessThanOrEqual(25);
  });

  test("confirm:true without the signed preview token sends nothing", async () => {
    const result = await runBulkTextLeadsTool("agent@example.com", {
      leadIds: [LEAD_1._id],
      message: "hi",
      confirm: true,
    });
    expect(result.error).toContain("confirmation");
    expect(mockedSendSms).not.toHaveBeenCalled();
  });
});
