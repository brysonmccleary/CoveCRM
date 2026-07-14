import fs from "fs";
import path from "path";
import {
  computeScheduledDripSendAt,
  delayToLegacyDayString,
  parseLegacyDayField,
  resolveLeadTimezone,
} from "@/lib/drips/computeScheduledDripSendAt";
import { resolveStateCode, stateToTimezone } from "@/utils/timezone";

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("drip minute delays", () => {
  test("parses and serializes legacy minute timing", () => {
    expect(parseLegacyDayField("Minute 5")).toEqual({ value: 5, unit: "minutes" });
    expect(parseLegacyDayField("15 minutes")).toEqual({ value: 15, unit: "minutes" });
    expect(delayToLegacyDayString(10, "minutes")).toBe("10 minutes");
  });

  test("schedules an exact minute delay from enrollment", () => {
    const enrolledAt = new Date("2026-07-14T17:00:00.000Z");
    const sendAt = computeScheduledDripSendAt({
      enrolledAt,
      step: { delayValue: 5, delayUnit: "minutes" },
      leadState: "AZ",
    });

    expect(sendAt?.toISOString()).toBe("2026-07-14T17:05:00.000Z");
  });

  test("defers a minute follow-up that lands in quiet hours", () => {
    const enrolledAt = new Date("2026-07-15T03:58:00.000Z"); // 8:58 PM in Arizona
    const sendAt = computeScheduledDripSendAt({
      enrolledAt,
      step: { delayValue: 5, delayUnit: "minutes" },
      leadState: "AZ",
    });

    expect(sendAt?.toISOString()).toBe("2026-07-15T15:00:00.000Z"); // 8:00 AM in Arizona
  });

  test("keeps existing hour and day scheduling behavior", () => {
    const enrolledAt = new Date("2026-07-14T17:00:00.000Z");

    expect(computeScheduledDripSendAt({
      enrolledAt,
      step: { delayValue: 2, delayUnit: "hours" },
      leadState: "AZ",
    })?.toISOString()).toBe("2026-07-14T19:00:00.000Z");

    expect(computeScheduledDripSendAt({
      enrolledAt,
      step: { delayValue: 1, delayUnit: "days" },
      leadState: "AZ",
    })?.toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  test("limits minute delays to message 2 and 1 through 60 minutes", () => {
    for (const apiPath of ["pages/api/drips/campaigns.ts", "pages/api/drips/[id].ts"]) {
      const source = readSource(apiPath);
      expect(source).toContain('index !== 1 || delayValue === undefined || delayValue < 1 || delayValue > 60');
      expect(source).toContain("Minute delays are only allowed for message 2");
      expect(source).toContain('new Set(["minutes", "hours", "days", "weeks", "months"])');
    }
  });

  test("offers minutes only on message 2 in every drip editor", () => {
    const source = readSource("components/DripCampaignsPanel.tsx");
    expect(source.match(/idx === 1 && <option value="minutes">/g)).toHaveLength(4);
    expect(source).toContain('max={du === "minutes" ? 60 : undefined}');
    expect(source).toContain('max={step.delayUnit === "minutes" ? 60 : undefined}');
    expect(source).toContain('lastUnit === "minutes" ? "days" : lastUnit');
    expect(source).toContain('if (copy.delayUnit === "minutes")');
  });

  test("bypasses only the normal cooldown for a valid rapid first follow-up", () => {
    const source = readSource("pages/api/cron/send-drip-messages.ts");
    expect(source).toContain("Number(record.stepIndex) === 1");
    expect(source).toContain('record.delayUnit === "minutes"');
    expect(source).toContain("Number(record.delayValue) >= 1");
    expect(source).toContain("Number(record.delayValue) <= 60");
    expect(source).toContain("const recentDrip = isRapidFirstFollowUp");
    expect(source).toContain("const MIN_COOLDOWN_MINUTES = 120");
  });

  test("allows minutes in both persisted scheduling schemas", () => {
    for (const modelPath of ["models/DripCampaign.ts", "models/ScheduledDripMessage.ts"]) {
      expect(readSource(modelPath)).toContain('["minutes", "hours", "days", "weeks", "months"]');
    }
  });

  test("resolves every US state and DC from codes and full names", () => {
    expect(Object.keys(stateToTimezone)).toHaveLength(51);

    for (const [stateCode, zone] of Object.entries(stateToTimezone)) {
      expect(resolveLeadTimezone(stateCode)).toBe(zone);
      expect(resolveStateCode(stateCode)).toBe(stateCode);
      expect(Intl.DateTimeFormat(undefined, { timeZone: zone }).resolvedOptions().timeZone).toBeTruthy();
    }

    expect(resolveLeadTimezone("Hawaii")).toBe("Pacific/Honolulu");
    expect(resolveLeadTimezone("California")).toBe("America/Los_Angeles");
    expect(resolveLeadTimezone("New York")).toBe("America/New_York");
    expect(resolveLeadTimezone("District of Columbia")).toBe("America/New_York");
    expect(resolveLeadTimezone("North Carolina")).toBe("America/New_York");
    expect(resolveLeadTimezone("North Dakota")).toBe("America/Chicago");
    expect(resolveLeadTimezone("Rhode Island")).toBe("America/New_York");
    expect(resolveLeadTimezone("South Dakota")).toBe("America/Chicago");
    expect(resolveLeadTimezone("West Virginia")).toBe("America/New_York");
    expect(resolveLeadTimezone("Washington, D.C.")).toBe("America/New_York");
  });

  test("uses lead timezone, then state, then agent timezone, then default", () => {
    expect(resolveLeadTimezone("HI", "America/Adak", "America/New_York")).toBe("America/Adak");
    expect(resolveLeadTimezone("HI", null, "America/New_York")).toBe("Pacific/Honolulu");
    expect(resolveLeadTimezone(null, null, "America/Denver")).toBe("America/Denver");
    expect(resolveLeadTimezone("unknown", "invalid/zone", "America/Chicago")).toBe("America/Chicago");

    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(resolveLeadTimezone(null, null, null)).toBe("America/New_York");
    warn.mockRestore();
  });

  test("accepts every IANA timezone supported by the runtime as an explicit lead timezone", () => {
    const zones: string[] = (Intl as any).supportedValuesOf?.("timeZone") || [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
    ];

    expect(zones.length).toBeGreaterThanOrEqual(6);
    for (const zone of zones) {
      expect(resolveLeadTimezone(null, zone, "America/New_York")).toBe(zone);
    }
  });

  test("agent timezone never shifts a lead with a known timezone", () => {
    const enrolledAt = new Date("2026-07-15T03:58:00.000Z");
    const scheduleForAgent = (agentTimezone: string) => computeScheduledDripSendAt({
      enrolledAt,
      step: { delayValue: 5, delayUnit: "minutes" },
      leadState: "HI",
      leadTimezone: "Pacific/Honolulu",
      agentTimezone,
    })?.toISOString();

    expect(scheduleForAgent("America/New_York")).toBe("2026-07-15T04:03:00.000Z");
    expect(scheduleForAgent("America/Los_Angeles")).toBe("2026-07-15T04:03:00.000Z");
  });

  test("keeps day sends at 9 AM lead-local through daylight-saving changes", () => {
    const beforeSpringForward = computeScheduledDripSendAt({
      enrolledAt: new Date("2026-03-07T17:00:00.000Z"),
      step: { delayValue: 1, delayUnit: "days" },
      leadTimezone: "America/New_York",
      agentTimezone: "America/Phoenix",
    });
    const beforeFallBack = computeScheduledDripSendAt({
      enrolledAt: new Date("2026-10-31T16:00:00.000Z"),
      step: { delayValue: 1, delayUnit: "days" },
      leadTimezone: "America/New_York",
      agentTimezone: "Pacific/Honolulu",
    });

    expect(beforeSpringForward?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(beforeFallBack?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  test("passes stored lead and agent timezones through enrollment scheduling", () => {
    const enrollmentSource = readSource("pages/api/drips/enroll-lead.ts");
    const schedulerSource = readSource("lib/drips/createScheduledDripMessages.ts");
    expect(enrollmentSource).toContain('select("_id email name agentPhone timezone")');
    expect(enrollmentSource).toContain("leadTimezone: (lead as any).timezone || null");
    expect(enrollmentSource).toContain("agentTimezone: (user as any).timezone || null");
    expect(schedulerSource).toContain("resolveLeadTimezone(leadState, leadTimezone, agentTimezone)");
  });
});
