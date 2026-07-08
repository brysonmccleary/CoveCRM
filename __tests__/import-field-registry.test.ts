import fs from "fs";
import path from "path";
import {
  bestGuess,
  buildAutoMapping,
  buildInsertCreatedAt,
  customFieldTarget,
  isDateAddedHeader,
  normalizeImportMapping,
  sanitizeCustomFieldName,
} from "@/lib/leads/importFieldRegistry";

const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("import field registry", () => {
  it("imports non-system headers as their own field names", () => {
    const normalized = normalizeImportMapping(
      {
        "Policy Type": customFieldTarget("Policy Type"),
        "Mortgage Amt": customFieldTarget("Mortgage Amt"),
      },
      ["Policy Type", "Mortgage Amt"],
    );

    expect(normalized.customFields).toEqual(["Policy Type", "Mortgage Amt"]);
    expect(normalized.mapped).toEqual({
      "Policy Type": "Custom field: Policy Type",
      "Mortgage Amt": "Custom field: Mortgage Amt",
    });
    expect(bestGuess("Mortgage Amt")).toBe("");
  });

  it("detects required system fields only", () => {
    expect(bestGuess("Phone Number")).toBe("Phone");
    expect(bestGuess("date added")).toBe("");
    expect(buildAutoMapping(["Phone Number"])["Phone Number"]).toBe("Phone");
  });

  it("keeps Date Added as a custom field while detecting createdAt override headers", () => {
    const normalized = normalizeImportMapping(
      { "date added": customFieldTarget("date added") },
      ["date added"],
    );
    expect(normalized.customFields).toEqual(["date added"]);
    expect(isDateAddedHeader("date added")).toBe(true);
    expect(isDateAddedHeader("createdAt")).toBe(true);
  });

  it("Date Added parse sets createdAt insert shape", () => {
    const warnings: string[] = [];
    const fallback = new Date("2026-01-01T00:00:00.000Z");
    const createdAt = buildInsertCreatedAt("2024-05-06", fallback, warnings);
    expect(createdAt.toISOString()).toBe("2024-05-06T00:00:00.000Z");
    expect(warnings).toEqual([]);
  });

  it("unparseable Date Added warns instead of throwing", () => {
    const warnings: string[] = [];
    const fallback = new Date("2026-01-01T00:00:00.000Z");
    expect(() => buildInsertCreatedAt("not a date", fallback, warnings)).not.toThrow();
    expect(buildInsertCreatedAt("not a date", fallback, [])).toEqual(fallback);
    expect(warnings).toEqual(['Date Added "not a date" was not parseable; createdAt default used.']);
  });

  it("sanitizes header names for Mongo keys", () => {
    expect(sanitizeCustomFieldName("Policy.$Amount")).toBe("Policy Amount");
    expect(customFieldTarget("Policy.$Amount")).toBe("Custom field: Policy Amount");
  });

  it("upserts registry entries for non-system fields during import", () => {
    const importSource = readRepoFile("pages/api/import-leads.ts");
    expect(importSource).toContain("await upsertCustomFieldRegistry(userEmail, normalizedMapping.customFields)");
    expect(importSource).toContain("LeadCustomField");
  });
});
