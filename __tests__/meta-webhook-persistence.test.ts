import { Readable } from "stream";
import { createHmac } from "crypto";

const APP_SECRET = "meta-webhook-test-secret";

jest.mock("@/lib/mongooseConnect", () => jest.fn().mockResolvedValue(undefined));
jest.mock("@/lib/meta/processMetaLead", () => ({ processMetaLead: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/models/MetaLeadWebhookEvent", () => ({
  __esModule: true,
  default: { updateOne: jest.fn() },
}));

function requestFor(body: string) {
  const request = Readable.from([Buffer.from(body)]) as any;
  request.method = "POST";
  request.query = {};
  request.headers = {
    "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`,
  };
  return request;
}

function responseMock() {
  const response: any = {};
  response.status = jest.fn().mockReturnValue(response);
  response.json = jest.fn().mockReturnValue(response);
  response.send = jest.fn().mockReturnValue(response);
  return response;
}

const payload = JSON.stringify({
  object: "page",
  entry: [{
    id: "page1",
    changes: [{
      field: "leadgen",
      value: {
        leadgen_id: "LG1",
        page_id: "page1",
        form_id: "form1",
        ad_id: "ad1",
        adset_id: "adset1",
        campaign_id: "camp1",
        created_time: 1_788_300_000,
      },
    }],
  }],
});

describe("Meta webhook durable persistence", () => {
  let handler: any;
  let mockedEvent: { updateOne: jest.Mock };
  let mockedProcess: jest.Mock;

  beforeAll(() => {
    process.env.META_APP_SECRET = APP_SECRET;
    jest.isolateModules(() => {
      handler = require("@/pages/api/meta/webhook").default;
      mockedEvent = require("@/models/MetaLeadWebhookEvent").default;
      mockedProcess = require("@/lib/meta/processMetaLead").processMetaLead;
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedEvent.updateOne.mockResolvedValue({ acknowledged: true, upsertedCount: 1 });
    mockedProcess.mockResolvedValue(undefined);
  });

  it("persists a first delivery without conflicting deliveryCount operators and then ACKs", async () => {
    const response = responseMock();
    await handler(requestFor(payload), response);

    expect(mockedEvent.updateOne).toHaveBeenCalledWith(
      { leadgenId: "LG1" },
      expect.objectContaining({
        $setOnInsert: expect.not.objectContaining({ deliveryCount: expect.anything() }),
        $inc: { deliveryCount: 1 },
      }),
      { upsert: true }
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(mockedProcess).toHaveBeenCalledTimes(1);
  });

  it("persists duplicate deliveries and increments their delivery count", async () => {
    await handler(requestFor(payload), responseMock());
    await handler(requestFor(payload), responseMock());

    expect(mockedEvent.updateOne).toHaveBeenCalledTimes(2);
    expect(mockedEvent.updateOne.mock.calls[0][1].$inc).toEqual({ deliveryCount: 1 });
    expect(mockedEvent.updateOne.mock.calls[1][1].$inc).toEqual({ deliveryCount: 1 });
  });

  it("returns a retryable failure and does not process when event persistence fails", async () => {
    mockedEvent.updateOne.mockRejectedValueOnce(new Error("mongo unavailable"));
    const response = responseMock();

    await handler(requestFor(payload), response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({ ok: false, error: "event_persistence_failed" });
    expect(mockedProcess).not.toHaveBeenCalled();
  });
});
