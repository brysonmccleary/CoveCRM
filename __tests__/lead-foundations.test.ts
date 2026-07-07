import fs from "fs";
import path from "path";
import {
  buildOutboundContactAttemptUpdate,
  buildSoldAtTransitionSet,
  deriveInteractionContactFields,
  isSoldStatus,
} from "@/lib/leads/foundationFields";
import { timezoneForState } from "@/lib/leads/stateTimezone";

const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("lead foundation fields", () => {
  it("sets soldAt once on transition into sold and never overwrites it", () => {
    const firstSoldAt = new Date("2026-01-02T03:04:05.000Z");
    const existingSoldAt = new Date("2026-02-03T04:05:06.000Z");

    expect(isSoldStatus("Sold")).toBe(true);
    expect(
      buildSoldAtTransitionSet({
        nextStatus: "Sold",
        previousStatus: "New",
        existingSoldAt: null,
        now: firstSoldAt,
      }),
    ).toEqual({ soldAt: firstSoldAt, soldAtApproximate: false });

    expect(
      buildSoldAtTransitionSet({
        nextStatus: "Sold",
        previousStatus: "Sold",
        existingSoldAt,
        now: new Date("2026-03-04T05:06:07.000Z"),
      }),
    ).toEqual({});

    expect(
      buildSoldAtTransitionSet({
        nextStatus: "Not Interested",
        previousStatus: "Sold",
        existingSoldAt,
        now: new Date("2026-03-04T05:06:07.000Z"),
      }),
    ).toEqual({});
  });

  it("uses atomic outbound contact attempt updates", () => {
    const at = new Date("2026-04-05T06:07:08.000Z");
    expect(buildOutboundContactAttemptUpdate(at)).toEqual({
      $inc: { contactAttempts: 1 },
      $set: { lastContactedAt: at },
    });

    const smsSource = readRepoFile("lib/twilio/sendSMS.ts");
    const webCallSource = readRepoFile("pages/api/twilio/call/start.ts");
    const aiWorkerSource = readRepoFile("pages/api/ai-calls/worker.ts");

    expect(smsSource).toContain("void recordOutboundTouch({ leadId: lead._id, userEmail: user.email })");
    expect(webCallSource).toContain("void recordOutboundTouch({ leadId: body.leadId, userEmail })");
    expect(aiWorkerSource).toContain("void recordOutboundTouch({ leadId, userEmail })");
  });

  it("recordOutboundTouch swallows Mongo errors", async () => {
    jest.resetModules();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.doMock("@/models/Lead", () => ({
      __esModule: true,
      default: {
        updateOne: jest.fn(() => ({
          exec: jest.fn().mockRejectedValue(new Error("mongo down")),
        })),
      },
    }));

    const { recordOutboundTouch } = await import("@/lib/leads/foundationFields");
    await expect(
      recordOutboundTouch({ leadId: "lead-1", userEmail: "USER@EXAMPLE.COM" }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[lead-foundations] touch failed",
      expect.objectContaining({
        leadId: "lead-1",
        userEmail: "user@example.com",
        error: "mongo down",
      }),
    );

    warnSpy.mockRestore();
    jest.dontMock("@/models/Lead");
    jest.resetModules();
  });

  it("does not count inbound interactions when deriving contact attempts", () => {
    const latestOutbound = new Date("2026-05-03T00:00:00.000Z");
    const derived = deriveInteractionContactFields([
      { type: "inbound", date: "2026-05-04T00:00:00.000Z" },
      { type: "outbound", date: "2026-05-01T00:00:00.000Z" },
      { direction: "outbound", createdAt: latestOutbound },
      { type: "ai", date: "2026-05-05T00:00:00.000Z" },
    ]);

    expect(derived.contactAttempts).toBe(2);
    expect(derived.lastContactedAt?.toISOString()).toBe(latestOutbound.toISOString());
  });

  it("derives timezone from State on create and update paths", () => {
    expect(timezoneForState("CA")).toBe("America/Los_Angeles");
    expect(timezoneForState("Texas")).toBe("America/Chicago");
    expect(timezoneForState("")).toBe("");

    const schemaSource = readRepoFile("lib/mongo/leads.ts");
    expect(schemaSource).toContain('timezone: { type: String, default: "" }');
    expect(schemaSource).toContain('LeadSchema.pre("validate"');
    expect(schemaSource).toContain("doc.isNew && isSoldStatus(doc.status)");
    expect(schemaSource).toContain('LeadSchema.pre("updateOne"');
    expect(schemaSource).toContain('LeadSchema.pre("findOneAndUpdate"');
  });

  it("keeps the backfill dry run read-only", () => {
    const scriptSource = readRepoFile("scripts/backfill-lead-foundations.ts");
    expect(scriptSource).toContain("const DRY_RUN = process.argv.includes(\"--dry\")");
    expect(scriptSource).toContain("if (!DRY_RUN)");
    expect(scriptSource).toContain("dry run only; no writes performed");
  });

  it("scopes import folder leadIds reconciliation to the target folder", () => {
    const importSource = readRepoFile("pages/api/import-leads.ts");
    const scopedQuery =
      "Lead.find({ userEmail, folderId: safeFolderId, $or: orFilters }).select(\"_id\")";
    expect(importSource.match(new RegExp(scopedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(2);
  });
});
