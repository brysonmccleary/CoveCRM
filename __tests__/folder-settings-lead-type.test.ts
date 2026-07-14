import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import aiSettingsHandler from "../pages/api/folders/ai-settings";
import createFolderHandler from "../pages/api/create-folder";
import Folder from "@/models/Folder";
import fs from "fs";
import path from "path";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("../pages/api/auth/[...nextauth]", () => ({ authOptions: {} }));
jest.mock("@/lib/mongooseConnect", () => jest.fn());

jest.mock("@/models/Folder", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
  },
}));

function mockReqRes(body: Record<string, unknown> = {}) {
  const req = { method: "POST", body } as unknown as NextApiRequest;
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

const mockedGetServerSession = getServerSession as jest.Mock;
const mockedFolder = Folder as unknown as {
  findOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
  create: jest.Mock;
};

const VALID_FOLDER_ID = "507f1f77bcf86cd799439011";

describe("pages/api/folders/ai-settings.ts — leadType", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
    mockedFolder.findOne.mockResolvedValue({ _id: VALID_FOLDER_ID, leadType: undefined });
  });

  test("accepts a canonical leadType and persists it via $set", async () => {
    mockedFolder.findOneAndUpdate.mockResolvedValue({ _id: VALID_FOLDER_ID, leadType: "Trucker" });
    const { req, res } = mockReqRes({ folderId: VALID_FOLDER_ID, leadType: "Trucker" });

    await aiSettingsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockedFolder.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $set: expect.objectContaining({ leadType: "Trucker" }) }),
      expect.anything(),
    );
    expect((res as any).body.leadType).toBe("Trucker");
  });

  test("rejects a non-canonical leadType", async () => {
    const { req, res } = mockReqRes({ folderId: VALID_FOLDER_ID, leadType: "Not A Real Type" });
    await aiSettingsHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(mockedFolder.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("an empty string clears the folder's leadType override via $unset", async () => {
    mockedFolder.findOneAndUpdate.mockResolvedValue({ _id: VALID_FOLDER_ID, leadType: undefined });
    const { req, res } = mockReqRes({ folderId: VALID_FOLDER_ID, leadType: "" });

    await aiSettingsHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockedFolder.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ $unset: { leadType: "" } }),
      expect.anything(),
    );
  });

  test("omitting leadType entirely leaves it untouched", async () => {
    const { req, res } = mockReqRes({ folderId: VALID_FOLDER_ID, aiRealTimeOnly: true });
    mockedFolder.findOneAndUpdate.mockResolvedValue({ _id: VALID_FOLDER_ID });

    await aiSettingsHandler(req, res);

    const updateArg = mockedFolder.findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$unset).toBeUndefined();
    expect(updateArg.$set.leadType).toBeUndefined();
  });
});

describe("pages/api/create-folder.ts — leadType", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetServerSession.mockResolvedValue({ user: { email: "agent@example.com" } });
  });

  test("creates a folder with a canonical leadType", async () => {
    mockedFolder.create.mockResolvedValue({ _id: VALID_FOLDER_ID });
    const { req, res } = mockReqRes({ name: "Trucker Leads", leadType: "Trucker" });

    await createFolderHandler(req, res);

    expect(res.statusCode).toBe(201);
    expect(mockedFolder.create).toHaveBeenCalledWith(expect.objectContaining({ leadType: "Trucker" }));
  });

  test("creates a folder with no leadType field at all when none is given", async () => {
    mockedFolder.create.mockResolvedValue({ _id: VALID_FOLDER_ID });
    const { req, res } = mockReqRes({ name: "General Leads" });

    await createFolderHandler(req, res);

    expect(res.statusCode).toBe(201);
    const createArg = mockedFolder.create.mock.calls[0][0];
    expect(createArg.leadType).toBeUndefined();
  });

  test("rejects an invalid leadType at creation", async () => {
    const { req, res } = mockReqRes({ name: "Bad Folder", leadType: "Nonsense" });
    await createFolderHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(mockedFolder.create).not.toHaveBeenCalled();
  });
});

describe("folder-row lead type control", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "components/LeadsPanel.tsx"), "utf8");

  test("renders a lead-type dropdown next to the AI script and saves it through folder settings", () => {
    expect(source).toContain("Lead type: Not set");
    expect(source).toContain("handleLeadTypeChange(folder, e.target.value)");
    expect(source).toContain("JSON.stringify({ folderId, leadType: nextLeadType })");
  });
});
