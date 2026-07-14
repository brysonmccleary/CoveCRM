import fs from "fs";
import path from "path";

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("vendor API folder binding", () => {
  test("creates or finds the folder before saving the API key", () => {
    const apiSource = source("pages/api/developer/api-keys/index.ts");
    expect(apiSource).toContain("Folder.findOneAndUpdate(");
    expect(apiSource).toContain("folderId: folder._id");
    expect(apiSource).toContain("folderName: folder.name");
    expect(apiSource.indexOf("Folder.findOneAndUpdate(")).toBeLessThan(apiSource.indexOf("ApiKey.create("));
  });

  test("requires a canonical lead type and applies it to the folder", () => {
    const apiSource = source("pages/api/developer/api-keys/index.ts");
    expect(apiSource).toContain("LEAD_TYPES as readonly string[]");
    expect(apiSource).toContain("$set: { leadType }");

    const uiSource = source("components/ImportLeadsChooser.tsx");
    expect(uiSource).toContain("Select lead type");
    expect(uiSource).toContain("Create Folder & API Key");
    expect(uiSource).toContain("LEAD_TYPES.map");
    expect(uiSource).toContain("onVendorConnectionCreated?.()");
    expect(source("components/LeadsPanel.tsx")).toContain("onVendorConnectionCreated={fetchFolders}");
  });

  test("stores a permanent folder reference on the API key", () => {
    const modelSource = source("models/ApiKey.ts");
    expect(modelSource).toContain('folderId: { type: Schema.Types.ObjectId, ref: "Folder"');
  });

  test("never accepts a vendor-provided folder destination", () => {
    const endpointSource = source("pages/api/v1/leads.ts");
    expect(endpointSource).not.toContain("folderId: body.folderId");
    expect(endpointSource).not.toContain("folderName: apiKey.folderName || body.folderName");
    expect(endpointSource).toContain("folderId: destinationFolderId");
  });

  test("safely binds legacy keys without trusting the lead payload", () => {
    const endpointSource = source("pages/api/v1/leads.ts");
    expect(endpointSource).toContain("if (!destinationFolderId)");
    expect(endpointSource).toContain('`${String(apiKey.name || "API").trim() || "API"} Leads`');
    expect(endpointSource).toContain("const proposedFolderId = existingFolder?._id || new Types.ObjectId()");
    expect(endpointSource).toContain("$or: [{ folderId: null }, { folderId: { $exists: false } }]");
    expect(endpointSource).toContain("_id: destinationFolderId, userEmail: apiKey.userEmail");
  });

  test("shows copy-ready vendor connection instructions", () => {
    const uiSource = source("components/ImportLeadsChooser.tsx");
    expect(uiSource).toContain("https://www.covecrm.com/api/v1/leads");
    expect(uiSource).toContain("Copy Vendor Setup");
    expect(uiSource).toContain("Bearer API key");
    expect(source("pages/api/v1/leads.ts")).toContain('req.headers["x-api-key"]');
  });
});
