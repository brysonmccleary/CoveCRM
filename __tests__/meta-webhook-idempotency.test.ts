import { processMetaLead } from "@/lib/meta/processMetaLead";
import MetaLeadWebhookEvent from "@/models/MetaLeadWebhookEvent";
import Lead from "@/lib/mongo/leads";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FBLeadEntry from "@/models/FBLeadEntry";
import User from "@/models/User";
import Folder from "@/models/Folder";
import { retrieveMetaLead } from "@/lib/meta/retrieveLead";
import { triggerAIFirstCall } from "@/lib/ai/triggerAIFirstCall";
import { scoreLeadOnArrival } from "@/lib/leads/scoreLead";
import { checkDuplicate } from "@/lib/leads/checkDuplicate";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";

jest.mock("@/lib/mongooseConnect", () => jest.fn());

jest.mock("@/lib/meta/retrieveLead", () => ({ retrieveMetaLead: jest.fn() }));
jest.mock("@/lib/leads/scoreLead", () => ({ scoreLeadOnArrival: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/leads/checkDuplicate", () => ({ checkDuplicate: jest.fn() }));
jest.mock("@/lib/ai/triggerAIFirstCall", () => ({ triggerAIFirstCall: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/drips/enrollOnNewLead", () => ({ enrollOnNewLeadIfWatched: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/email", () => ({ sendNewLeadNotificationEmail: jest.fn().mockResolvedValue({ ok: true }) }));

jest.mock("@/models/MetaLeadWebhookEvent", () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findOne: jest.fn() },
}));
jest.mock("@/lib/mongo/leads", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() },
}));
jest.mock("@/models/FBLeadCampaign", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn() },
}));
jest.mock("@/models/FBLeadEntry", () => ({
  __esModule: true,
  default: { create: jest.fn(), updateOne: jest.fn() },
}));
jest.mock("@/models/User", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn() },
}));
jest.mock("@/models/Folder", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() },
}));

const mockedEvent = MetaLeadWebhookEvent as unknown as {
  findOneAndUpdate: jest.Mock;
  updateOne: jest.Mock;
  findOne: jest.Mock;
};
const mockedLead = Lead as unknown as { findOne: jest.Mock; create: jest.Mock };
const mockedCampaign = FBLeadCampaign as unknown as { findOne: jest.Mock; updateOne: jest.Mock };
const mockedEntry = FBLeadEntry as unknown as { create: jest.Mock; updateOne: jest.Mock };
const mockedUser = User as unknown as { findOne: jest.Mock; updateOne: jest.Mock };
const mockedFolder = Folder as unknown as { findOne: jest.Mock; create: jest.Mock; updateOne: jest.Mock };
const mockedRetrieve = retrieveMetaLead as jest.Mock;
const mockedTriggerAIFirstCall = triggerAIFirstCall as jest.Mock;
const mockedCheckDuplicate = checkDuplicate as jest.Mock;

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

/** Simulates real MongoDB atomicity for the { $nin: [...] } claim guard. */
function statefulEventStore(initialStatus = "received") {
  const doc: any = { leadgenId: "LG1", processingStatus: initialStatus, attemptCount: 0 };
  const activeOrDone = new Set(["processing", "processed", "duplicate"]);

  mockedEvent.findOneAndUpdate.mockImplementation(async (filter: any) => {
    if (activeOrDone.has(doc.processingStatus)) return null; // mirrors: filter no longer matches
    doc.processingStatus = "processing";
    doc.attemptCount += 1;
    return { ...doc };
  });
  mockedEvent.updateOne.mockImplementation(async (_filter: any, update: any) => {
    if (update.$set?.processingStatus) doc.processingStatus = update.$set.processingStatus;
    return { acknowledged: true };
  });

  return doc;
}

describe("Meta webhook lead-creation idempotency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCampaign.findOne.mockReturnValue(lean({
      _id: "camp1",
      userEmail: "agent@example.com",
      leadType: "final_expense",
      audienceSegment: "standard",
      folderId: "folder1",
    }));
    mockedUser.findOne.mockReturnValue(lean({ _id: "user1", email: "agent@example.com" }));
    mockedRetrieve.mockResolvedValue({
      firstName: "Jane",
      lastName: "Doe",
      phone: "+18085551212",
      email: "jane@example.com",
      state: "HI",
      rawFieldData: [],
      rawPayload: {},
    });
    mockedCheckDuplicate.mockResolvedValue({ isDuplicate: false });
    mockedFolder.findOne.mockReturnValue(lean({ _id: "folder1", aiScriptKey: "final_expense" }));
    mockedEntry.create.mockResolvedValue({ _id: "entry1" });
    mockedLead.findOne.mockReturnValue(lean(null)); // no pre-existing CRM lead
    mockedLead.create.mockResolvedValue({ _id: "lead1" });
  });

  test("two concurrent deliveries of the same leadgen event create exactly one Lead and fire the AI first-call flow exactly once", async () => {
    statefulEventStore("received");

    await Promise.all([
      processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now()),
      processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now()),
    ]);

    expect(mockedLead.create).toHaveBeenCalledTimes(1);
    expect(mockedTriggerAIFirstCall).toHaveBeenCalledTimes(1);
  });

  test("a redelivery after the event is already fully processed is skipped entirely", async () => {
    statefulEventStore("processed");

    await processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now());

    expect(mockedRetrieve).not.toHaveBeenCalled();
    expect(mockedLead.create).not.toHaveBeenCalled();
    expect(mockedTriggerAIFirstCall).not.toHaveBeenCalled();
  });

  test("a redelivery already marked duplicate is skipped entirely", async () => {
    statefulEventStore("duplicate");

    await processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now());

    expect(mockedLead.create).not.toHaveBeenCalled();
  });

  test("a retryable failure can still be re-claimed and processed on the next attempt", async () => {
    statefulEventStore("failed_retryable");

    await processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now());

    expect(mockedLead.create).toHaveBeenCalledTimes(1);
  });

  test("if the atomic claim write itself throws, processing aborts rather than proceeding unguarded", async () => {
    mockedEvent.findOneAndUpdate.mockRejectedValue(new Error("mongo down"));

    await processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now());

    expect(mockedLead.create).not.toHaveBeenCalled();
    expect(mockedTriggerAIFirstCall).not.toHaveBeenCalled();
  });
});
