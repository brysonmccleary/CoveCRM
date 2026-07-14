import type { NextApiRequest, NextApiResponse } from "next";
import reconcileHandler from "../pages/api/cron/reconcile-billing";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { reconcileBillingForTenant } from "@/lib/billing/reconcileNightly";

jest.mock("@/lib/mongooseConnect", () => jest.fn());

// reconcileNightly.ts imports @/lib/stripe at module scope (which throws without
// STRIPE_SECRET_KEY set); this test only needs the pure date-window helpers from
// the real module, so stub stripe out to satisfy the import chain.
jest.mock("@/lib/stripe", () => ({ stripe: {} }));

jest.mock("@/models/User", () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
  },
}));

jest.mock("@/lib/billing/reconcileNightly", () => {
  const actual = jest.requireActual("@/lib/billing/reconcileNightly");
  return {
    ...actual,
    reconcileBillingForTenant: jest.fn(),
  };
});

function mockReqRes({
  method = "GET",
  query = {},
  headers = {},
}: { method?: string; query?: Record<string, unknown>; headers?: Record<string, unknown> } = {}) {
  const req = { method, query, headers, body: {} } as unknown as NextApiRequest;
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

const mockedDbConnect = dbConnect as jest.Mock;
const mockedUser = User as unknown as { find: jest.Mock };
const mockedReconcile = reconcileBillingForTenant as jest.Mock;

function leanChain(value: unknown) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) };
}

function cleanReport(userEmail: string) {
  return {
    readOnly: true,
    userEmail,
    window: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z", label: "2026-01-01" },
    summary: { aiLedgerRows: 0, manualBilledCalls: 0, transferredCalls: 0, billingEvents: 0, aiFindings: 0, manualFindings: 0, transferGapCandidates: 0, stripeBatchMismatches: 0 },
    aiFindings: [],
    manualFindings: [],
    stripeBatchCoverage: [],
    transferGapCandidates: [],
  };
}

describe("billing reconciliation cron", () => {
  const originalEnv = { CRON_SECRET: process.env.CRON_SECRET, VERCEL_CRON_SECRET: process.env.VERCEL_CRON_SECRET };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedDbConnect.mockResolvedValue(undefined);
    process.env.CRON_SECRET = "cron-secret";
    delete process.env.VERCEL_CRON_SECRET;
  });

  afterAll(() => {
    process.env.CRON_SECRET = originalEnv.CRON_SECRET;
    process.env.VERCEL_CRON_SECRET = originalEnv.VERCEL_CRON_SECRET;
  });

  test("unauthenticated request is rejected", async () => {
    const { req, res } = mockReqRes();
    await reconcileHandler(req, res);
    expect(res.statusCode).toBe(401);
    expect(mockedUser.find).not.toHaveBeenCalled();
  });

  test("a spoofed x-vercel-cron header is rejected without the secret", async () => {
    const { req, res } = mockReqRes({ headers: { "x-vercel-cron": "1" } });
    await reconcileHandler(req, res);
    expect(res.statusCode).toBe(401);
    expect(mockedUser.find).not.toHaveBeenCalled();
  });

  test("no userEmail param loops every tenant and never writes/charges anything", async () => {
    mockedUser.find.mockReturnValue(
      leanChain([{ email: "a@example.com" }, { email: "b@example.com" }]),
    );
    mockedReconcile.mockImplementation(async ({ userEmail }: any) => cleanReport(userEmail));

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    const { req, res } = mockReqRes({ headers: { authorization: "Bearer cron-secret" } });
    await reconcileHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res as any).body.mode).toBe("all-tenants");
    expect((res as any).body.tenantsChecked).toBe(2);
    expect((res as any).body.tenantsFailed).toBe(0);
    expect(mockedReconcile).toHaveBeenCalledTimes(2);
    expect(mockedReconcile).toHaveBeenCalledWith(expect.objectContaining({ userEmail: "a@example.com" }));
    expect(mockedReconcile).toHaveBeenCalledWith(expect.objectContaining({ userEmail: "b@example.com" }));

    // Read-only guarantee: @/models/User is mocked with ONLY find() defined above.
    // If the route called any write method (updateOne/findOneAndUpdate/create/save),
    // that call would throw "not a function" and this test would fail — it didn't,
    // so the cron path performed no writes.

    logSpy.mockRestore();
  });

  test("one tenant failing does not stop the rest, and is reported", async () => {
    mockedUser.find.mockReturnValue(
      leanChain([{ email: "ok@example.com" }, { email: "broken@example.com" }]),
    );
    mockedReconcile.mockImplementation(async ({ userEmail }: any) => {
      if (userEmail === "broken@example.com") throw new Error("Tenant user not found");
      return cleanReport(userEmail);
    });

    jest.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const { req, res } = mockReqRes({ headers: { authorization: "Bearer cron-secret" } });
    await reconcileHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res as any).body.tenantsChecked).toBe(1);
    expect((res as any).body.tenantsFailed).toBe(1);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  test("drift found for a tenant is logged with DRIFT FOUND and surfaced in tenantsWithFindings", async () => {
    mockedUser.find.mockReturnValue(leanChain([{ email: "drift@example.com" }]));
    mockedReconcile.mockResolvedValue({
      ...cleanReport("drift@example.com"),
      aiFindings: [{ type: "AI_METER_OVER_TWILIO", callSid: "CA1" }],
      summary: { ...cleanReport("drift@example.com").summary, aiFindings: 1 },
    });

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    const { req, res } = mockReqRes({ headers: { authorization: "Bearer cron-secret" } });
    await reconcileHandler(req, res);

    expect((res as any).body.tenantsWithFindings).toBe(1);
    expect(logSpy).toHaveBeenCalledWith(
      "[billing-reconciliation] DRIFT FOUND",
      expect.stringContaining("AI_METER_OVER_TWILIO"),
    );

    logSpy.mockRestore();
  });

  test("passing userEmail still runs single-tenant mode unchanged", async () => {
    mockedReconcile.mockResolvedValue(cleanReport("single@example.com"));
    const { req, res } = mockReqRes({
      query: { userEmail: "single@example.com" },
      headers: { authorization: "Bearer cron-secret" },
    });

    await reconcileHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res as any).body.mode).toBe("single-tenant");
    expect(mockedUser.find).not.toHaveBeenCalled();
    expect(mockedReconcile).toHaveBeenCalledTimes(1);
  });
});
