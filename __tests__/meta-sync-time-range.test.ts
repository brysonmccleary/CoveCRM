import { buildInclusiveMetaTimeRange } from "@/lib/meta/syncAdInsights";

describe("Meta insights inclusive date range", () => {
  it("includes the current day in a seven-day sync window", () => {
    expect(buildInclusiveMetaTimeRange(7, new Date("2026-09-04T02:55:00Z"))).toEqual({
      since: "2026-08-29",
      until: "2026-09-04",
    });
  });

  it("uses today for a one-day sync", () => {
    expect(buildInclusiveMetaTimeRange(1, new Date("2026-09-04T02:55:00Z"))).toEqual({
      since: "2026-09-04",
      until: "2026-09-04",
    });
  });
});
