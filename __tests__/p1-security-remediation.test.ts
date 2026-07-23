import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import checkoutSessionHandler from "../pages/api/checkout-session";
import deleteNumberHandler from "../pages/api/deleteNumber";
import twilioTokenHandler from "../pages/api/twilio/token";
import getLeadsByIdsHandler from "../pages/api/get-leads-by-ids";
import transcriptHandler from "../pages/api/leads/transcript";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import BillingMeterHealth from "@/models/BillingMeterHealth";
import twilioClient from "@/lib/twilioClient";

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
  },
}));

jest.mock("@/models/Lead", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock("@/models/BillingMeterHealth", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock("@/lib/twilioClient", () => ({
  __esModule: true,
  default: {
    incomingPhoneNumbers: jest.fn(),
  },
}));

jest.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: jest.fn(),
      },
    },
  },
}));

function mockReqRes({
  method = "POST",
  body = {},
  query = {},
  headers = {},
}: {
  method?: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
} = {}) {
  const req = {
    method,
    body,
    query,
    headers,
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
    setHeader: jest.fn(),
  } as unknown as NextApiResponse & { statusCode: number; body: unknown };

  return { req, res };
}

const mockedGetServerSession = getServerSession as jest.Mock;
const mockedDbConnect = dbConnect as jest.Mock;
const mockedUser = User as unknown as { findOne: jest.Mock };
const mockedLead = Lead as unknown as { findOne: jest.Mock };
const mockedBillingMeterHealth = BillingMeterHealth as unknown as {
  findOne: jest.Mock;
};
const mockedTwilioClient = twilioClient as unknown as {
  incomingPhoneNumbers: jest.Mock;
};

describe("P1 security remediations", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetServerSession.mockResolvedValue(null);
    mockedDbConnect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ---------------------------------------------------------------------
  // 1) checkout-session.ts — price must come from server, never the body
  // ---------------------------------------------------------------------
  describe("checkout-session.ts", () => {
    test("unauthenticated request returns 401", async () => {
      const { req, res } = mockReqRes({ body: { email: "x@x.com", price: 0.01 } });
      await checkoutSessionHandler(req, res);
      expect(res.statusCode).toBe(401);
    });

    test("authenticated request ignores client-supplied price and uses the fixed server-side price ID", async () => {
      process.env.STRIPE_PRICE_ID_MONTHLY = "price_real_monthly";
      mockedGetServerSession.mockResolvedValue({
        user: { email: "agent@example.com" },
      });

      const { stripe } = require("@/lib/stripe");
      stripe.checkout.sessions.create.mockResolvedValue({ url: "https://stripe.test/session" });

      const { req, res } = mockReqRes({
        headers: { origin: "https://app.test" },
        body: { email: "attacker-controlled@example.com", price: 0.01 },
      });

      await checkoutSessionHandler(req, res);

      expect(res.statusCode).toBe(200);
      const callArgs = stripe.checkout.sessions.create.mock.calls[0][0];
      // Price must be the fixed price ID, never derived from the body
      expect(callArgs.line_items[0].price).toBe("price_real_monthly");
      expect(callArgs.line_items[0].price_data).toBeUndefined();
      // Customer email must be the session's own email, not an attacker-supplied one
      expect(callArgs.customer_email).toBe("agent@example.com");
    });
  });

  // ---------------------------------------------------------------------
  // 2) deleteNumber.ts — auth + ownership required before releasing a number
  // ---------------------------------------------------------------------
  describe("deleteNumber.ts", () => {
    test("unauthenticated request returns 401", async () => {
      const { req, res } = mockReqRes({ method: "DELETE", body: { sid: "PNxxx" } });
      await deleteNumberHandler(req, res);
      expect(res.statusCode).toBe(401);
    });

    test("authenticated request for a SID not owned by the caller returns 403 and never calls Twilio", async () => {
      mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
      mockedUser.findOne.mockResolvedValue({
        numbers: [{ sid: "PN_belongs_to_someone_else" }],
        save: jest.fn(),
      });

      const { req, res } = mockReqRes({ method: "DELETE", body: { sid: "PN_victim_number" } });
      await deleteNumberHandler(req, res);

      expect(res.statusCode).toBe(403);
      expect(mockedTwilioClient.incomingPhoneNumbers).not.toHaveBeenCalled();
    });

    test("authenticated request for the caller's own number succeeds", async () => {
      mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
      const save = jest.fn().mockResolvedValue(undefined);
      const userDoc: any = {
        numbers: [{ sid: "PN_owned_by_agent" }],
        save,
      };
      mockedUser.findOne.mockResolvedValue(userDoc);
      const remove = jest.fn().mockResolvedValue(undefined);
      mockedTwilioClient.incomingPhoneNumbers.mockReturnValue({ remove });

      const { req, res } = mockReqRes({ method: "DELETE", body: { sid: "PN_owned_by_agent" } });
      await deleteNumberHandler(req, res);

      expect(mockedTwilioClient.incomingPhoneNumbers).toHaveBeenCalledWith("PN_owned_by_agent");
      expect(remove).toHaveBeenCalled();
      expect(userDoc.numbers).toEqual([]);
      expect(save).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // 3) twilio/token.ts — auth required, identity scoped to the caller
  // ---------------------------------------------------------------------
  describe("twilio/token.ts", () => {
    beforeEach(() => {
      process.env.TWILIO_ACCOUNT_SID = "AC" + "0".repeat(32);
      process.env.TWILIO_API_KEY_SID = "SK" + "0".repeat(32);
      process.env.TWILIO_API_KEY_SECRET = "test_api_key_secret";
      process.env.TWILIO_APP_SID = "AP" + "0".repeat(32);
    });

    test("unauthenticated request returns 401 and issues no token", async () => {
      const { req, res } = mockReqRes({ method: "GET" });
      await twilioTokenHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect((res as any).body?.token).toBeUndefined();
    });

    test("authenticated request issues a token scoped to the caller's own identity", async () => {
      mockedGetServerSession.mockResolvedValue({ user: { email: "Agent@Example.com" } });
      const accountSid = "AC" + "1".repeat(32);
      const userLean = jest.fn().mockResolvedValue({
        email: "agent@example.com",
        hasEverPaid: true,
        billingMode: "platform",
        role: "member",
        twilio: { accountSid },
      });
      const userSelect = jest.fn().mockReturnValue({ lean: userLean });
      mockedUser.findOne.mockReturnValue({ select: userSelect });

      const healthLean = jest.fn().mockResolvedValue({
        status: "healthy",
        lastSucceededAt: new Date(),
        lastError: null,
      });
      const healthSelect = jest.fn().mockReturnValue({ lean: healthLean });
      mockedBillingMeterHealth.findOne.mockReturnValue({ select: healthSelect });
      const { req, res } = mockReqRes({ method: "GET" });

      await twilioTokenHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(mockedUser.findOne).toHaveBeenCalledWith({ email: "agent@example.com" });
      expect(userSelect).toHaveBeenCalled();
      expect(mockedBillingMeterHealth.findOne).toHaveBeenCalledWith({ accountSid });
      const body = (res as any).body;
      expect(body.identity).toBe("agent@example.com");
      expect(typeof body.token).toBe("string");
      expect(body.token.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------
  // 4) get-leads-by-ids.ts — auth + tenant scoping required
  // ---------------------------------------------------------------------
  describe("get-leads-by-ids.ts", () => {
    const VALID_ID = "507f1f77bcf86cd799439011";

    test("unauthenticated request returns 401", async () => {
      const { req, res } = mockReqRes({ method: "GET", query: { id: VALID_ID } });
      await getLeadsByIdsHandler(req, res);
      expect(res.statusCode).toBe(401);
    });

    test("authenticated request for another tenant's lead returns 404 (not the lead data)", async () => {
      mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
      // Simulates the DB correctly scoping by userEmail and finding nothing
      mockedLead.findOne.mockResolvedValue(null);

      const { req, res } = mockReqRes({ method: "GET", query: { id: VALID_ID } });
      await getLeadsByIdsHandler(req, res);

      expect(mockedLead.findOne).toHaveBeenCalledWith({ _id: VALID_ID, userEmail: "agent@example.com" });
      expect(res.statusCode).toBe(404);
    });

    test("authenticated request for the caller's own lead returns it", async () => {
      mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
      mockedLead.findOne.mockResolvedValue({ _id: VALID_ID, userEmail: "agent@example.com", name: "Jane" });

      const { req, res } = mockReqRes({ method: "GET", query: { id: VALID_ID } });
      await getLeadsByIdsHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect((res as any).body.lead.name).toBe("Jane");
    });
  });

  // ---------------------------------------------------------------------
  // 5) leads/transcript.ts — auth + tenant scoping required
  // ---------------------------------------------------------------------
  describe("leads/transcript.ts", () => {
    test("unauthenticated request returns 401 and never touches the DB", async () => {
      const { req, res } = mockReqRes({
        body: { leadId: "507f1f77bcf86cd799439011", entry: { text: "hi" } },
      });
      await transcriptHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(mockedLead.findOne).not.toHaveBeenCalled();
    });

    test("authenticated request for another tenant's lead returns 404 and writes nothing", async () => {
      mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
      mockedLead.findOne.mockResolvedValue(null);

      const { req, res } = mockReqRes({
        body: { leadId: "507f1f77bcf86cd799439011", entry: { text: "attacker text" } },
      });
      await transcriptHandler(req, res);

      expect(mockedLead.findOne).toHaveBeenCalledWith({
        _id: "507f1f77bcf86cd799439011",
        userEmail: "agent@example.com",
      });
      expect(res.statusCode).toBe(404);
    });

    test("authenticated request for the caller's own lead appends the transcript", async () => {
      mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
      const save = jest.fn().mockResolvedValue(undefined);
      const leadDoc: any = { callTranscripts: [], save };
      mockedLead.findOne.mockResolvedValue(leadDoc);

      const { req, res } = mockReqRes({
        body: { leadId: "507f1f77bcf86cd799439011", entry: { text: "legit note" } },
      });
      await transcriptHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(leadDoc.callTranscripts).toEqual([{ text: "legit note" }]);
      expect(save).toHaveBeenCalled();
    });
  });
});
