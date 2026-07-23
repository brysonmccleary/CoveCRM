import BillingEvent from "@/models/BillingEvent";
import fs from "fs";
import path from "path";

describe("BillingEvent charge identity", () => {
  test("enforces one event per immutable source identity regardless of amount", () => {
    const indexes = BillingEvent.schema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        [
          { source: 1, sourceId: 1 },
          expect.objectContaining({ unique: true, name: "billing_event_source_identity" }),
        ],
      ]),
    );
  });

  test("the forward reconciler ensures the charge identity index in production", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib/billing/reconcileTwilioVoiceUsage.ts"),
      "utf8",
    );
    expect(source).toContain("BillingEvent.createIndexes()");
  });
});
