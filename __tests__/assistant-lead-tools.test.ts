import Lead from "@/models/Lead";
import AISettings from "@/models/AISettings";
import CallLog from "@/models/CallLog";
import Folder from "@/models/Folder";
import { runQueryLeadsTool } from "@/lib/ai/assistant/queryLeadsTool";

// startAiDialSession.ts reads AI_VOICE_HTTP_BASE/COVECRM_API_SECRET as
// module-level constants at first import, so these two env vars must be set
// BEFORE that module (and startDialSessionTool, which imports it) is first
// required — hence the dynamic require in beforeAll below rather than a
// static top-of-file import.
let startAiDialSession: typeof import("@/lib/ai/dialSession/startAiDialSession").startAiDialSession;
let runStartDialSessionTool: typeof import("@/lib/ai/assistant/startDialSessionTool").runStartDialSessionTool;

jest.mock("@/lib/mongooseConnect", () => jest.fn());

jest.mock("@/models/Lead", () => ({
  __esModule: true,
  default: { find: jest.fn(), countDocuments: jest.fn() },
}));

jest.mock("@/lib/mongo/leads", () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));

jest.mock("@/models/AISettings", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock("@/models/CallLog", () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));

jest.mock("@/models/Folder", () => ({
  __esModule: true,
  default: { find: jest.fn() },
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
const mockedAISettings = AISettings as unknown as { findOne: jest.Mock };
const mockedCallLog = CallLog as unknown as { create: jest.Mock };
const mockedFolder = Folder as unknown as { find: jest.Mock };
// lib/mongo/leads default export, used by startAiDialSession
const mongoLeads = require("@/lib/mongo/leads").default as { find: jest.Mock };

beforeAll(() => {
  process.env.AI_VOICE_HTTP_BASE = "https://voice.test";
  process.env.COVECRM_API_SECRET = "secret";
  startAiDialSession = require("@/lib/ai/dialSession/startAiDialSession").startAiDialSession;
  runStartDialSessionTool = require("@/lib/ai/assistant/startDialSessionTool").runStartDialSessionTool;
});

describe("query_leads tool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLead.countDocuments.mockResolvedValue(0);
    mockedFolder.find.mockReturnValue(chainable([]));
  });

  test('"leads that haven\'t answered in the last week" builds status-exclude + recency filter, always scoped to the caller', async () => {
    mockedLead.find.mockReturnValue(chainable([]));

    await runQueryLeadsTool("agent@example.com", { statusNot: "Answered", notContactedInDays: 7 });

    const query = mockedLead.find.mock.calls[0][0];
    expect(query.$and).toEqual(
      expect.arrayContaining([
        { userEmail: "agent@example.com" },
        { status: { $not: expect.any(RegExp) } },
      ]),
    );
    const recencyClause = query.$and.find((c: any) => c.$or);
    expect(recencyClause.$or[0]).toEqual({ lastContactedAt: null });
    expect(recencyClause.$or[1].lastContactedAt.$lt).toBeInstanceOf(Date);
    // cutoff should be ~7 days ago
    const cutoff = recencyClause.$or[1].lastContactedAt.$lt as Date;
    const daysAgo = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(6.9);
    expect(daysAgo).toBeLessThan(7.1);
  });

  test('"my mortgage leads in Hawaii" filters by leadType and State', async () => {
    mockedLead.countDocuments.mockResolvedValue(1);
    mockedLead.find.mockReturnValue(chainable([
      { _id: "L1", "First Name": "Jane", "Last Name": "Doe", Phone: "+18085551212", status: "New", State: "HI", leadType: "Mortgage Protection", lastContactedAt: null },
    ]));

    const result = await runQueryLeadsTool("agent@example.com", { leadType: "Mortgage Protection", state: "HI" });

    const query = mockedLead.find.mock.calls[0][0];
    expect(query.$and).toEqual(
      expect.arrayContaining([
        { userEmail: "agent@example.com" },
        { leadType: "Mortgage Protection" },
      ]),
    );
    expect(query.$and).toEqual(expect.arrayContaining([
      { State: { $in: expect.arrayContaining([expect.any(RegExp), expect.any(RegExp)]) } },
    ]));
    expect(result.count).toBe(1);
    expect(result.leads[0]).toMatchObject({ id: "L1", name: "Jane Doe", state: "HI", leadType: "Mortgage Protection" });
  });

  test("folder lead type includes existing leads in that folder and accepts full state names", async () => {
    mockedFolder.find.mockReturnValue(chainable([{ _id: "folder-mortgage" }]));
    mockedLead.countDocuments.mockResolvedValue(1);
    mockedLead.find.mockReturnValue(chainable([]));

    await runQueryLeadsTool("agent@example.com", { leadType: "Mortgage Protection", state: "Hawaii" });

    const query = mockedLead.find.mock.calls[0][0];
    expect(query.$and).toEqual(expect.arrayContaining([
      { $or: [{ leadType: "Mortgage Protection" }, { folderId: { $in: ["folder-mortgage"] } }] },
      { State: { $in: expect.arrayContaining([expect.any(RegExp), expect.any(RegExp)]) } },
    ]));
  });

  test("casual specific-lead lookup supports a full name", async () => {
    mockedLead.find.mockReturnValue(chainable([]));
    await runQueryLeadsTool("agent@example.com", { search: "John Smith" });
    const query = mockedLead.find.mock.calls[0][0];
    const searchClauses = query.$and.filter((clause: any) => Array.isArray(clause.$or));
    expect(searchClauses).toHaveLength(2);
    expect(searchClauses[0].$or).toEqual(expect.arrayContaining([
      { "First Name": expect.any(RegExp) },
      { "Last Name": expect.any(RegExp) },
      { Phone: expect.any(RegExp) },
    ]));
  });

  test("folder-name, city, ZIP, and source filters can be combined", async () => {
    mockedFolder.find.mockReturnValue(chainable([{ _id: "folder-kayla" }]));
    mockedLead.find.mockReturnValue(chainable([]));
    await runQueryLeadsTool("agent@example.com", { folderName: "Kayla Leads", city: "Honolulu", zip: "96815", source: "Facebook" });
    expect(mockedFolder.find).toHaveBeenCalledWith({ userEmail: "agent@example.com", name: expect.any(RegExp) });
    const clauses = mockedLead.find.mock.calls[0][0].$and;
    expect(clauses).toEqual(expect.arrayContaining([
      { folderId: { $in: ["folder-kayla"] } },
      expect.objectContaining({ $or: expect.arrayContaining([{ "rawRow.City": expect.any(RegExp) }]) }),
      expect.objectContaining({ $or: expect.arrayContaining([{ "rawRow.Zip": expect.any(RegExp) }]) }),
      expect.objectContaining({ $or: expect.arrayContaining([{ leadSource: expect.any(RegExp) }]) }),
    ]));
  });

  test.each([
    ["vet", "Veteran"],
    ["mtg", "Mortgage Protection"],
    ["mortgage", "Mortgage Protection"],
    ["FE", "Final Expense"],
    ["fex", "Final Expense"],
    ["CDL", "Trucker"],
  ])('normalizes assistant lead-type shorthand "%s" to "%s"', async (shorthand, canonical) => {
    mockedLead.find.mockReturnValue(chainable([]));

    await runQueryLeadsTool("agent@example.com", { leadType: shorthand });

    expect(mockedFolder.find).toHaveBeenCalledWith({
      userEmail: "agent@example.com",
      leadType: canonical,
    });
    expect(mockedLead.find.mock.calls[0][0].$and).toContainEqual({ leadType: canonical });
  });

  test('"show me all my mortgage leads" (type only, no other filters) matches solely on leadType', async () => {
    mockedLead.countDocuments.mockResolvedValue(2);
    mockedLead.find.mockReturnValue(chainable([
      { _id: "L1", "First Name": "A", Phone: "1", leadType: "Mortgage Protection" },
      { _id: "L2", "First Name": "B", Phone: "2", leadType: "Mortgage Protection" },
    ]));

    const result = await runQueryLeadsTool("agent@example.com", { leadType: "Mortgage Protection" });

    const query = mockedLead.find.mock.calls[0][0];
    expect(query.$and).toEqual([{ userEmail: "agent@example.com" }, { leadType: "Mortgage Protection" }]);
    expect(result.count).toBe(2);
    expect(result.returned).toBe(2);
    expect(result.truncated).toBe(false);
  });

  test('"how many mortgage leads do I have" — count reflects the TRUE total, not just the returned/capped array length', async () => {
    // 137 real matches, but the leads array is capped at the default limit (50).
    mockedLead.countDocuments.mockResolvedValue(137);
    mockedLead.find.mockReturnValue(chainable(Array.from({ length: 50 }, (_, i) => ({ _id: `L${i}`, leadType: "Mortgage Protection" }))));

    const result = await runQueryLeadsTool("agent@example.com", { leadType: "Mortgage Protection" });

    expect(result.count).toBe(137);
    expect(result.returned).toBe(50);
    expect(result.truncated).toBe(true);
  });

  test("never trusts a caller-supplied userEmail override — always uses the argument passed by the route", async () => {
    mockedLead.find.mockReturnValue(chainable([]));
    await runQueryLeadsTool("real-agent@example.com", { status: "New" } as any);
    const query = mockedLead.find.mock.calls[0][0];
    expect(query.$and[0]).toEqual({ userEmail: "real-agent@example.com" });
  });

  test("limit is capped at 200", async () => {
    mockedLead.find.mockReturnValue(chainable([]));
    await runQueryLeadsTool("agent@example.com", { limit: 999999 });
    const chain = mockedLead.find.mock.results[0].value;
    expect(chain.limit).toHaveBeenCalledWith(200);
  });

  test('the state parameter description tells the model to convert a city to a state code itself (e.g. "Phoenix" → "AZ")', () => {
    const description = require("@/lib/ai/assistant/queryLeadsTool").QUERY_LEADS_TOOL_DEF.function.parameters.properties.state.description as string;
    expect(description.toLowerCase()).toContain("city");
    expect(description).toContain("AZ");
  });

  test('"leads imported this week" builds a createdAt >= 7-days-ago filter', async () => {
    mockedLead.find.mockReturnValue(chainable([]));
    await runQueryLeadsTool("agent@example.com", { createdWithinDays: 7 });

    const query = mockedLead.find.mock.calls[0][0];
    const clause = query.$and.find((c: any) => c.createdAt);
    expect(clause.createdAt.$gte).toBeInstanceOf(Date);
    const daysAgo = (Date.now() - clause.createdAt.$gte.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(6.9);
    expect(daysAgo).toBeLessThan(7.1);
  });

  test("createdWithinDays is combinable with leadType and state", async () => {
    mockedLead.find.mockReturnValue(chainable([]));
    await runQueryLeadsTool("agent@example.com", { leadType: "Final Expense", state: "AZ", createdWithinDays: 7 });

    const query = mockedLead.find.mock.calls[0][0];
    expect(query.$and).toEqual(
      expect.arrayContaining([
        { userEmail: "agent@example.com" },
        { leadType: "Final Expense" },
        expect.objectContaining({ createdAt: expect.objectContaining({ $gte: expect.any(Date) }) }),
      ]),
    );
  });

  test("createdBeforeDays builds a createdAt < N-days-ago filter", async () => {
    mockedLead.find.mockReturnValue(chainable([]));
    await runQueryLeadsTool("agent@example.com", { createdBeforeDays: 30 });

    const query = mockedLead.find.mock.calls[0][0];
    const clause = query.$and.find((c: any) => c.createdAt);
    expect(clause.createdAt.$lt).toBeInstanceOf(Date);
  });
});

describe("startAiDialSession (shared core, extracted from the HTTP route)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_VOICE_HTTP_BASE = "https://voice.test";
    process.env.COVECRM_API_SECRET = "secret";
  });

  test("requires a non-empty leadIds array", async () => {
    const result = await startAiDialSession({ email: "agent@example.com", leadIds: [] });
    expect(result).toEqual({ ok: false, status: 400, error: "leadIds array is required" });
  });

  test("blocks when AI dial sessions are not enabled for the tenant", async () => {
    mockedAISettings.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ aiDialSessionEnabled: false }) });
    const result = await startAiDialSession({ email: "agent@example.com", leadIds: ["507f1f77bcf86cd799439011"] });
    expect(result).toEqual({ ok: false, status: 403, error: expect.stringContaining("not enabled") });
  });

  test("returns 404 when no accessible leads match", async () => {
    mockedAISettings.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ aiDialSessionEnabled: true }) });
    mongoLeads.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    const result = await startAiDialSession({ email: "agent@example.com", leadIds: ["507f1f77bcf86cd799439011"] });
    expect(result).toEqual({ ok: false, status: 404, error: "No accessible leads found" });
  });

  test("starts a session and scopes the lead lookup to the caller's own leads", async () => {
    mockedAISettings.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ aiDialSessionEnabled: true }) });
    mongoLeads.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: "L1", Phone: "+18085551212" }]),
    });
    // avoid an unhandled real fetch in the background loop
    (global as any).fetch = jest.fn().mockRejectedValue(new Error("no network in test"));

    const result = await startAiDialSession({ email: "agent@example.com", leadIds: ["507f1f77bcf86cd799439011"] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalLeads).toBe(1);
      expect(result.sessionId).toBeTruthy();
    }
    const findArgs = mongoLeads.find.mock.calls[0][0];
    expect(findArgs.$or).toEqual([{ userEmail: "agent@example.com" }, { ownerEmail: "agent@example.com" }]);
  });
});

describe("start_dial_session tool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_VOICE_HTTP_BASE = "https://voice.test";
    process.env.COVECRM_API_SECRET = "secret";
    (global as any).fetch = jest.fn().mockRejectedValue(new Error("no network in test"));
  });

  test("no matching leads returns a clean no-op instead of erroring", async () => {
    mockedLead.find.mockReturnValue(chainable([]));
    const result = await runStartDialSessionTool("agent@example.com", { leadType: "Mortgage Protection", state: "HI" });
    expect(result).toEqual({ started: false, reason: "no_matching_leads", totalLeads: 0 });
  });

  test('"start a dial session with my mortgage leads in Hawaii" filters then launches', async () => {
    mockedLead.find.mockReturnValue(chainable([
      { _id: "507f1f77bcf86cd799439011", "First Name": "Jane", Phone: "+18085551212", leadType: "Mortgage Protection", State: "HI" },
    ]));
    mockedAISettings.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ aiDialSessionEnabled: true }) });
    mongoLeads.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: "507f1f77bcf86cd799439011", Phone: "+18085551212" }]),
    });

    const result = await runStartDialSessionTool("agent@example.com", { leadType: "Mortgage Protection", state: "HI" });

    // filtered via query_leads logic
    const leadQuery = mockedLead.find.mock.calls[0][0];
    expect(leadQuery.$and).toEqual(
      expect.arrayContaining([{ userEmail: "agent@example.com" }, { leadType: "Mortgage Protection" }]),
    );
    expect(result).toMatchObject({ started: true, totalLeads: 1 });
  });

  test("explicit leadIds skip the filter query entirely", async () => {
    mockedAISettings.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ aiDialSessionEnabled: true }) });
    mongoLeads.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: "507f1f77bcf86cd799439011", Phone: "+18085551212" }]),
    });

    await runStartDialSessionTool("agent@example.com", { leadIds: ["507f1f77bcf86cd799439011"] });

    expect(mockedLead.find).not.toHaveBeenCalled();
  });
});
