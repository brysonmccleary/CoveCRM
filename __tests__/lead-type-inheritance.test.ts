import { Types } from "mongoose";
import Lead, {
  createLeadsFromCSV,
  createLeadsFromGoogleSheet,
  sanitizeLeadType,
  resolveLeadTypeForImport,
} from "@/lib/mongo/leads";
import Folder from "@/models/Folder";
import { ingestVendorLead } from "@/lib/leads/ingestVendorLead";
import { LEAD_TYPES } from "@/lib/leads/leadTypes";

jest.mock("@/lib/drips/enrollOnNewLead", () => ({ enrollOnNewLeadIfWatched: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/ai/triggerAIFirstCall", () => ({ triggerAIFirstCall: jest.fn().mockResolvedValue(undefined) }));

function folderLean(value: unknown) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) };
}

describe("sanitizeLeadType", () => {
  test("covers every canonical lead type, including Trucker", () => {
    expect(sanitizeLeadType("veteran")).toBe("Veteran");
    expect(sanitizeLeadType("vet")).toBe("Veteran");
    expect(sanitizeLeadType("mortgage protection")).toBe("Mortgage Protection");
    expect(sanitizeLeadType("mortgage")).toBe("Mortgage Protection");
    expect(sanitizeLeadType("mtg")).toBe("Mortgage Protection");
    expect(sanitizeLeadType("FE")).toBe("Final Expense");
    expect(sanitizeLeadType("fex")).toBe("Final Expense");
    expect(sanitizeLeadType("IUL")).toBe("IUL");
    expect(sanitizeLeadType("Trucker")).toBe("Trucker");
    expect(sanitizeLeadType("truck driver")).toBe("Trucker");
    expect(sanitizeLeadType("cdl")).toBe("Trucker");
    expect(sanitizeLeadType("truck")).toBe("Trucker");
    expect(sanitizeLeadType("something unrecognized")).toBe("Final Expense");
    expect(sanitizeLeadType("")).toBe("Final Expense");
  });

  test("every canonical LEAD_TYPES value round-trips through sanitizeLeadType", () => {
    for (const type of LEAD_TYPES) {
      expect(sanitizeLeadType(type)).toBe(type);
    }
  });
});

describe("resolveLeadTypeForImport (pure decision logic)", () => {
  test("an explicit row value always wins over the folder default", () => {
    expect(resolveLeadTypeForImport("Veteran", "Mortgage Protection")).toBe("Veteran");
  });

  test("falls back to the folder default when the row has none", () => {
    expect(resolveLeadTypeForImport("", "Mortgage Protection")).toBe("Mortgage Protection");
    expect(resolveLeadTypeForImport(undefined, "Trucker")).toBe("Trucker");
  });

  test("falls back to Final Expense when neither the row nor the folder has a value", () => {
    expect(resolveLeadTypeForImport("", null)).toBe("Final Expense");
    expect(resolveLeadTypeForImport(undefined, null)).toBe("Final Expense");
  });
});

describe("createLeadsFromCSV — folder leadType inheritance", () => {
  const folderId = new Types.ObjectId();

  afterEach(() => jest.restoreAllMocks());

  test("a row with its own Lead Type keeps it, even when the folder has a different default", async () => {
    jest.spyOn(Folder, "findById").mockReturnValue(folderLean({ leadType: "IUL" }) as any);
    const insertMany = jest.spyOn(Lead, "insertMany").mockResolvedValue([] as any);

    await createLeadsFromCSV([{ leadType: "Veteran", Phone: "5551234567" }], "agent@example.com", folderId);

    expect(insertMany.mock.calls[0][0][0].leadType).toBe("Veteran");
  });

  test("a row with no Lead Type inherits the folder's default", async () => {
    jest.spyOn(Folder, "findById").mockReturnValue(folderLean({ leadType: "Mortgage Protection" }) as any);
    const insertMany = jest.spyOn(Lead, "insertMany").mockResolvedValue([] as any);

    await createLeadsFromCSV([{ Phone: "5551234567" }], "agent@example.com", folderId);

    expect(insertMany.mock.calls[0][0][0].leadType).toBe("Mortgage Protection");
  });

  test("a row with no Lead Type in a folder with no default still gets the existing Final Expense fallback", async () => {
    jest.spyOn(Folder, "findById").mockReturnValue(folderLean(null) as any);
    const insertMany = jest.spyOn(Lead, "insertMany").mockResolvedValue([] as any);

    await createLeadsFromCSV([{ Phone: "5551234567" }], "agent@example.com", folderId);

    expect(insertMany.mock.calls[0][0][0].leadType).toBe("Final Expense");
  });

  test("the folder default only applies to rows that are actually blank, within the same batch", async () => {
    jest.spyOn(Folder, "findById").mockReturnValue(folderLean({ leadType: "Trucker" }) as any);
    const insertMany = jest.spyOn(Lead, "insertMany").mockResolvedValue([] as any);

    await createLeadsFromCSV(
      [
        { Phone: "5551111111", leadType: "Veteran" },
        { Phone: "5552222222" },
      ],
      "agent@example.com",
      folderId,
    );

    const inserted = insertMany.mock.calls[0][0];
    expect(inserted[0].leadType).toBe("Veteran");
    expect(inserted[1].leadType).toBe("Trucker");
  });
});

describe("createLeadsFromGoogleSheet — folder leadType inheritance", () => {
  const folderId = new Types.ObjectId();

  afterEach(() => jest.restoreAllMocks());

  test("an explicit row leadType wins over the folder default", async () => {
    jest.spyOn(Folder, "findById").mockReturnValue(folderLean({ leadType: "IUL" }) as any);
    const insertMany = jest.spyOn(Lead, "insertMany").mockResolvedValue([] as any);

    await createLeadsFromGoogleSheet([{ leadType: "Trucker", phone: "5551234567" }], "agent@example.com", folderId);

    expect(insertMany.mock.calls[0][0][0].leadType).toBe("Trucker");
  });

  test("a blank row leadType inherits the folder default", async () => {
    jest.spyOn(Folder, "findById").mockReturnValue(folderLean({ leadType: "Veteran" }) as any);
    const insertMany = jest.spyOn(Lead, "insertMany").mockResolvedValue([] as any);

    await createLeadsFromGoogleSheet([{ phone: "5551234567" }], "agent@example.com", folderId);

    expect(insertMany.mock.calls[0][0][0].leadType).toBe("Veteran");
  });

  test("an invalid/legacy folder.leadType value is ignored, falling through to Final Expense", async () => {
    jest.spyOn(Folder, "findById").mockReturnValue(folderLean({ leadType: "not-a-real-type" }) as any);
    const insertMany = jest.spyOn(Lead, "insertMany").mockResolvedValue([] as any);

    await createLeadsFromGoogleSheet([{ phone: "5551234567" }], "agent@example.com", folderId);

    expect(insertMany.mock.calls[0][0][0].leadType).toBe("Final Expense");
  });
});

describe("ingestVendorLead (/api/v1/leads) — folder leadType inheritance", () => {
  afterEach(() => jest.restoreAllMocks());

  test("an explicit leadType in the payload wins over the folder default", async () => {
    jest.spyOn(Folder, "findOneAndUpdate").mockResolvedValue({ _id: new Types.ObjectId(), leadType: "IUL" } as any);
    jest.spyOn(Lead, "findOne").mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) } as any);
    const create = jest.spyOn(Lead, "create").mockResolvedValue({ _id: new Types.ObjectId() } as any);

    await ingestVendorLead({ userEmail: "agent@example.com", phone: "5551234567", leadType: "Veteran" });

    expect((create.mock.calls[0][0] as any).leadType).toBe("Veteran");
  });

  test("a missing leadType inherits the folder's default on creation", async () => {
    jest.spyOn(Folder, "findOneAndUpdate").mockResolvedValue({ _id: new Types.ObjectId(), leadType: "Trucker" } as any);
    jest.spyOn(Lead, "findOne").mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) } as any);
    const create = jest.spyOn(Lead, "create").mockResolvedValue({ _id: new Types.ObjectId() } as any);

    await ingestVendorLead({ userEmail: "agent@example.com", phone: "5551234567" });

    expect((create.mock.calls[0][0] as any).leadType).toBe("Trucker");
  });

  test("a missing leadType with no folder default falls back to the schema default (key omitted, not forced)", async () => {
    jest.spyOn(Folder, "findOneAndUpdate").mockResolvedValue({ _id: new Types.ObjectId() } as any);
    jest.spyOn(Lead, "findOne").mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) } as any);
    const create = jest.spyOn(Lead, "create").mockResolvedValue({ _id: new Types.ObjectId() } as any);

    await ingestVendorLead({ userEmail: "agent@example.com", phone: "5551234567" });

    expect((create.mock.calls[0][0] as any).leadType).toBeUndefined();
  });

  test("updating an existing lead (by externalId) with a blank leadType does NOT overwrite its current value", async () => {
    jest.spyOn(Folder, "findOneAndUpdate").mockResolvedValue({ _id: new Types.ObjectId(), leadType: "Trucker" } as any);
    const findOneAndUpdate = jest.spyOn(Lead, "findOneAndUpdate").mockResolvedValue({ _id: "existing-lead" } as any);

    await ingestVendorLead({ userEmail: "agent@example.com", phone: "5551234567", externalId: "vendor-123" });

    const updatePayload = findOneAndUpdate.mock.calls[0][1] as any;
    expect(updatePayload.$set.leadType).toBeUndefined();
  });
});
