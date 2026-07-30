import { sendEmail } from "@/lib/email";
import { RECRUITING_ADMIN_EMAIL } from "@/lib/recruiting/access";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";

// Early-warning system for "the platform changed its DOM last night" and
// "the qualification model stopped working": both fail safe per-action, but
// without an alert they surface as customers quietly getting zero activity.
// One email per category per platform per day, deduped atomically through the
// audit collection's unique (ownerEmail, eventType, entityId) index.

export const AUTOMATION_FAILURE_CODES = ["control_missing", "control_ambiguous", "execution_error", "target_mismatch"] as const;

const ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

function alertThreshold(): number {
  const parsed = Number(process.env.RECRUITING_ALERT_FAILURE_THRESHOLD || "5");
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 5;
}

export type AutomationAlertKind = "action_failures" | "qualification_failures";

export async function maybeSendAutomationHealthAlert(kind: AutomationAlertKind, platform: string): Promise<void> {
  const now = new Date();
  const since = new Date(now.getTime() - ALERT_WINDOW_MS);
  const count = kind === "action_failures"
    ? await RecruitingAuditEvent.countDocuments({
        eventType: "action_failed",
        occurredAt: { $gte: since },
        "details.failureCode": { $in: [...AUTOMATION_FAILURE_CODES] },
      })
    : await RecruitingAuditEvent.countDocuments({
        eventType: "discovery_qualification_failed",
        occurredAt: { $gte: since },
      });
  if (count < alertThreshold()) return;

  const dayKey = now.toISOString().slice(0, 10);
  const marker = await RecruitingAuditEvent.updateOne(
    { ownerEmail: RECRUITING_ADMIN_EMAIL, eventType: "automation_alert_sent", entityId: `${kind}:${platform}:${dayKey}` },
    {
      $setOnInsert: {
        ownerEmail: RECRUITING_ADMIN_EMAIL,
        actorEmail: RECRUITING_ADMIN_EMAIL,
        eventType: "automation_alert_sent",
        entityType: "alert",
        entityId: `${kind}:${platform}:${dayKey}`,
        details: { kind, platform, count, windowHours: 24 },
        occurredAt: now,
      },
    },
    { upsert: true },
  );
  if (!marker.upsertedCount) return; // Someone already alerted today.

  const subject = kind === "action_failures"
    ? `Recruiting automation: ${count} execution failures on ${platform} in 24h`
    : `Recruiting automation: audience qualification failing (${count} in 24h)`;
  const body = kind === "action_failures"
    ? `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a"><h2>Automation failures are spiking</h2><p>${count} recruiting actions failed with selector/execution errors on ${platform} in the last 24 hours. This usually means the platform changed its page structure. Check the recent <code>action_failed</code> audit events and the failure codes before more customers are affected.</p></div>`
    : `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a"><h2>Audience qualification is failing</h2><p>${count} discovery scans could not complete AI qualification in the last 24 hours. Check OPENAI_API_KEY and RECRUITING_QUALIFICATION_MODEL — while this persists, scans complete with zero new prospects.</p></div>`;
  await sendEmail(RECRUITING_ADMIN_EMAIL, subject, body);
}
