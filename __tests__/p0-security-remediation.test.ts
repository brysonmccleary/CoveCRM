import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import addReferralHandler from "../pages/api/affiliate/add-referral";
import affiliateTrackHandler from "../pages/api/affiliate-track";
import affiliateOnboardHandler from "../pages/api/affiliates/onboard";
import affiliateRegisterHandler from "../pages/api/affiliates/register";
import adminNumbersHandler from "../pages/api/admin/numbers";
import affiliatesAllHandler from "../pages/api/affiliates/all";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

jest.mock("next-auth/next", () => ({
  getServerSession: jest.fn(),
}));

jest.mock("../pages/api/auth/[...nextauth]", () => ({
  authOptions: {},
}));

jest.mock("@/lib/mongooseConnect", () => jest.fn());

jest.mock("@/models/User", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
  },
}));

jest.mock("@/models/Affiliate", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock("@/lib/stripe", () => ({
  stripe: {
    accounts: {
      create: jest.fn(),
    },
    accountLinks: {
      create: jest.fn(),
    },
    subscriptions: {
      retrieve: jest.fn(),
    },
  },
}));

jest.mock("@/lib/email", () => ({
  sendAffiliateApplicationAdminEmail: jest.fn(),
}));

function mockReqRes({
  method = "POST",
  body = {},
  query = {},
}: {
  method?: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
} = {}) {
  const req = {
    method,
    body,
    query,
    headers: {},
  } as unknown as NextApiRequest;

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
    end: jest.fn(function end(this: any, payload?: unknown) {
      this.body = payload;
      return this;
    }),
  } as unknown as NextApiResponse & { statusCode: number; body: unknown };

  return { req, res };
}

const mockedGetServerSession = getServerSession as jest.Mock;
const mockedDbConnect = dbConnect as jest.Mock;
const mockedUser = User as unknown as {
  findOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
  find: jest.Mock;
};

describe("P0 security remediations", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetServerSession.mockResolvedValue(null);
    mockedDbConnect.mockResolvedValue(undefined);
    process.env.ADMIN_EMAILS = "admin@example.com";
  });

  afterAll(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  test("affiliate add-referral rejects client-supplied amountPaid with 410", async () => {
    const { req, res } = mockReqRes({
      body: {
        promoCode: "ATTACK",
        referredEmail: "victim@example.com",
        amountPaid: 999999,
      },
    });

    await addReferralHandler(req, res);

    expect(res.statusCode).toBe(410);
  });

  test.each([
    ["affiliate-track", affiliateTrackHandler, "POST"],
    ["affiliates/onboard", affiliateOnboardHandler, "POST"],
    ["affiliates/register", affiliateRegisterHandler, "POST"],
    ["admin/numbers", adminNumbersHandler, "GET"],
    ["affiliates/all", affiliatesAllHandler, "GET"],
  ])("unauthenticated %s returns 401", async (_name, handler, method) => {
    const { req, res } = mockReqRes({ method });

    await handler(req, res);

    expect(res.statusCode).toBe(401);
  });

  test("authenticated non-admin cannot read admin numbers", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { email: "user@example.com", role: "admin" },
    });
    const { req, res } = mockReqRes({ method: "GET" });

    await adminNumbersHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(mockedUser.find).not.toHaveBeenCalled();
  });

  test("affiliate-track ignores body email and cannot set another user's referrer", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { email: "session-user@example.com" },
    });
    mockedUser.findOne.mockResolvedValue({ _id: "referrer" });
    mockedUser.findOneAndUpdate.mockResolvedValue({ _id: "session-user" });

    const { req, res } = mockReqRes({
      body: {
        email: "other-user@example.com",
        code: "REF123",
      },
    });

    await affiliateTrackHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockedUser.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ email: "session-user@example.com" }),
      expect.objectContaining({ referredBy: "REF123" }),
      { new: true },
    );
    expect(JSON.stringify(mockedUser.findOneAndUpdate.mock.calls[0][0])).not.toContain("other-user@example.com");
  });

  test("affiliate-track rejects users that already have a referrer", async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { email: "session-user@example.com" },
    });
    mockedUser.findOne.mockResolvedValue({ _id: "referrer" });
    mockedUser.findOneAndUpdate.mockResolvedValue(null);

    const { req, res } = mockReqRes({ body: { code: "REF123" } });

    await affiliateTrackHandler(req, res);

    expect(res.statusCode).toBe(409);
  });
});
