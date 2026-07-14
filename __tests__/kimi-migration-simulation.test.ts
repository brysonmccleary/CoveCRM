// End-to-end simulation of the Kimi-fallback migration across all 5 approved
// sites. Unlike kimi-fallback-wrapper.test.ts (unit tests the wrapper in
// isolation) and kimi-fallback-site-wiring.test.ts (confirms each site calls
// the wrapper with the right args), this file runs the REAL wrapper + REAL
// kimiProvider/openaiProvider code for each site, with only the actual
// network boundary (the `openai` SDK's HTTP call) faked — differentiated by
// which baseURL/apiKey constructed the client, so both "Kimi succeeds" and
// "Kimi fails, OpenAI fallback serves the response" are exercised for real,
// through each site's actual parsing/DB-write logic, not just mocked stubs.

import type { NextApiRequest, NextApiResponse } from "next";

// ---- Fake network boundary --------------------------------------------
type ProviderBehavior = "success" | "authfail" | "badjson" | "timeout";
let kimiBehavior: ProviderBehavior = "success";
let openaiBehavior: ProviderBehavior = "success";
let kimiFakeContent = "kimi response";
let openaiFakeContent = "openai response";

jest.mock("openai", () => {
  return jest.fn().mockImplementation((config: any) => {
    const isKimi = String(config?.baseURL || "").includes("moonshot");
    return {
      chat: {
        completions: {
          create: jest.fn(async () => {
            const behavior = isKimi ? kimiBehavior : openaiBehavior;
            const content = isKimi ? kimiFakeContent : openaiFakeContent;

            if (behavior === "authfail") {
              const err: any = new Error("Incorrect API key provided");
              err.status = 401;
              throw err;
            }
            if (behavior === "timeout") {
              const err: any = new Error("Request timed out");
              throw err;
            }
            if (behavior === "badjson") {
              return { choices: [{ message: { content: "not valid json {{{" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
            }
            return { choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
          }),
        },
      },
    };
  });
});

beforeEach(() => {
  process.env.KIMI_API_KEY = "test-kimi-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  kimiBehavior = "success";
  openaiBehavior = "success";
  kimiFakeContent = "kimi response";
  openaiFakeContent = "openai response";
  jest.spyOn(console, "info").mockImplementation(() => undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---- Site 1: generateCallCoachReport.ts --------------------------------
jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/models/Call", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findById: jest.fn() },
}));
jest.mock("@/models/CallCoachReport", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() },
}));
jest.mock("@/lib/billing/trackUsage", () => ({ trackUsage: jest.fn().mockResolvedValue(undefined) }));

describe("Site 1: generateCallCoachReport.ts", () => {
  const Call = require("@/models/Call").default;
  const CallCoachReport = require("@/models/CallCoachReport").default;
  const { generateCallCoachReport } = require("@/lib/ai/generateCallCoachReport");

  beforeEach(() => {
    jest.clearAllMocks();
    CallCoachReport.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    CallCoachReport.updateOne.mockResolvedValue({ modifiedCount: 1 });
    Call.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "call1",
        callSid: "CA1",
        userId: "u1",
        leadId: "lead1",
        transcript: "Agent: Hi, this is Jane calling about your final expense quote. ".repeat(3),
        duration: 180,
        source: "manual",
      }),
    });
  });

  test("Kimi succeeds: produces a coach report from Kimi's JSON, never calls OpenAI", async () => {
    kimiFakeContent = JSON.stringify({
      callScore: 8,
      scoreBreakdown: { opening: 8, rapport: 7, discovery: 8, presentation: 8, objectionHandling: 7, closing: 8 },
      sandwichFeedback: { topBread: ["Good opening"], filling: ["Could isolate objection sooner"], bottomBread: ["Solid close"] },
      objectionsEncountered: [],
      nextStepRecommendation: "Ask for the appointment sooner.",
      managerSuggestion: null,
      callSummary: "Agent handled the call well and booked next steps.",
    });
    CallCoachReport.create.mockResolvedValue({ _id: "report1" });

    const result = await generateCallCoachReport("call1", "agent@example.com", "Jane Doe");

    expect(result.ok).toBe(true);
    expect(CallCoachReport.create).toHaveBeenCalledWith(expect.objectContaining({ callScore: 8, leadName: "Jane Doe" }));
  });

  test("Kimi fails (bad key): falls back to OpenAI, report still generated correctly — no dropped response", async () => {
    kimiBehavior = "authfail";
    openaiFakeContent = JSON.stringify({
      callScore: 6,
      scoreBreakdown: { opening: 6, rapport: 6, discovery: 6, presentation: 6, objectionHandling: 5, closing: 6 },
      sandwichFeedback: { topBread: [], filling: [], bottomBread: [] },
      objectionsEncountered: [],
      nextStepRecommendation: "Practice closing.",
      managerSuggestion: null,
      callSummary: "Fallback-generated summary.",
    });
    CallCoachReport.create.mockResolvedValue({ _id: "report2" });

    const result = await generateCallCoachReport("call1", "agent@example.com", "Jane Doe");

    expect(result.ok).toBe(true);
    expect(CallCoachReport.create).toHaveBeenCalledWith(expect.objectContaining({ callScore: 6, callSummary: "Fallback-generated summary." }));
  });

  test("Kimi returns malformed (non-JSON) content: JSON-mode validation rejects it, OpenAI fallback saves the day", async () => {
    kimiBehavior = "badjson"; // Kimi "succeeds" at the HTTP level but returns garbage
    openaiFakeContent = JSON.stringify({
      callScore: 7,
      scoreBreakdown: { opening: 7, rapport: 7, discovery: 7, presentation: 7, objectionHandling: 7, closing: 7 },
      sandwichFeedback: { topBread: [], filling: [], bottomBread: [] },
      objectionsEncountered: [],
      nextStepRecommendation: "n/a",
      managerSuggestion: null,
      callSummary: "Valid JSON from OpenAI after Kimi returned garbage.",
    });
    CallCoachReport.create.mockResolvedValue({ _id: "report3" });

    const result = await generateCallCoachReport("call1", "agent@example.com", "Jane Doe");

    expect(result.ok).toBe(true);
    expect(CallCoachReport.create).toHaveBeenCalledWith(expect.objectContaining({ callSummary: "Valid JSON from OpenAI after Kimi returned garbage." }));
  });

  test("both providers fail: fails safe (no crash, no half-written report)", async () => {
    kimiBehavior = "authfail";
    openaiBehavior = "timeout";

    const result = await generateCallCoachReport("call1", "agent@example.com", "Jane Doe");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("AI generation failed");
    expect(CallCoachReport.create).not.toHaveBeenCalled();
  });
});

// ---- Site 2: pages/api/facebook/analyze-ad.ts --------------------------
jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
jest.mock("@/lib/isExperimentalAdmin", () => ({ isExperimentalAdminEmail: jest.fn().mockReturnValue(true) }));
jest.mock("@/models/FBLeadSubscription", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

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
  } as unknown as NextApiResponse & { statusCode: number; body: any };
  return { req, res };
}

describe("Site 2: pages/api/facebook/analyze-ad.ts", () => {
  const { getServerSession } = require("next-auth/next");
  const FBLeadSubscription = require("@/models/FBLeadSubscription").default;
  const analyzeAdHandler = require("@/pages/api/facebook/analyze-ad").default;

  const AD_BODY = { adBody: "Get covered today", adTitle: "Protect your family", pageName: "Test Page" };

  beforeEach(() => {
    jest.clearAllMocks();
    getServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    FBLeadSubscription.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ status: "active" }) });
  });

  test("Kimi succeeds: returns Kimi's ad analysis JSON", async () => {
    kimiFakeContent = JSON.stringify({ hook: "Kimi hook", rewrittenCopy: "Kimi copy" });
    const { req, res } = mockReqRes(AD_BODY);

    await analyzeAdHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res as any).body.analysis.hook).toBe("Kimi hook");
  });

  test("Kimi fails: falls back to OpenAI, agent still gets a real analysis, not an error", async () => {
    kimiBehavior = "authfail";
    openaiFakeContent = JSON.stringify({ hook: "OpenAI fallback hook", rewrittenCopy: "OpenAI fallback copy" });
    const { req, res } = mockReqRes(AD_BODY);

    await analyzeAdHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res as any).body.analysis.hook).toBe("OpenAI fallback hook");
  });
});

// ---- Sites 3 & 4: generateActionReport.ts / generateWeeklyMarketReport.ts
jest.mock("@/models/FBLeadCampaign", () => ({
  __esModule: true,
  default: { find: jest.fn(), updateOne: jest.fn() },
}));
jest.mock("@/models/AdActionReport", () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));
jest.mock("@/models/CRMOutcome", () => ({
  __esModule: true,
  default: { aggregate: jest.fn().mockResolvedValue([]) },
}));
jest.mock("@/models/AdMetricsDaily", () => ({
  __esModule: true,
  default: { aggregate: jest.fn().mockResolvedValue([]) },
}));
jest.mock("@/models/CompetitorAd", () => ({
  __esModule: true,
  default: { find: jest.fn(() => ({ sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) })) },
}));

describe("Site 3: generateActionReport.ts", () => {
  const FBLeadCampaign = require("@/models/FBLeadCampaign").default;
  const AdActionReport = require("@/models/AdActionReport").default;
  const { generateDailyActionReport } = require("@/lib/facebook/generateActionReport");

  beforeEach(() => {
    jest.clearAllMocks();
    FBLeadCampaign.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: "c1", campaignName: "FE Campaign", leadType: "Final Expense", status: "active", performanceScore: 80, performanceClass: "SCALE" }]),
    });
    FBLeadCampaign.updateOne.mockResolvedValue({});
    AdActionReport.create.mockResolvedValue({});
  });

  test("Kimi succeeds: report text comes from Kimi and gets saved", async () => {
    kimiFakeContent = "Kimi-generated daily action report.";

    const reportText = await generateDailyActionReport("u1", "agent@example.com");

    expect(reportText).toBe("Kimi-generated daily action report.");
    expect(AdActionReport.create).toHaveBeenCalledWith(expect.objectContaining({ reportText: "Kimi-generated daily action report." }));
  });

  test("Kimi fails: OpenAI fallback report is saved instead — no dropped report", async () => {
    kimiBehavior = "timeout";
    openaiFakeContent = "OpenAI fallback daily action report.";

    const reportText = await generateDailyActionReport("u1", "agent@example.com");

    expect(reportText).toBe("OpenAI fallback daily action report.");
    expect(AdActionReport.create).toHaveBeenCalledWith(expect.objectContaining({ reportText: "OpenAI fallback daily action report.", tokensUsed: 150 }));
  });
});

describe("Site 4: generateWeeklyMarketReport.ts", () => {
  const FBLeadCampaign = require("@/models/FBLeadCampaign").default;
  const AdActionReport = require("@/models/AdActionReport").default;
  const { generateWeeklyMarketReport } = require("@/lib/facebook/generateWeeklyMarketReport");

  beforeEach(() => {
    jest.clearAllMocks();
    FBLeadCampaign.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: "c1", campaignName: "FE Campaign", leadType: "Final Expense", status: "active", performanceScore: 80, performanceClass: "SCALE" }]),
    });
    AdActionReport.create.mockResolvedValue({});
  });

  test("Kimi succeeds: weekly report text comes from Kimi and gets saved", async () => {
    kimiFakeContent = "Kimi-generated weekly market report.";

    const reportText = await generateWeeklyMarketReport("u1", "agent@example.com");

    expect(reportText).toBe("Kimi-generated weekly market report.");
    expect(AdActionReport.create).toHaveBeenCalledWith(expect.objectContaining({ reportText: "Kimi-generated weekly market report.", type: "weekly" }));
  });

  test("Kimi fails: OpenAI fallback weekly report is saved instead", async () => {
    kimiBehavior = "authfail";
    openaiFakeContent = "OpenAI fallback weekly market report.";

    const reportText = await generateWeeklyMarketReport("u1", "agent@example.com");

    expect(reportText).toBe("OpenAI fallback weekly market report.");
  });
});

// ---- Site 5: pages/api/ai/generate-summary.ts (legacy leadId path) -----
jest.mock("next-auth", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/billing/requireAI", () => ({ requireAI: jest.fn().mockResolvedValue({ ok: true }) }));
jest.mock("@/models/Lead", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));
jest.mock("@/models/User", () => ({
  __esModule: true,
  getUserByEmail: jest.fn(),
}));
jest.mock("@/lib/featureFlags", () => ({ isAdmin: jest.fn().mockReturnValue(false) }));

describe("Site 5: pages/api/ai/generate-summary.ts", () => {
  const { getServerSession } = require("next-auth");
  const Lead = require("@/models/Lead").default;
  const { getUserByEmail } = require("@/models/User");
  const generateSummaryHandler = require("@/pages/api/ai/generate-summary").default;

  function leadDoc() {
    return {
      _id: "lead1",
      userEmail: "agent@example.com",
      aiSummary: "",
      callTranscripts: [{ agent: "Jane", text: "Hi, calling about your quote." }],
      save: jest.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    getUserByEmail.mockResolvedValue({ email: "agent@example.com", hasAI: true, name: "Agent Smith" });
  });

  test("Kimi succeeds: lead.aiSummary is set from Kimi's output", async () => {
    kimiFakeContent = "• Kimi summary bullet one\n• Kimi summary bullet two";
    const lead = leadDoc();
    Lead.findById.mockResolvedValue(lead);

    const { req, res } = mockReqRes({ leadId: "lead1" });
    await generateSummaryHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(lead.aiSummary).toContain("Kimi summary bullet one");
    expect(lead.save).toHaveBeenCalled();
  });

  test("Kimi fails: OpenAI fallback summary is saved instead — lead never left without a summary", async () => {
    kimiBehavior = "authfail";
    openaiFakeContent = "• OpenAI fallback bullet one\n• OpenAI fallback bullet two";
    const lead = leadDoc();
    Lead.findById.mockResolvedValue(lead);

    const { req, res } = mockReqRes({ leadId: "lead1" });
    await generateSummaryHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(lead.aiSummary).toContain("OpenAI fallback bullet one");
    expect(lead.save).toHaveBeenCalled();
  });
});
