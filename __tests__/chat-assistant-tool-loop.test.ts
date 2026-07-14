import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import OpenAI from "openai";
import chatAssistantHandler from "../pages/api/chat-assistant";
import { runQueryLeadsTool } from "@/lib/ai/assistant/queryLeadsTool";
import { runStartDialSessionTool } from "@/lib/ai/assistant/startDialSessionTool";
import { runAddNoteToLeadsTool } from "@/lib/ai/assistant/addNoteToLeadsTool";
import { runMoveLeadsToFolderTool } from "@/lib/ai/assistant/moveLeadsToFolderTool";
import { runUpdateLeadStatusTool } from "@/lib/ai/assistant/updateLeadStatusTool";
import { runBulkTextLeadsTool } from "@/lib/ai/assistant/bulkTextLeadsTool";
import { runScheduleAppointmentTool } from "@/lib/ai/assistant/scheduleAppointmentTool";

jest.mock("next-auth/next", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("../pages/api/auth/[...nextauth]", () => ({
  authOptions: {},
}));

jest.mock("@/lib/mongooseConnect", () => jest.fn());

// bulkTextLeadsTool.ts and scheduleAppointmentTool.ts transitively import
// lib/twilio/sendSMS.ts → lib/billing/trackUsage.ts → lib/stripe.ts, which
// throws without a real STRIPE_SECRET_KEY. Stub stripe at the root so every
// jest.requireActual(...) below (used to keep each tool's real TOOL_DEF
// while only mocking its runner) can load without that chain firing.
jest.mock("@/lib/stripe", () => ({ stripe: {} }));

// The mock's jest.fn() is created entirely inside the factory (no outer-scope
// reference) to avoid a hoisting/TDZ error, then exposed on the mocked
// constructor so the test can assert against it.
jest.mock("openai", () => {
  const create = jest.fn();
  const ctor: any = jest.fn().mockImplementation(() => ({
    chat: { completions: { create } },
  }));
  ctor.__mockCreate = create;
  return ctor;
});

const mockCreate = (OpenAI as any).__mockCreate as jest.Mock;

jest.mock("@/lib/ai/assistant/queryLeadsTool", () => {
  const actual = jest.requireActual("@/lib/ai/assistant/queryLeadsTool");
  return { ...actual, runQueryLeadsTool: jest.fn() };
});

jest.mock("@/lib/ai/assistant/startDialSessionTool", () => {
  const actual = jest.requireActual("@/lib/ai/assistant/startDialSessionTool");
  return { ...actual, runStartDialSessionTool: jest.fn() };
});

// These four transitively import lib/twilio/sendSMS.ts → lib/billing/trackUsage.ts
// → lib/stripe.ts, which throws without a real STRIPE_SECRET_KEY — mock the
// whole tool module (like the two above) so that chain never loads.
jest.mock("@/lib/ai/assistant/addNoteToLeadsTool", () => {
  const actual = jest.requireActual("@/lib/ai/assistant/addNoteToLeadsTool");
  return { ...actual, runAddNoteToLeadsTool: jest.fn() };
});
jest.mock("@/lib/ai/assistant/moveLeadsToFolderTool", () => {
  const actual = jest.requireActual("@/lib/ai/assistant/moveLeadsToFolderTool");
  return { ...actual, runMoveLeadsToFolderTool: jest.fn() };
});
jest.mock("@/lib/ai/assistant/updateLeadStatusTool", () => {
  const actual = jest.requireActual("@/lib/ai/assistant/updateLeadStatusTool");
  return { ...actual, runUpdateLeadStatusTool: jest.fn() };
});
jest.mock("@/lib/ai/assistant/bulkTextLeadsTool", () => {
  const actual = jest.requireActual("@/lib/ai/assistant/bulkTextLeadsTool");
  return { ...actual, runBulkTextLeadsTool: jest.fn() };
});
jest.mock("@/lib/ai/assistant/scheduleAppointmentTool", () => {
  const actual = jest.requireActual("@/lib/ai/assistant/scheduleAppointmentTool");
  return { ...actual, runScheduleAppointmentTool: jest.fn() };
});

function mockReqRes(body: Record<string, unknown> = {}) {
  const req = { method: "POST", body, headers: {} } as unknown as NextApiRequest;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: jest.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: any, payload: unknown) {
      this.body = payload;
      return this;
    }),
    setHeader: jest.fn(),
  } as unknown as NextApiResponse & { statusCode: number; body: any };
  return { req, res };
}

const mockedGetServerSession = getServerSession as jest.Mock;
const mockedRunQueryLeads = runQueryLeadsTool as jest.Mock;
const mockedRunStartDialSession = runStartDialSessionTool as jest.Mock;
const mockedRunAddNote = runAddNoteToLeadsTool as jest.Mock;
const mockedRunMoveFolder = runMoveLeadsToFolderTool as jest.Mock;
const mockedRunUpdateStatus = runUpdateLeadStatusTool as jest.Mock;
const mockedRunBulkText = runBulkTextLeadsTool as jest.Mock;
const mockedRunSchedule = runScheduleAppointmentTool as jest.Mock;

function textOnlyResponse(content: string) {
  return { choices: [{ message: { role: "assistant", content, tool_calls: undefined } }] };
}

function toolCallResponse(name: string, args: Record<string, unknown>, id = "call_1") {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

describe("chat-assistant tool-calling loop", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // enforceRateLimit's store is a module-level Map on globalThis, shared
    // across every test in this file — reset it so one test's request count
    // can't spuriously 429 a later, unrelated test.
    (globalThis as any).__coveRateLimitStore?.clear();
  });

  test("unauthenticated request returns 401 and never calls OpenAI", async () => {
    mockedGetServerSession.mockResolvedValue(null);
    const { req, res } = mockReqRes({ message: "hi" });
    await chatAssistantHandler(req, res);
    expect(res.statusCode).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("plain question with no tool call returns the model's reply directly", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    mockCreate.mockResolvedValueOnce(textOnlyResponse("You can import leads from Settings."));

    const { req, res } = mockReqRes({ message: "how do I import leads?" });
    await chatAssistantHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res as any).body.reply).toBe("You can import leads from Settings.");
    expect(mockedRunQueryLeads).not.toHaveBeenCalled();
  });

  test("includes recent conversation history so follow-up messages keep context", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    mockCreate.mockResolvedValueOnce(textOnlyResponse("Yes, those mortgage leads."));

    const { req, res } = mockReqRes({
      message: "what about those?",
      history: [
        { role: "user", content: "show my mortgage leads" },
        { role: "assistant", content: "You have 12 mortgage leads." },
      ],
    });
    await chatAssistantHandler(req, res);

    const sentMessages = mockCreate.mock.calls[0][0].messages;
    expect(sentMessages).toEqual(expect.arrayContaining([
      { role: "user", content: "show my mortgage leads" },
      { role: "assistant", content: "You have 12 mortgage leads." },
      { role: "user", content: "what about those?" },
    ]));
  });

  test("carries a pending bulk-text confirmation into an explicit approval", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    mockedRunBulkText.mockResolvedValue({ preview: false, sent: 2, failed: 0 });
    mockCreate
      .mockResolvedValueOnce(toolCallResponse("bulk_text_leads", { message: "Hi", confirm: true }))
      .mockResolvedValueOnce(textOnlyResponse("Sent 2 messages."));

    const { req, res } = mockReqRes({
      message: "yes, send them",
      history: [{ role: "assistant", content: "This will text Jane and John. Proceed?" }],
      pendingBulkTextConfirmation: "signed-preview-token",
    });
    await chatAssistantHandler(req, res);

    expect(mockedRunBulkText).toHaveBeenCalledWith(
      "agent@example.com",
      expect.objectContaining({ confirm: true, confirmationToken: "signed-preview-token" }),
    );
    expect((res as any).body.pendingBulkTextConfirmation).toBeNull();
  });

  test('"leads that haven\'t answered in the last week" calls query_leads scoped to the session email, not anything the model supplies', async () => {
    mockedGetServerSession.mockResolvedValue({ user: { email: "Agent@Example.com" } });
    mockedRunQueryLeads.mockResolvedValue({ count: 2, leads: [{ id: "a" }, { id: "b" }] });

    mockCreate
      .mockResolvedValueOnce(
        toolCallResponse("query_leads", { statusNot: "Answered", notContactedInDays: 7, userEmail: "attacker@evil.com" }),
      )
      .mockResolvedValueOnce(textOnlyResponse("You have 2 leads that haven't answered in the last week."));

    const { req, res } = mockReqRes({ message: "pull up leads that haven't answered in the last week" });
    await chatAssistantHandler(req, res);

    expect(res.statusCode).toBe(200);
    // Tenant scoping: always the session's own email, lowercased — never the
    // (attacker-supplied) userEmail field the model put in its tool arguments.
    expect(mockedRunQueryLeads).toHaveBeenCalledWith(
      "agent@example.com",
      expect.objectContaining({ statusNot: "Answered", notContactedInDays: 7 }),
    );
    expect((res as any).body.reply).toContain("2 leads");
  });

  test('"start a dial session with my mortgage leads in Hawaii" calls start_dial_session with the right filters', async () => {
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    mockedRunStartDialSession.mockResolvedValue({ started: true, totalLeads: 4, sessionId: "s1" });

    mockCreate
      .mockResolvedValueOnce(toolCallResponse("start_dial_session", { leadType: "Mortgage Protection", state: "HI" }))
      .mockResolvedValueOnce(textOnlyResponse("Started a dial session with 4 leads."));

    const { req, res } = mockReqRes({ message: "start a dial session with my mortgage leads in Hawaii" });
    await chatAssistantHandler(req, res);

    expect(mockedRunStartDialSession).toHaveBeenCalledWith(
      "agent@example.com",
      expect.objectContaining({ leadType: "Mortgage Protection", state: "HI" }),
    );
    expect((res as any).body.reply).toContain("4 leads");
  });

  test("tool-call rounds are capped so a misbehaving model can't loop forever", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    mockedRunQueryLeads.mockResolvedValue({ count: 0, leads: [] });
    // Always returns another tool call, never a final answer.
    mockCreate.mockResolvedValue(toolCallResponse("query_leads", { status: "New" }));

    const { req, res } = mockReqRes({ message: "keep searching" });
    await chatAssistantHandler(req, res);

    expect(res.statusCode).toBe(200);
    // MAX_TOOL_ROUNDS (4) rounds inside the loop + 1 final "wrap up in prose" call = 5 total.
    expect(mockCreate).toHaveBeenCalledTimes(5);
  });

  test("unknown tool name is reported back to the model instead of throwing", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    mockCreate
      .mockResolvedValueOnce(toolCallResponse("delete_everything", {}))
      .mockResolvedValueOnce(textOnlyResponse("I can't do that."));

    const { req, res } = mockReqRes({ message: "delete everything" });
    await chatAssistantHandler(req, res);

    expect(res.statusCode).toBe(200);
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const toolResultMessage = secondCallMessages.find((m: any) => m.role === "tool");
    expect(JSON.parse(toolResultMessage.content)).toEqual({ error: "Unknown tool: delete_everything" });
  });

  test("uses gpt-4o-mini (cost fix), and the tool-calling loop still round-trips correctly on it", async () => {
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    mockedRunQueryLeads.mockResolvedValue({ count: 1, returned: 1, truncated: false, leads: [{ id: "L1", name: "Jane Doe" }] });

    mockCreate
      .mockResolvedValueOnce(toolCallResponse("query_leads", { leadType: "Mortgage Protection" }))
      .mockResolvedValueOnce(textOnlyResponse("You have 1 mortgage lead: Jane Doe."));

    const { req, res } = mockReqRes({ message: "show me all my mortgage leads" });
    await chatAssistantHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockCreate.mock.calls[0][0].model).toBe("gpt-4o-mini");
    expect(mockCreate.mock.calls[1][0].model).toBe("gpt-4o-mini");
    expect(mockedRunQueryLeads).toHaveBeenCalledWith("agent@example.com", expect.objectContaining({ leadType: "Mortgage Protection" }));
  });

  describe("broader phrasing", () => {
    beforeEach(() => {
      mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    });

    test('"show me all my mortgage leads" — type only, no status/date/location filters', async () => {
      mockedRunQueryLeads.mockResolvedValue({ count: 5, returned: 5, truncated: false, leads: [] });
      mockCreate
        .mockResolvedValueOnce(toolCallResponse("query_leads", { leadType: "Mortgage Protection" }))
        .mockResolvedValueOnce(textOnlyResponse("You have 5 mortgage leads."));

      const { req, res } = mockReqRes({ message: "show me all my mortgage leads" });
      await chatAssistantHandler(req, res);

      const args = mockedRunQueryLeads.mock.calls[0][1];
      expect(args.leadType).toBe("Mortgage Protection");
      expect(args.status).toBeUndefined();
      expect(args.statusNot).toBeUndefined();
      expect(args.notContactedInDays).toBeUndefined();
      expect(args.state).toBeUndefined();
    });

    test('"all my final expense leads in Phoenix" — type + location (city converted to state)', async () => {
      mockedRunQueryLeads.mockResolvedValue({ count: 3, returned: 3, truncated: false, leads: [] });
      mockCreate
        .mockResolvedValueOnce(toolCallResponse("query_leads", { leadType: "Final Expense", state: "AZ" }))
        .mockResolvedValueOnce(textOnlyResponse("You have 3 final expense leads in Phoenix."));

      const { req, res } = mockReqRes({ message: "all my final expense leads in Phoenix" });
      await chatAssistantHandler(req, res);

      expect(mockedRunQueryLeads).toHaveBeenCalledWith(
        "agent@example.com",
        expect.objectContaining({ leadType: "Final Expense", state: "AZ" }),
      );
    });

    test('"how many mortgage leads do I have" — reply is grounded in the tool\'s count field', async () => {
      mockedRunQueryLeads.mockResolvedValue({ count: 42, returned: 42, truncated: false, leads: [] });
      mockCreate
        .mockResolvedValueOnce(toolCallResponse("query_leads", { leadType: "Mortgage Protection" }))
        .mockResolvedValueOnce(textOnlyResponse("You have 42 mortgage leads."));

      const { req, res } = mockReqRes({ message: "how many mortgage leads do I have" });
      await chatAssistantHandler(req, res);

      expect(mockedRunQueryLeads).toHaveBeenCalledWith("agent@example.com", expect.objectContaining({ leadType: "Mortgage Protection" }));
      expect((res as any).body.reply).toContain("42");
    });
  });

  test("system prompt instructs the model to show lead names, not raw ids, and to trust the count field", () => {
    const fs = require("fs");
    const path = require("path");
    const source = fs.readFileSync(path.join(process.cwd(), "pages/api/chat-assistant.ts"), "utf8");
    expect(source).toContain("NEVER show the raw lead id to the user");
    expect(source.toLowerCase()).toContain('"count" field');
  });

  describe("new lead-management, bulk-text, and scheduling tools are wired up", () => {
    beforeEach(() => {
      mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    });

    test("add_note_to_leads is reachable through the tool loop, scoped to the session email", async () => {
      mockedRunAddNote.mockResolvedValue({ updated: 3, matched: 3 });
      mockCreate
        .mockResolvedValueOnce(toolCallResponse("add_note_to_leads", { leadType: "Trucker", note: "called today" }))
        .mockResolvedValueOnce(textOnlyResponse("Added that note to 3 leads."));

      const { req, res } = mockReqRes({ message: "add a note to all my trucker leads saying I called today" });
      await chatAssistantHandler(req, res);

      expect(mockedRunAddNote).toHaveBeenCalledWith("agent@example.com", expect.objectContaining({ note: "called today" }));
      expect((res as any).body.reply).toContain("3");
    });

    test("move_leads_to_folder is reachable through the tool loop", async () => {
      mockedRunMoveFolder.mockResolvedValue({ moved: 2, folderName: "Hot Leads" });
      mockCreate
        .mockResolvedValueOnce(toolCallResponse("move_leads_to_folder", { leadType: "IUL", folderName: "Hot Leads" }))
        .mockResolvedValueOnce(textOnlyResponse("Moved 2 leads to Hot Leads."));

      const { req, res } = mockReqRes({ message: "move my IUL leads to Hot Leads" });
      await chatAssistantHandler(req, res);

      expect(mockedRunMoveFolder).toHaveBeenCalledWith("agent@example.com", expect.objectContaining({ folderName: "Hot Leads" }));
    });

    test("update_lead_status is reachable through the tool loop", async () => {
      mockedRunUpdateStatus.mockResolvedValue({ updated: 5, status: "Not Interested" });
      mockCreate
        .mockResolvedValueOnce(toolCallResponse("update_lead_status", { leadType: "Mortgage Protection", state: "HI", status: "Not Interested" }))
        .mockResolvedValueOnce(textOnlyResponse("Marked 5 leads Not Interested."));

      const { req, res } = mockReqRes({ message: "mark my mortgage leads in Hawaii as not interested" });
      await chatAssistantHandler(req, res);

      expect(mockedRunUpdateStatus).toHaveBeenCalledWith(
        "agent@example.com",
        expect.objectContaining({ leadType: "Mortgage Protection", state: "HI", status: "Not Interested" }),
      );
    });

    test("bulk_text_leads previews before sending — the model must call it once without confirm, per the system prompt", async () => {
      mockedRunBulkText.mockResolvedValue({ preview: true, matchCount: 10, willTextCount: 10, sampleNames: ["Jane Doe"] });
      mockCreate
        .mockResolvedValueOnce(toolCallResponse("bulk_text_leads", { leadType: "Final Expense", message: "Hi {{first_name}}!" }))
        .mockResolvedValueOnce(textOnlyResponse("This would text 10 leads, starting with Jane Doe. Want me to send it?"));

      const { req, res } = mockReqRes({ message: "text all my final expense leads to check in" });
      await chatAssistantHandler(req, res);

      const args = mockedRunBulkText.mock.calls[0][1];
      expect(args.confirm).not.toBe(true);
      expect((res as any).body.reply).toContain("10");
    });

    test("bulk_text_leads sends only once the model passes confirm:true", async () => {
      mockedRunBulkText.mockResolvedValue({ preview: false, sent: 10, failed: 0 });
      mockCreate
        .mockResolvedValueOnce(toolCallResponse("bulk_text_leads", { leadType: "Final Expense", message: "Hi {{first_name}}!", confirm: true }))
        .mockResolvedValueOnce(textOnlyResponse("Sent to 10 leads."));

      const { req, res } = mockReqRes({ message: "yes, send it" });
      await chatAssistantHandler(req, res);

      expect(mockedRunBulkText).toHaveBeenCalledWith("agent@example.com", expect.objectContaining({ confirm: true }));
    });

    test("system prompt requires a preview-then-confirm sequence for bulk_text_leads and never lets it write its own opt-out text", () => {
      const fs = require("fs");
      const path = require("path");
      const source = fs.readFileSync(path.join(process.cwd(), "pages/api/chat-assistant.ts"), "utf8");
      expect(source).toContain("Never set confirm:true on the first call");
      expect(source.toLowerCase()).toContain("added automatically");
    });

    test("schedule_appointment is reachable through the tool loop", async () => {
      mockedRunSchedule.mockResolvedValue({ scheduled: true, eventId: "evt1", eventUrl: "https://calendar.google.com/evt1" });
      mockCreate
        .mockResolvedValueOnce(toolCallResponse("schedule_appointment", {
          leadId: "507f1f77bcf86cd799439011",
          startISO: "2026-08-01T14:00:00-07:00",
          endISO: "2026-08-01T14:30:00-07:00",
        }))
        .mockResolvedValueOnce(textOnlyResponse("Booked the appointment."));

      const { req, res } = mockReqRes({ message: "schedule a call with this lead next Tuesday at 2pm" });
      await chatAssistantHandler(req, res);

      expect(mockedRunSchedule).toHaveBeenCalledWith(
        "agent@example.com",
        expect.objectContaining({ leadId: "507f1f77bcf86cd799439011" }),
      );
    });

    test("system prompt gives the model the current date so it can compute relative appointment times itself", () => {
      const fs = require("fs");
      const path = require("path");
      const source = fs.readFileSync(path.join(process.cwd(), "pages/api/chat-assistant.ts"), "utf8");
      expect(source).toContain("The current date/time is");
      expect(source).toContain("Use manage_appointment to list, reschedule, or cancel an existing appointment");
    });
  });
});
