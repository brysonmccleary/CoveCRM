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
import { sendNewLeadNotificationEmail, sendRepeatOptInNotificationEmail } from "@/lib/email";

jest.mock("@/lib/mongooseConnect", () => jest.fn());

jest.mock("@/lib/meta/retrieveLead", () => ({ retrieveMetaLead: jest.fn() }));
jest.mock("@/lib/leads/scoreLead", () => ({ scoreLeadOnArrival: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/leads/checkDuplicate", () => ({ checkDuplicate: jest.fn() }));
jest.mock("@/lib/ai/triggerAIFirstCall", () => ({ triggerAIFirstCall: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/drips/enrollOnNewLead", () => ({ enrollOnNewLeadIfWatched: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/email", () => ({
  sendNewLeadNotificationEmail: jest.fn().mockResolvedValue({ ok: true }),
  sendRepeatOptInNotificationEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

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
const mockedNewLeadEmail = sendNewLeadNotificationEmail as jest.Mock;
const mockedRepeatOptInEmail = sendRepeatOptInNotificationEmail as jest.Mock;

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
  mockedEvent.findOne.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockImplementation(async () => ({ ...doc })),
    }),
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
      licensedStates: ["AZ"],
    }));
    mockedUser.findOne.mockReturnValue(lean({
      _id: "user1",
      email: "agent@example.com",
      metaPageAccessToken: "page-token",
      metaSystemUserToken: "system-token",
      metaAccessToken: "person-token",
    }));
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
    expect(mockedRetrieve).toHaveBeenCalledTimes(1);
    expect(mockedNewLeadEmail).toHaveBeenCalledTimes(1);
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

  test("retrieves a native lead with the Page token first", async () => {
    statefulEventStore("received");

    await processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now());

    expect(mockedRetrieve).toHaveBeenCalledWith("LG1", "page-token");
  });

  test("a native Meta lead outside licensed geography is still created and flagged", async () => {
    statefulEventStore("received");
    await processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now());
    expect(mockedLead.create).toHaveBeenCalledWith(expect.objectContaining({
      State: "HI",
      stateRestrictionWarning: true,
      stateOutsidePrimaryLicensedArea: true,
    }));
  });

  test("maps the veteran native DOB field without requiring the removed age-range or qualification fields", async () => {
    statefulEventStore("received");
    mockedCampaign.findOne.mockReturnValue(lean({
      _id: "camp1", userEmail: "agent@example.com", leadType: "veteran",
      audienceSegment: "veteran", folderId: "folder1", licensedStates: ["AZ"],
    }));
    mockedRetrieve.mockResolvedValue({
      firstName: "Jane", lastName: "Doe", phone: "+18085551212", email: "jane@example.com",
      state: "AZ", formId: "form1", createdTime: "2026-08-30T12:00:00Z",
      rawFieldData: [
        { name: "date_of_birth", values: ["1965-06-15"] },
        { name: "who_needs_coverage", values: ["Veteran"] },
        { name: "coverage_amount", values: ["$25,000-$49,999"] },
      ],
      customDisclaimerResponses: [{ checkbox_key: "covecrm_contact_consent", is_checked: true }],
      rawPayload: {},
    });

    await processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now());

    expect(mockedLead.create).toHaveBeenCalledWith(expect.objectContaining({
      DOB: "1965-06-15",
      "Who Needs Coverage": "Veteran",
      "Requested Coverage": "$25,000-$49,999",
      "Coverage Amount": "$25,000-$49,999",
      metaConsent: expect.objectContaining({
        source: "meta_instant_form",
        responses: [{ checkbox_key: "covecrm_contact_consent", is_checked: true }],
      }),
    }));
    const created = mockedLead.create.mock.calls[0][0];
    expect(created.Age).toBeUndefined();
    expect(created).not.toHaveProperty("Military Branch");
    expect(created).not.toHaveProperty("Marital Status");
    expect(created).not.toHaveProperty("Best Time To Call");
    expect(created).not.toHaveProperty("Health Issues");
  });

  test("a new opt-in from an existing contact emails the agent and links the event without creating another CRM lead", async () => {
    statefulEventStore("received");
    mockedCheckDuplicate.mockResolvedValue({
      isDuplicate: true,
      matchType: "both",
      existingLeadId: "existing-lead-1",
      existingName: "Jane Doe",
    });

    await processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now());

    expect(mockedLead.create).not.toHaveBeenCalled();
    expect(mockedRepeatOptInEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "agent@example.com",
      leadName: "Jane Doe",
      leadUrl: expect.stringContaining("/lead/existing-lead-1"),
    }));
    expect(mockedEntry.updateOne).toHaveBeenCalledWith(
      { _id: "entry1" },
      { $set: { crmLeadId: "existing-lead-1" } }
    );
    expect(mockedEvent.updateOne).toHaveBeenCalledWith(
      { leadgenId: "LG1" },
      expect.objectContaining({ $set: expect.objectContaining({ processingStatus: "duplicate" }) })
    );
  });

  test("a missing persisted event is reported as a prerequisite failure, not as already processed", async () => {
    mockedEvent.findOneAndUpdate.mockResolvedValue(null);
    mockedEvent.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue(lean(null)),
    });

    await expect(
      processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now())
    ).rejects.toThrow(/no durably persisted webhook event/i);

    expect(mockedRetrieve).not.toHaveBeenCalled();
    expect(mockedLead.create).not.toHaveBeenCalled();
    expect(mockedNewLeadEmail).not.toHaveBeenCalled();
  });

  test("if the atomic claim write itself throws, processing fails rather than proceeding unguarded", async () => {
    mockedEvent.findOneAndUpdate.mockRejectedValue(new Error("mongo down"));

    await expect(
      processMetaLead("LG1", "page1", "form1", "ad1", "adset1", "camp1", Date.now())
    ).rejects.toThrow("mongo down");

    expect(mockedLead.create).not.toHaveBeenCalled();
    expect(mockedNewLeadEmail).not.toHaveBeenCalled();
    expect(mockedTriggerAIFirstCall).not.toHaveBeenCalled();
  });
});
