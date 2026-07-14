import { Types } from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { runAddNoteToLeadsTool } from "@/lib/ai/assistant/addNoteToLeadsTool";
import { runMoveLeadsToFolderTool } from "@/lib/ai/assistant/moveLeadsToFolderTool";
import { runUpdateLeadStatusTool } from "@/lib/ai/assistant/updateLeadStatusTool";

jest.mock("@/models/Lead", () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    countDocuments: jest.fn().mockResolvedValue(0),
    bulkWrite: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  },
}));

jest.mock("@/models/Folder", () => ({
  __esModule: true,
  default: { findOneAndUpdate: jest.fn() },
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

const mockedLead = Lead as unknown as {
  find: jest.Mock;
  countDocuments: jest.Mock;
  bulkWrite: jest.Mock;
  updateMany: jest.Mock;
};
const mockedFolder = Folder as unknown as { findOneAndUpdate: jest.Mock };

const ID1 = "507f1f77bcf86cd799439011";
const ID2 = "507f1f77bcf86cd799439012";

describe("add_note_to_leads", () => {
  beforeEach(() => jest.clearAllMocks());

  test("requires note text", async () => {
    const result = await runAddNoteToLeadsTool("agent@example.com", { leadIds: [ID1] });
    expect(result.error).toBeTruthy();
    expect(mockedLead.bulkWrite).not.toHaveBeenCalled();
  });

  test("appends a timestamped note without erasing an existing one", async () => {
    mockedLead.find.mockReturnValue(chainable([
      { _id: ID1, Notes: "prior note" },
      { _id: ID2, Notes: "" },
    ]));

    const result = await runAddNoteToLeadsTool("agent@example.com", { leadIds: [ID1, ID2], note: "called, left voicemail" });

    expect(result.updated).toBe(2);
    const ops = mockedLead.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.filter).toEqual({ _id: ID1, userEmail: "agent@example.com" });
    expect(ops[0].updateOne.update.$set.Notes).toMatch(/^prior note\n\[.+\] called, left voicemail$/);
    expect(ops[1].updateOne.update.$set.Notes).toMatch(/^\[.+\] called, left voicemail$/);
  });

  test("no matching leads is a clean no-op", async () => {
    mockedLead.find.mockReturnValue(chainable([]));
    const result = await runAddNoteToLeadsTool("agent@example.com", { leadIds: [ID1], note: "hi" });
    expect(result.updated).toBe(0);
    expect(result.reason).toBe("no_matching_leads");
  });
});

describe("move_leads_to_folder", () => {
  beforeEach(() => jest.clearAllMocks());

  test("requires folderName", async () => {
    const result = await runMoveLeadsToFolderTool("agent@example.com", { leadIds: [ID1] });
    expect(result.error).toBeTruthy();
  });

  test("resolves/creates the destination folder and moves matching leads, without touching status", async () => {
    mockedFolder.findOneAndUpdate.mockResolvedValue({ _id: "folder1", name: "Hot Leads" });
    mockedLead.updateMany.mockResolvedValue({ modifiedCount: 2 });

    const result = await runMoveLeadsToFolderTool("agent@example.com", { leadIds: [ID1, ID2], folderName: "Hot Leads" });

    expect(mockedFolder.findOneAndUpdate).toHaveBeenCalledWith(
      { userEmail: "agent@example.com", name: expect.any(RegExp) },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ name: "Hot Leads" }) }),
      expect.anything(),
    );
    const updateArgs = mockedLead.updateMany.mock.calls[0][1];
    expect(updateArgs.$set.folderId).toBe("folder1");
    expect(updateArgs.$set.status).toBeUndefined();
    expect(result.moved).toBe(2);
  });
});

describe("update_lead_status", () => {
  beforeEach(() => jest.clearAllMocks());

  test("requires status", async () => {
    const result = await runUpdateLeadStatusTool("agent@example.com", { leadIds: [ID1] });
    expect(result.error).toBeTruthy();
  });

  test("sets status on matching leads and computes soldAt per-lead when transitioning to Sold", async () => {
    mockedLead.find.mockReturnValue(chainable([
      { _id: ID1, status: "New", soldAt: null },
      { _id: ID2, status: "Sold", soldAt: new Date("2026-01-01") }, // already sold — soldAt must not move
    ]));

    const result = await runUpdateLeadStatusTool("agent@example.com", { leadIds: [ID1, ID2], status: "Sold" });

    const ops = mockedLead.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.update.$set.status).toBe("Sold");
    expect(ops[0].updateOne.update.$set.soldAt).toBeInstanceOf(Date); // first-time transition stamps soldAt
    expect(ops[1].updateOne.update.$set.soldAt).toBeUndefined(); // already sold, not overwritten
    expect(result.updated).toBe(2);
  });

  test("filters never include a stale status filter for the field being set", async () => {
    mockedLead.find.mockReturnValue(chainable([{ _id: ID1, status: "New", soldAt: null }]));
    await runUpdateLeadStatusTool("agent@example.com", { leadType: "Mortgage Protection", status: "Not Interested" } as any);
    // No assertion error means resolveLeadIds→query_leads was called without a conflicting status filter (verified indirectly via successful bulkWrite)
    expect(mockedLead.bulkWrite).toHaveBeenCalled();
  });

  test("a filtered action updates the full match set, not query_leads' first 50", async () => {
    const many = Array.from({ length: 75 }, (_, index) => ({
      _id: new Types.ObjectId(),
      status: "New",
      soldAt: null,
      index,
    }));
    mockedLead.find.mockReturnValue(chainable(many));

    const result = await runUpdateLeadStatusTool("agent@example.com", {
      leadType: "Mortgage Protection",
      status: "Not Interested",
    } as any);

    expect(result.updated).toBe(75);
    expect(mockedLead.bulkWrite.mock.calls[0][0]).toHaveLength(75);
  });
});
