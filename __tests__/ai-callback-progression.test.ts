/** Real callback, signature validator, outcome transitions and worker; no network/DB. */
import twilio from "twilio";

const platformSid = `AC${"1".repeat(32)}`;
const tenantSid = `AC${"2".repeat(32)}`;
const otherSid = `AC${"3".repeat(32)}`;
const callA = `CA${"a".repeat(32)}`;
const callB = `CA${"b".repeat(32)}`;
const sid = "507f1f77bcf86cd799439011";
const leadA = "507f1f77bcf86cd799439012";
const leadB = "507f1f77bcf86cd799439013";
const email = "owner@example.test";
const stores: Record<string, any[]> = {};
let mutations: string[] = [];
let connected = false;
let beforeSessionUpdate: ((filter: any, change: any) => Promise<void>) | undefined;
const clone = (value: any): any => value == null ? value : structuredClone(value);
const get = (obj: any, path: string) => path.split(".").reduce((v, k) => v?.[k], obj);
function put(obj: any, path: string, value: any) {
  const keys = path.split(".");
  const leaf = keys.pop()!;
  for (const key of keys) obj = obj[key] ??= {};
  obj[leaf] = value;
}
function matches(doc: any, filter: any): boolean {
  return Object.entries(filter).every(([key, value]: [string, any]) => {
    if (key === "$or") return value.some((f: any) => matches(doc, f));
    if (key === "$and") return value.every((f: any) => matches(doc, f));
    const actual = get(doc, key);
    if (value && typeof value === "object" && !value._bsontype && !(value instanceof Date)) {
      return Object.entries(value).every(([op, expected]: [string, any]) => {
        if (op === "$exists") return (actual !== undefined) === expected;
        if (op === "$in") return expected.includes(actual);
        if (op === "$ne") return String(actual) !== String(expected);
        if (op === "$lt") return actual < expected;
        if (op === "$gt") return actual > expected;
        throw new Error(`Unsupported mock filter ${op}`);
      });
    }
    return value == null ? actual == null : String(actual) === String(value);
  });
}
function query(run: () => any): any {
  const q: any = { select: () => q, lean: () => q, exec: async () => run(),
    then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject) };
  return q;
}
function model(name: string): any {
  const read = (filter: any) => {
    if (!connected) throw new Error("DB lookup before connect");
    return stores[name].find(d => matches(d, filter));
  };
  function update(filter: any, change: any, options: any = {}, returnDoc = false) {
    let doc = read(filter);
    const before = clone(doc);
    if (!doc && options.upsert) {
      doc = { ...filter, ...change.$setOnInsert };
      stores[name].push(doc);
    }
    if (!doc) return returnDoc ? null : { modifiedCount: 0 };
    mutations.push(name);
    for (const [k, v] of Object.entries(change.$set || {})) put(doc, k, v);
    for (const [k, v] of Object.entries(change.$inc || {})) put(doc, k, (get(doc, k) || 0) + Number(v));
    for (const k of Object.keys(change.$unset || {})) delete doc[k];
    return returnDoc ? clone(options.new ? doc : before) : { modifiedCount: 1 };
  }
  return {
    findOne: jest.fn((f: any) => query(() => clone(read(f)) || null)),
    findById: jest.fn((id: any) => query(() => clone(read({ _id: id })) || null)),
    updateOne: jest.fn((f: any, u: any, o: any) => query(async () => {
      if (name === "sessions") await beforeSessionUpdate?.(f, u);
      return update(f, u, o);
    })),
    findOneAndUpdate: jest.fn((f: any, u: any, o: any) => query(() => update(f, u, o, true))),
  };
}

jest.mock("micro", () => ({ buffer: async (req: any) => Buffer.from(req.rawBody) }));
jest.mock("@/lib/mongooseConnect", () => ({ __esModule: true, default: jest.fn(async () => { connected = true; }) }));
jest.mock("@/models/AICallSession", () => ({ __esModule: true, default: model("sessions") }));
jest.mock("@/models/AICallRecording", () => ({ __esModule: true, default: model("recordings") }));
jest.mock("@/models/User", () => ({ __esModule: true, default: model("users") }));
jest.mock("@/models/Call", () => ({ __esModule: true, default: model("calls") }));
jest.mock("@/models/Lead", () => ({ __esModule: true, default: model("leads") }));
jest.mock("@/models/AICallUsageLedger", () => ({ __esModule: true, default: model("ledgers") }));
const accountFetch = jest.fn();
jest.mock("@/lib/twilio/getPlatformClient", () => ({
  getPlatformTwilioAuth: () => ({ mode: "authToken", accountSid: platformSid, authToken: "platform-token" }),
  getPlatformTwilioClient: () => ({ api: { v2010: { accounts: (id: string) => ({ fetch: () => accountFetch(id) }) } } }),
}));
const callsCreate = jest.fn();
const callsUpdate = jest.fn().mockResolvedValue({});
const callsFetch = jest.fn();
jest.mock("@/lib/twilio/getClientForUser", () => ({ getClientForUser: jest.fn(async () => ({
  client: { calls: Object.assign(() => ({ update: callsUpdate, fetch: callsFetch }), { create: callsCreate }) },
})) }));
jest.mock("@/lib/billing/trackAiDialerSessionUsage", () => ({ trackAiDialerSessionUsage: jest.fn() }));
jest.mock("@/lib/billing/checkCallingAllowed", () => ({ checkCallingAllowed: async () => ({ allowed: true }) }));
jest.mock("@/lib/featureFlags", () => ({ isAdmin: () => false }));
jest.mock("@/utils/checkCallTime", () => ({ isCallAllowedForLead: () => ({ allowed: true, zone: "UTC" }) }));
jest.mock("@/lib/twilio/localPresence", () => ({ selectLocalPresenceNumber: jest.fn() }));
jest.mock("@/lib/leads/foundationFields", () => ({ recordOutboundTouch: jest.fn() }));

let callback: any;
let worker: any;
let clearTokens: () => void;
let fetchMock: jest.Mock;
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
function response(): any {
  return { statusCode: 200, status(code: number) { this.statusCode = code; return this; },
    end(body: any) { this.body = body; return this; }, json(body: any) { this.body = body; return this; } };
}
function session() { return stores.sessions[0]; }
async function deliver(status = "completed", overrides: any = {}, hints: any = {}, token = "tenant-token", signature?: string) {
  const params = { AccountSid: tenantSid, CallSid: callA, CallStatus: status, ...overrides };
  const query = { userEmail: email, sessionId: sid, leadId: leadA, ...hints };
  for (const key of Object.keys(query)) if (query[key] == null) delete query[key];
  const url = `/api/ai-calls/call-status-webhook?${new URLSearchParams(query)}`;
  const res = response();
  await callback({ method: "POST", url, query, rawBody: new URLSearchParams(params).toString(),
    headers: { host: "www.covecrm.com", "x-forwarded-proto": "https",
      "x-twilio-signature": signature ?? twilio.getExpectedTwilioSignature(token, `https://www.covecrm.com${url}`, params) } }, res);
  return res;
}

beforeAll(async () => {
  process.env.TWILIO_ACCOUNT_SID = platformSid;
  process.env.CRON_SECRET = "local-test-cron";
  process.env.AI_DIALER_DISABLED = "false";
  process.env.TWILIO_FORCE_PLATFORM = "";
  process.env.NEXT_PUBLIC_BASE_URL = "https://www.covecrm.com";
  callback = (await import("@/pages/api/ai-calls/call-status-webhook")).default;
  worker = (await import("@/pages/api/ai-calls/worker")).default;
  clearTokens = (await import("@/lib/twilio/validateSubaccountWebhook")).clearWebhookTokenCacheForTests;
});
beforeEach(() => {
  jest.clearAllMocks();
  clearTokens();
  connected = false;
  mutations = [];
  beforeSessionUpdate = undefined;
  stores.sessions = [{ _id: sid, userEmail: email, leadIds: [leadA, leadB], total: 2, lastIndex: 0,
    status: "running", activeCallSid: callA, activeCallSidAt: new Date(), currentCall: { callSid: callA },
    fromNumber: "+15005550006", stats: { completed: 0 }, startedAt: null, chainKickCallSid: null, chainKickedAt: null }];
  stores.recordings = [{ _id: "recording-a", callSid: callA, userEmail: email, aiCallSessionId: sid,
    leadId: leadA, outcome: "unknown", createdAt: new Date(Date.now() - 30000) }];
  stores.users = [{ email, twilio: { accountSid: tenantSid }, billingMode: "platform", hasAI: true }];
  // Returning no old lead exercises outcome recording without unrelated lead-history writes.
  stores.leads = [{ _id: leadB, userEmail: email, phone: "+15005550007" }];
  stores.calls = [];
  stores.ledgers = [];
  accountFetch.mockImplementation(async (id: string) => {
    if (id !== tenantSid) throw new Error("Unknown account");
    return { ownerAccountSid: platformSid, authToken: "tenant-token" };
  });
  callsCreate.mockResolvedValue({ sid: callB });
  fetchMock = jest.fn(async (url: any) => {
    const res = response();
    await worker({ method: "POST", query: { sessionId: new URL(url).searchParams.get("sessionId") },
      headers: { authorization: "Bearer local-test-cron" } }, res);
    return { ok: res.statusCode === 200, status: res.statusCode, text: async () => JSON.stringify(res.body) };
  });
  global.fetch = fetchMock as any;
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => { global.fetch = originalFetch; process.env = originalEnv; });

function expectNextCall() {
  expect(session().status).toBe("running");
  expect(session().activeCallSid).toBe(callB);
  expect(session().currentCall).toBeNull();
  expect(session().lastIndex).toBe(1);
  expect(callsCreate).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
}

test.each(["completed", "no-answer", "busy", "failed", "canceled"])("%s progresses through the actual worker without End/Resume", async status => {
  expect((await deliver(status)).statusCode).toBe(200);
  expectNextCall();
  expect(accountFetch).toHaveBeenCalledWith(tenantSid);
  expect(stores.recordings[0].outcome).not.toBe("unknown");
});
test("platform-account callbacks still progress", async () => {
  stores.users[0].twilio = {};
  expect((await deliver("completed", { AccountSid: platformSid }, {}, "platform-token")).statusCode).toBe(200);
  expectNextCall();
  expect(accountFetch).not.toHaveBeenCalled();
});
test("self-billed stored-token configuration remains valid", async () => {
  stores.users[0].billingMode = "self";
  stores.users[0].twilio = { accountSid: otherSid, authToken: "personal-token" };
  expect((await deliver("completed", { AccountSid: otherSid }, {}, "personal-token")).statusCode).toBe(200);
  expectNextCall();
});
test("existing exact-account stored token remains valid during lookup failure", async () => {
  stores.users[0].twilio.authToken = "tenant-token";
  accountFetch.mockRejectedValue(new Error("Lookup unavailable"));
  expect((await deliver()).statusCode).toBe(200);
  expectNextCall();
});
test.each(["invalid", ""])("rejects invalid or missing signature (%s) without writes", async signature => {
  expect((await deliver("completed", {}, {}, "tenant-token", signature)).statusCode).toBe(403);
  expect(mutations).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(callsCreate).not.toHaveBeenCalled();
});
test("a parent-token signature cannot authenticate a subaccount callback", async () => {
  expect((await deliver("completed", {}, {}, "platform-token")).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test.each([otherSid, "invalid", ""])("rejects unknown/malformed AccountSid %s", async AccountSid => {
  expect((await deliver("completed", { AccountSid })).statusCode).toBe(403);
  expect(mutations).toEqual([]);
  expect(accountFetch).not.toHaveBeenCalled();
});
test("even a stored SID is rejected when provider lookup cannot establish trust", async () => {
  stores.users[0].twilio.accountSid = otherSid;
  expect((await deliver("completed", { AccountSid: otherSid })).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test("provider account owned by another platform is rejected", async () => {
  accountFetch.mockResolvedValue({ ownerAccountSid: otherSid, authToken: "tenant-token" });
  expect((await deliver()).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test("valid Customer A signature cannot change Customer B session", async () => {
  session().userEmail = "other@example.test";
  stores.users.push({ email: "other@example.test", twilio: { accountSid: otherSid } });
  expect((await deliver("completed", {}, { userEmail: "other@example.test" })).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test("consistent B ownership hints still cannot be signed by A", async () => {
  session().userEmail = "other@example.test";
  stores.recordings[0].userEmail = "other@example.test";
  stores.users.push({ email: "other@example.test", twilio: { accountSid: otherSid } });
  expect((await deliver("completed", {}, { userEmail: "other@example.test" })).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test("Customer A cannot overwrite Customer B recording even with A session hints", async () => {
  stores.recordings[0].userEmail = "other@example.test";
  expect((await deliver()).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test("Customer A cannot overwrite an existing Customer B Call", async () => {
  stores.calls.push({ callSid: callA, userEmail: "other@example.test", leadId: leadA });
  expect((await deliver()).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test("rejects conflicting session/lead hints", async () => {
  expect((await deliver("completed", {}, { leadId: leadB })).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test("initiated callback may arrive before recording insertion", async () => {
  stores.recordings = [];
  expect((await deliver("initiated")).statusCode).toBe(200);
  expect(stores.recordings[0].callSid).toBe(callA);
  expect(session().activeCallSid).toBe(callA);
  expect(fetchMock).not.toHaveBeenCalled();
});
test("new recording cannot name a lead outside the session queue", async () => {
  stores.recordings = [];
  expect((await deliver("initiated", {}, { leadId: "507f1f77bcf86cd799439099" })).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test("existing recording supplies omitted callback hints", async () => {
  expect((await deliver("completed", {}, { userEmail: null, sessionId: null, leadId: null })).statusCode).toBe(200);
  expectNextCall();
});
test("unknown session cannot authorize writes", async () => {
  stores.sessions = [];
  expect((await deliver()).statusCode).toBe(403);
  expect(mutations).toEqual([]);
});
test("database authentication failure fails closed without writes", async () => {
  const connect = (await import("@/lib/mongooseConnect")).default as jest.Mock;
  connect.mockRejectedValueOnce(new Error("DB unavailable"));
  expect((await deliver()).statusCode).toBe(503);
  expect(mutations).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});
test("repeated terminal callback does not advance twice", async () => {
  await deliver();
  const afterFirst = clone(session());
  await deliver();
  expectNextCall();
  expect(session().stats).toEqual(afterFirst.stats);
});
test("delayed Call A completion cannot clear active Call B", async () => {
  session().activeCallSid = callB;
  session().currentCall = { callSid: callB };
  const activeAt = session().activeCallSidAt;
  expect((await deliver()).statusCode).toBe(200);
  expect(session().activeCallSid).toBe(callB);
  expect(session().activeCallSidAt).toEqual(activeAt);
  expect(session().currentCall).toEqual({ callSid: callB });
  expect(callsCreate).not.toHaveBeenCalled();
});
test("duplicate A callback delayed during cleanup cannot erase B placed by the first callback", async () => {
  let release!: () => void;
  let reached!: () => void;
  const blocked = new Promise<void>(r => { release = r; });
  const ready = new Promise<void>(r => { reached = r; });
  let intercepted = false;
  beforeSessionUpdate = async (_filter, change) => {
    if (change.$set?.activeCallSid === null && !intercepted) {
      intercepted = true;
      reached();
      await blocked;
    }
  };
  const delayed = deliver();
  await ready;
  await deliver();
  expect(session().activeCallSid).toBe(callB);
  release();
  await delayed;
  expect(session().activeCallSid).toBe(callB);
  expect(callsCreate).toHaveBeenCalledTimes(1);
  expect(session().lastIndex).toBe(1);
});
test("AMD fast-skip plus terminal callback progresses only once", async () => {
  await deliver("in-progress", { AnsweredBy: "machine_end_beep" });
  expect(callsUpdate).toHaveBeenCalledTimes(1);
  expect(callsCreate).not.toHaveBeenCalled();
  await deliver();
  await deliver();
  expect(session().activeCallSid).toBe(callB);
  expect(session().lastIndex).toBe(1);
  expect(callsCreate).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(2); // Existing AMD kick is guarded while A is active.
});
test("duplicate simultaneous terminal callbacks do not place concurrent calls", async () => {
  await Promise.all([deliver(), deliver()]);
  expect(session().activeCallSid).toBe(callB);
  expect(session().lastIndex).toBe(1);
  expect(callsCreate).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test.each(["stopped", "paused"])("callback preserves %s session without dialing", async status => {
  session().status = status;
  expect((await deliver()).statusCode).toBe(200);
  expect(session().status).toBe(status);
  expect(session().activeCallSid).toBeNull();
  expect(callsCreate).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
