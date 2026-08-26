import crypto from "crypto";
import MetaCAPIEvent from "@/models/MetaCAPIEvent";
import {
  buildMetaCapiEventPayload,
  isCapiEnabled,
  lifecycleEventId,
  sha256Normalized,
  queueMetaLifecycleEventNonBlocking,
  enqueueMetaLifecycleEventSafely,
} from "@/lib/meta/capi";
import { dispositionToMetaLifecycleEvent } from "@/lib/facebook/trackCRMOutcome";
import { buildCampaignStructure } from "@/lib/facebook/buildCampaignStructure";

describe("Meta CAPI", () => {
  it("builds a privacy-safe payload with Meta-normalized SHA-256 PII", () => {
    const payload = buildMetaCapiEventPayload({
      eventName: "AppointmentBooked",
      eventId: "evt-1",
      eventTime: 1_700_000_000,
      email: " Person@Example.COM ",
      phone: "(602) 555-0199",
      externalId: "lead-1",
      fbc: "fb.1.click",
      metaAdId: "ad-1",
    });
    expect(payload).toEqual(expect.objectContaining({
      event_name: "AppointmentBooked",
      event_id: "evt-1",
      action_source: "system_generated",
    }));
    expect(payload.user_data.em).toEqual([
      crypto.createHash("sha256").update("person@example.com").digest("hex"),
    ]);
    expect(payload.user_data.ph).toEqual([
      crypto.createHash("sha256").update("16025550199").digest("hex"),
    ]);
    expect(JSON.stringify(payload)).not.toContain("Person@Example.COM");
    expect(JSON.stringify(payload)).not.toContain("602) 555");
    expect((payload as any).health).toBeUndefined();
    expect((payload as any).policy).toBeUndefined();
  });

  it("uses stable per-lifecycle IDs and a unique tenant event index for retry dedup", () => {
    expect(lifecycleEventId("lead-event", "Sale")).toBe(lifecycleEventId("lead-event", "Sale"));
    expect(lifecycleEventId("lead-event", "Sale")).not.toBe(lifecycleEventId("lead-event", "Qualified"));
    const uniqueIndex = MetaCAPIEvent.schema.indexes().find(([fields]) =>
      fields.userEmail === 1 && fields.eventId === 1 && fields.eventName === 1
    );
    expect(uniqueIndex?.[1]?.unique).toBe(true);
  });

  it("keeps the global kill switch off unless explicitly true", () => {
    expect(isCapiEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isCapiEnabled({ CAPI_ENABLED: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isCapiEnabled({ CAPI_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("maps CRM outcomes to supported lifecycle events", () => {
    expect(dispositionToMetaLifecycleEvent("contacted")).toBe("Contacted");
    expect(dispositionToMetaLifecycleEvent("qualified")).toBe("Qualified");
    expect(dispositionToMetaLifecycleEvent("booked appointment")).toBe("AppointmentBooked");
    expect(dispositionToMetaLifecycleEvent("policy issued")).toBe("PolicyIssued");
    expect(sha256Normalized("", "email")).toBe("");
  });

  it("never lets a CAPI outage reject the CRM outcome path", async () => {
    const onError = jest.fn();
    const enqueue = jest.fn().mockRejectedValue(new Error("Meta is down"));
    expect(() => queueMetaLifecycleEventNonBlocking({
      userEmail: "tenant@example.com",
      leadId: "lead-1",
      leadEventId: "stable-lead-event",
      eventName: "Sale",
    }, enqueue, onError)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Meta is down" }));
    await expect(enqueueMetaLifecycleEventSafely({
      userEmail: "tenant@example.com", leadId: "lead-1", leadEventId: "stable", eventName: "Sale",
    }, enqueue, onError)).resolves.toEqual({ status: "queue_failed" });
  });

  it("keeps lead generation as default and allows an explicit conversion-leads goal", () => {
    const base = {
      campaignName: "Test",
      leadType: "final_expense" as const,
      licensedStates: ["AZ"],
      dailyBudgetCents: 500,
      creatives: [{ primaryText: "Text", headline: "Headline" }],
    };
    expect(buildCampaignStructure(base).adSet.optimization_goal).toBe("LEAD_GENERATION");
    expect(buildCampaignStructure({ ...base, performanceGoal: "QUALITY_LEAD" }).adSet.optimization_goal).toBe("QUALITY_LEAD");
  });
});
