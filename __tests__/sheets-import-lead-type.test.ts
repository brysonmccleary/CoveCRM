import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import importHandler from "../pages/api/google/sheets/import";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { ensureNonSystemFolderId } from "@/lib/folders/ensureNonSystemFolderId";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("../pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
jest.mock("@/lib/mongooseConnect", () => jest.fn());
jest.mock("@/lib/drips/enrollOnNewLead", () => ({ enrollOnNewLeadIfWatched: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/folders/ensureNonSystemFolderId", () => ({ ensureNonSystemFolderId: jest.fn() }));

jest.mock("@/models/User", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), updateOne: jest.fn().mockReturnValue({ catch: jest.fn() }) },
}));

jest.mock("@/models/Folder", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("@/models/Lead", () => ({
  __esModule: true,
  default: { updateOne: jest.fn() },
}));

const mockValuesGet = jest.fn();
const mockDriveFilesGet = jest.fn().mockResolvedValue({ data: { name: "Imported Leads" } });
jest.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })) },
    sheets: jest.fn().mockImplementation(() => ({
      spreadsheets: { values: { get: (...args: any[]) => mockValuesGet(...args) } },
    })),
    drive: jest.fn().mockImplementation(() => ({
      files: { get: (...args: any[]) => mockDriveFilesGet(...args) },
    })),
  },
}));

function mockReqRes(body: Record<string, unknown>) {
  const req = { method: "POST", body, headers: { host: "app.test" } } as unknown as NextApiRequest;
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

function folderLean(value: unknown) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) };
}

const mockedGetServerSession = getServerSession as jest.Mock;
const mockedUser = User as unknown as { findOne: jest.Mock };
const mockedFolder = Folder as unknown as { findById: jest.Mock };
const mockedLead = Lead as unknown as { updateOne: jest.Mock };
const mockedEnsureFolder = ensureNonSystemFolderId as jest.Mock;

const REQUEST_BODY = {
  spreadsheetId: "sheet123",
  title: "Sheet1",
  headerRow: 1,
  mapping: { Phone: "phone", Name: "firstName" },
};

describe("pages/api/google/sheets/import.ts — leadType inheritance from folder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    mockedUser.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        googleSheets: { refreshToken: "rt", accessToken: "at", expiryDate: 0 },
      }),
    });
    mockedEnsureFolder.mockResolvedValue({ folderId: "folder1", folderName: "Imported Leads" });
    mockedLead.updateOne.mockResolvedValue({ upsertedCount: 1, upsertedId: { _id: "newlead1" } });
    mockValuesGet.mockResolvedValue({
      data: { values: [["Phone", "Name"], ["5551234567", "Jane"]] },
    });
  });

  test("inserts the folder's leadType into $setOnInsert when the folder has one", async () => {
    mockedFolder.findById.mockReturnValue(folderLean({ leadType: "Mortgage Protection" }) as any);
    const { req, res } = mockReqRes(REQUEST_BODY);

    await importHandler(req, res);

    expect(res.statusCode).toBe(200);
    const [, updatePayload] = mockedLead.updateOne.mock.calls[0];
    expect(updatePayload.$setOnInsert.leadType).toBe("Mortgage Protection");
  });

  test("omits leadType from $setOnInsert when the folder has no default (schema default still applies)", async () => {
    mockedFolder.findById.mockReturnValue(folderLean(null) as any);
    const { req, res } = mockReqRes(REQUEST_BODY);

    await importHandler(req, res);

    expect(res.statusCode).toBe(200);
    const [, updatePayload] = mockedLead.updateOne.mock.calls[0];
    expect(updatePayload.$setOnInsert.leadType).toBeUndefined();
  });

  test("an invalid folder.leadType value is ignored rather than written through", async () => {
    mockedFolder.findById.mockReturnValue(folderLean({ leadType: "garbage" }) as any);
    const { req, res } = mockReqRes(REQUEST_BODY);

    await importHandler(req, res);

    const [, updatePayload] = mockedLead.updateOne.mock.calls[0];
    expect(updatePayload.$setOnInsert.leadType).toBeUndefined();
  });

  test("leadType is only ever set via $setOnInsert, never $set — an existing lead's leadType is never overwritten on re-sync", async () => {
    mockedFolder.findById.mockReturnValue(folderLean({ leadType: "Veteran" }) as any);
    const { req, res } = mockReqRes(REQUEST_BODY);

    await importHandler(req, res);

    const [, updatePayload] = mockedLead.updateOne.mock.calls[0];
    expect(updatePayload.$set.leadType).toBeUndefined();
    expect(updatePayload.$setOnInsert.leadType).toBe("Veteran");
  });
});
