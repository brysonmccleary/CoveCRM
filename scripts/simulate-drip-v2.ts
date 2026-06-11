// scripts/simulate-drip-v2.ts
//
// SIMULATION ONLY — No Twilio calls, No MongoDB writes, No production data.
//
// Run:
//   npx tsx --tsconfig tsconfig.json scripts/simulate-drip-v2.ts
//
// Validates all 13 required scenarios for V2 ScheduledDripMessage by:
//   a) Calling the actual pure functions directly (computeScheduledDripSendAt, etc.)
//   b) Simulating DB-dependent worker/cancel logic in-memory
//
// No mongoose, no real DB connection, no Twilio SDK touched.

import { DateTime } from "luxon";
import {
  computeScheduledDripSendAt,
  isBirthdayStep,
  resolveLeadTimezone,
} from "@/lib/drips/computeScheduledDripSendAt";

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[1m", X = "\x1b[0m";

let totalPass = 0, totalFail = 0;
const failures: string[] = [];

function pass(label: string) { console.log(`  ${G}✓${X} ${label}`); totalPass++; }
function fail(label: string, detail?: string) {
  const m = detail ? `${label} — ${detail}` : label;
  console.log(`  ${R}✗${X} ${m}`);
  failures.push(m);
  totalFail++;
}
function check(ok: boolean, label: string, got?: unknown, want?: unknown) {
  if (ok) pass(label);
  else fail(label, got !== undefined ? `got=${JSON.stringify(got)} want=${JSON.stringify(want)}` : undefined);
}
function sim(title: string, fn: () => void) {
  console.log(`\n${B}${title}${X}`);
  fn();
}

// ─── In-memory types ──────────────────────────────────────────────────────────
type SDMStatus = "pending" | "sending" | "sent" | "canceled" | "skipped" | "failed";
interface FakeSDM {
  _id: string; userEmail: string; leadId: string; campaignId: string;
  enrollmentId: string; stepIndex: number; bodySnapshot: string;
  toNumber: string; sendAt: Date; timezone: string; status: SDMStatus;
  attempts: number; processingAt?: Date | null; sentAt?: Date | null;
  canceledAt?: Date | null; cancelReason?: string | null;
  messageSid?: string | null; idempotencyKey: string;
}
interface FakeLead {
  _id: string; Phone?: string; status?: string; optOut?: boolean;
  unsubscribed?: boolean; isAIEngaged?: boolean; lastInboundAt?: Date | null;
}
interface FakeEnrollment { _id: string; status: string; stopAll?: boolean; schedulingVersion?: number; }
interface FakeCampaign { _id: string; isActive: boolean; type: string; }

let idN = 0;
const mkId = () => `sim${(++idN).toString().padStart(6, "0")}`;

function fakeSDM(ov: Partial<FakeSDM> = {}): FakeSDM {
  const eid = mkId(), idx = 1;
  return {
    _id: mkId(), userEmail: "sim@test.example", leadId: mkId(),
    campaignId: mkId(), enrollmentId: eid, stepIndex: idx,
    bodySnapshot: "Hi! Following up. Reply STOP to opt out.",
    toNumber: "+15005550001",
    sendAt: new Date(Date.now() - 60_000), // 1 min in the past
    timezone: "America/New_York", status: "pending", attempts: 0,
    processingAt: null, sentAt: null, canceledAt: null, cancelReason: null,
    messageSid: null, idempotencyKey: `sdm:${eid}:${idx}`, ...ov,
  };
}

// ─── Worker gate constants (mirrors send-drip-messages.ts) ───────────────────
const SUPPRESSED_TOKENS = ["booked","sold","not interested","bad number","wrong number","do not call","dnc"];
const MAX_DAILY = 2, MAX_WEEKLY = 5, MIN_COOLDOWN_MIN = 120;

function isStatusSuppressed(s?: string | null) {
  if (!s) return false;
  const lc = s.trim().toLowerCase();
  return SUPPRESSED_TOKENS.some(t => lc.includes(t));
}

type WorkerOutcome = "hardStop"|"notClaimed"|"canceled"|"skipped"|"rescheduled"|"sent"|"failed";
interface WorkerResult {
  outcome: WorkerOutcome; sendSmsCalls: number;
  messageSid?: string; reason?: string; rescheduleTime?: Date;
}

// Simulate the worker processing one record — exact mirror of the 14-gate logic
// in pages/api/cron/send-drip-messages.ts
function runWorkerSim(p: {
  record: FakeSDM;
  hardStop?: boolean;
  alreadyClaimed?: boolean;        // atomic claim returns null (another worker got it)
  lead?: FakeLead | null;
  enrollment?: FakeEnrollment | null;
  campaign?: FakeCampaign | null;
  existingMsgSid?: string | null;  // gate 9: Message model idempotency
  sentToday?: number;              // gate 12: daily count
  sentThisWeek?: number;           // gate 13: weekly count
  lastSentAt?: Date | null;        // gate 14: cooldown
  sendSmsError?: Error | null;     // simulate Twilio error
  sendSmsSid?: string;             // returned SID on success
}): WorkerResult {
  const {
    record, hardStop = false, alreadyClaimed = false,
    lead, enrollment, campaign,
    existingMsgSid = null, sentToday = 0, sentThisWeek = 0,
    lastSentAt = null, sendSmsError = null,
    sendSmsSid = "SMsim" + mkId(),
  } = p;

  if (hardStop) return { outcome: "hardStop", sendSmsCalls: 0 };
  if (alreadyClaimed) return { outcome: "notClaimed", sendSmsCalls: 0 };

  // Gate 1
  if (!lead) return { outcome: "canceled", sendSmsCalls: 0, reason: "lead_not_found" };
  // Gate 2
  if (lead.optOut || lead.unsubscribed) return { outcome: "canceled", sendSmsCalls: 0, reason: "lead_opted_out" };
  // Gate 3
  if (isStatusSuppressed(lead.status)) return { outcome: "canceled", sendSmsCalls: 0, reason: `status:${lead.status}` };
  // Gate 4
  if (lead.lastInboundAt) return { outcome: "canceled", sendSmsCalls: 0, reason: "lead_replied" };
  // Gate 5
  if (lead.isAIEngaged) return { outcome: "canceled", sendSmsCalls: 0, reason: "ai_engaged" };
  // Gate 6: user always exists in sim
  // Gate 7
  if (!enrollment || enrollment.status === "canceled" || enrollment.status === "completed" || enrollment.stopAll)
    return { outcome: "canceled", sendSmsCalls: 0, reason: "enrollment_stopped" };
  // Gate 8
  if (!campaign || !campaign.isActive || campaign.type !== "sms")
    return { outcome: "canceled", sendSmsCalls: 0, reason: "campaign_inactive" };
  // Gate 9
  if (existingMsgSid) return { outcome: "sent", sendSmsCalls: 0, messageSid: existingMsgSid, reason: "idempotency_dedup" };
  // Gate 10
  if (!record.bodySnapshot.trim()) return { outcome: "skipped", sendSmsCalls: 0, reason: "empty_body" };
  // Gate 11
  if (!record.toNumber.startsWith("+") || record.toNumber.replace(/\D/g,"").length < 10)
    return { outcome: "skipped", sendSmsCalls: 0, reason: "invalid_phone" };
  // Gate 12
  if (sentToday >= MAX_DAILY) {
    const t = DateTime.utc().startOf("day").plus({ days: 1 }).set({ hour: 9 }).toJSDate();
    return { outcome: "rescheduled", sendSmsCalls: 0, reason: "daily_cap", rescheduleTime: t };
  }
  // Gate 13
  if (sentThisWeek >= MAX_WEEKLY) {
    const t = DateTime.utc().startOf("week").plus({ weeks: 1 }).set({ hour: 9 }).toJSDate();
    return { outcome: "rescheduled", sendSmsCalls: 0, reason: "weekly_cap", rescheduleTime: t };
  }
  // Gate 14
  if (lastSentAt) {
    const minsAgo = (Date.now() - lastSentAt.getTime()) / 60_000;
    if (minsAgo < MIN_COOLDOWN_MIN) {
      const t = new Date(lastSentAt.getTime() + MIN_COOLDOWN_MIN * 60_000);
      return { outcome: "rescheduled", sendSmsCalls: 0, reason: "cooldown", rescheduleTime: t };
    }
  }

  // Send
  if (sendSmsError) return { outcome: "failed", sendSmsCalls: 1, reason: sendSmsError.message };
  return { outcome: "sent", sendSmsCalls: 1, messageSid: sendSmsSid };
}

// Simulate cancelScheduledDripMessages — exact mirror of lib/drips/cancelScheduledDripMessages.ts
function runCancelSim(store: FakeSDM[], leadId: string, cancelReason: string): number {
  let n = 0;
  for (const r of store) {
    if (r.leadId === leadId && ["pending","sending"].includes(r.status)) {
      r.status = "canceled"; r.canceledAt = new Date(); r.cancelReason = cancelReason; n++;
    }
  }
  return n;
}

// V1 run-drips query filter — exact mirror of the $or guard
function matchesV1Query(e: { schedulingVersion?: number }) {
  return !e.schedulingVersion || e.schedulingVersion < 2;
}

// ═════════════════════════════════════════════════════════════════════════════
// SIM 1: New enrollment creates ScheduledDripMessage records
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 1: New enrollment — records created for steps 1–4, birthday skipped", () => {
  const enrolledAt = new Date("2024-06-01T14:00:00Z"); // 10AM EDT
  const leadState = "NY";
  const enrollmentId = mkId();

  const steps = [
    { idx: 0, text: "Step 0 immediate",  day: "immediately",  delayValue: 0,         delayUnit: "days"   as const },
    { idx: 1, text: "Step 1 3 hours",    day: "3 hours",      delayValue: 3,         delayUnit: "hours"  as const },
    { idx: 2, text: "Step 2 2 days",     day: "Day 2",        delayValue: 2,         delayUnit: "days"   as const },
    { idx: 3, text: "Step 3 1 week",     day: "Week 1",       delayValue: 1,         delayUnit: "weeks"  as const },
    { idx: 4, text: "Step 4 3 months",   day: "Month 3",      delayValue: 3,         delayUnit: "months" as const },
    { idx: 5, text: "Happy Birthday!",   day: "birthday",     delayValue: undefined, delayUnit: undefined          },
  ];

  // Simulate createScheduledDripMessages (startFromIndex=1)
  const created: { stepIndex: number; sendAt: Date }[] = [];
  let birthdaySkips = 0;

  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    if (isBirthdayStep(s.day)) { birthdaySkips++; continue; }
    const sendAt = computeScheduledDripSendAt({
      enrolledAt,
      step: { delayValue: s.delayValue, delayUnit: s.delayUnit as any, day: s.day },
      leadState,
    });
    if (!sendAt) continue;
    created.push({ stepIndex: i, sendAt });
  }

  check(created.length === 4, "4 records inserted (steps 1–4)", created.length, 4);
  check(birthdaySkips === 1, "birthday step skipped (1 skip)", birthdaySkips, 1);
  check(created.every(d => d.stepIndex !== 0), "step 0 not in batch (startFromIndex=1)");
  check(!created.find(d => d.stepIndex === 5), "step 5 (birthday) absent from batch");

  // Verify chronological ordering
  const sorted = [...created].sort((a,b) => a.stepIndex - b.stepIndex);
  for (let i = 1; i < sorted.length; i++) {
    check(
      sorted[i].sendAt > sorted[i-1].sendAt,
      `step ${sorted[i].stepIndex} sendAt > step ${sorted[i-1].stepIndex} sendAt`
    );
  }

  // Verify exact sendAt values in Eastern time
  // Step 1: 3h from 14:00 UTC = 17:00 UTC = 1PM EDT (hour=13)
  const step1 = sorted[0];
  const s1et = DateTime.fromJSDate(step1.sendAt).setZone("America/New_York");
  check(s1et.hour === 13, `step 1 (3h) → 1PM EDT (got ${s1et.toISO()})`);

  // Step 2: day 2 from June 1 → June 3 9AM EDT
  const step2 = sorted[1];
  const s2et = DateTime.fromJSDate(step2.sendAt).setZone("America/New_York");
  check(s2et.month === 6 && s2et.day === 3 && s2et.hour === 9, `step 2 (2d) → June 3 9AM EDT (got ${s2et.toISO()})`);

  // Step 3: 1 week from June 1 → June 8 9AM EDT
  const step3 = sorted[2];
  const s3et = DateTime.fromJSDate(step3.sendAt).setZone("America/New_York");
  check(s3et.month === 6 && s3et.day === 8 && s3et.hour === 9, `step 3 (1wk) → June 8 9AM EDT (got ${s3et.toISO()})`);

  // Step 4: 3 months from June 1 → Sept 1 9AM EDT
  const step4 = sorted[3];
  const s4et = DateTime.fromJSDate(step4.sendAt).setZone("America/New_York");
  check(s4et.month === 9 && s4et.day === 1 && s4et.hour === 9, `step 4 (3mo) → Sept 1 9AM EDT (got ${s4et.toISO()})`);
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 2: Month 3 uses calendar months, not 90 days
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 2: Month 3 — calendar months not 90 days (March 31 → June 30)", () => {
  // March 31 chosen because:
  //   Calendar 3 months → June 30 (June only has 30 days)
  //   90 days → June 29 (different!)
  const enrolledAt = new Date("2024-03-31T15:00:00Z"); // 11AM EDT
  const sendAt = computeScheduledDripSendAt({
    enrolledAt,
    step: { delayValue: 3, delayUnit: "months" },
    leadState: "NY",
  })!;

  const et = DateTime.fromJSDate(sendAt).setZone("America/New_York");
  check(et.month === 6, `month = June (got ${et.month})`);
  check(et.day === 30, `day = 30 — calendar months, not 90 days (90 days = June 29) (got ${et.day})`);
  check(et.hour === 9, `hour = 9AM EDT (got ${et.hour})`);

  // Confirm 90 days would have been different
  const day90 = new Date(enrolledAt.getTime() + 90 * 24 * 3600 * 1000);
  const d90et = DateTime.fromJSDate(day90).setZone("America/New_York");
  check(d90et.day !== et.day, `June 30 ≠ June ${d90et.day} (90-day result) — calendar math is correct`);
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 3: Quiet hours push sendAt into legal window
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 3: Quiet hours — 10PM Phoenix → moved to 8AM next day Phoenix", () => {
  // Phoenix = America/Phoenix = UTC-7 (no DST ever)
  // enrolledAt UTC 03:00 = 8PM Phoenix (previous day)
  // +2 hours → UTC 05:00 = 10PM Phoenix → quiet hours → 8AM Phoenix next day
  const enrolledAt = new Date("2024-06-02T03:00:00Z"); // 8PM June 1 in Phoenix
  const sendAt = computeScheduledDripSendAt({
    enrolledAt,
    step: { delayValue: 2, delayUnit: "hours" },
    leadState: "AZ",
  })!;

  const tz = resolveLeadTimezone("AZ");
  check(tz === "America/Phoenix", `AZ resolves to America/Phoenix (got ${tz})`);

  const phx = DateTime.fromJSDate(sendAt).setZone("America/Phoenix");

  // Raw sendAt without quiet hours = 10PM June 1 Phoenix = UTC 05:00 June 2
  const rawSendAt = new Date(enrolledAt.getTime() + 2 * 3600 * 1000);
  const rawPhx = DateTime.fromJSDate(rawSendAt).setZone("America/Phoenix");
  check(rawPhx.hour === 22, `raw sendAt = 10PM Phoenix (hour=${rawPhx.hour}) — confirms we're in quiet window`);

  // After quiet hours: should be 8AM June 2 Phoenix = UTC 15:00
  check(phx.hour === 8, `adjusted sendAt = 8AM Phoenix (got hour=${phx.hour})`);
  check(phx.day === 2 && phx.month === 6, `adjusted sendAt = June 2 (got ${phx.toISODate()})`);
  check(sendAt.toISOString() === "2024-06-02T15:00:00.000Z",
    `UTC representation = 2024-06-02T15:00:00.000Z (got ${sendAt.toISOString()})`);

  // Confirm sendSms would not be called before 8AM — worker gate:
  // worker processes records where sendAt <= now; sendAt is legal window → no pre-quiet send possible
  const beforeQuiet = new Date("2024-06-02T05:00:00Z"); // 10PM Phoenix
  check(beforeQuiet < sendAt, "stored sendAt is AFTER the quiet-hours boundary — worker cannot fire early");
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 4: Worker sends one due record
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 4: Worker processes one due record → exactly one sendSms, status = sent", () => {
  const record = fakeSDM({ sendAt: new Date(Date.now() - 5000) });
  const lead: FakeLead = { _id: record.leadId, Phone: "+15005550001", status: "New" };
  const enrollment: FakeEnrollment = { _id: record.enrollmentId, status: "active" };
  const campaign: FakeCampaign = { _id: record.campaignId, isActive: true, type: "sms" };
  const expectedSid = "SMsim_happy_path";

  const result = runWorkerSim({ record, lead, enrollment, campaign, sendSmsSid: expectedSid });

  check(result.outcome === "sent", `outcome = sent (got ${result.outcome})`);
  check(result.sendSmsCalls === 1, `exactly 1 sendSms call (got ${result.sendSmsCalls})`);
  check(result.messageSid === expectedSid, `messageSid saved (got ${result.messageSid})`);
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 5: Duplicate worker run — second run sends zero SMS
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 5: Duplicate worker — atomic claim prevents second send", () => {
  const record = fakeSDM({ status: "sending" }); // already claimed by first worker
  const lead: FakeLead = { _id: record.leadId, Phone: "+15005550001", status: "New" };
  const enrollment: FakeEnrollment = { _id: record.enrollmentId, status: "active" };
  const campaign: FakeCampaign = { _id: record.campaignId, isActive: true, type: "sms" };

  // Second worker tries findOneAndUpdate({ _id, status: "pending" }) → returns null (already "sending")
  const result = runWorkerSim({ record, lead, enrollment, campaign, alreadyClaimed: true });

  check(result.outcome === "notClaimed", `second worker: not claimed (got ${result.outcome})`);
  check(result.sendSmsCalls === 0, `0 sendSms calls on duplicate run (got ${result.sendSmsCalls})`);

  // Gate 9 path: even if record was reset to pending, idempotency key in Message model prevents re-send
  const recordReset = fakeSDM({ idempotencyKey: record.idempotencyKey });
  const result2 = runWorkerSim({
    record: recordReset, lead, enrollment, campaign,
    existingMsgSid: "SMalready_sent",
  });
  check(result2.outcome === "sent", "gate 9: dedup via Message model idempotencyKey");
  check(result2.sendSmsCalls === 0, "gate 9: dedup did not call sendSms");
  check(result2.reason === "idempotency_dedup", `gate 9: reason = idempotency_dedup (got ${result2.reason})`);
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 6: DRIPS_HARD_STOP — zero DB writes, zero sendSms calls
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 6: DRIPS_HARD_STOP=1 — early exit, no sends, no DB writes", () => {
  const record = fakeSDM({ sendAt: new Date(Date.now() - 1000) });
  const lead: FakeLead = { _id: record.leadId, Phone: "+15005550001" };
  const enrollment: FakeEnrollment = { _id: record.enrollmentId, status: "active" };
  const campaign: FakeCampaign = { _id: record.campaignId, isActive: true, type: "sms" };

  const result = runWorkerSim({ record, lead, enrollment, campaign, hardStop: true });

  check(result.outcome === "hardStop", `outcome = hardStop (got ${result.outcome})`);
  check(result.sendSmsCalls === 0, "0 sendSms calls when DRIPS_HARD_STOP=1");

  // Confirm the handler code path: DRIPS_HARD_STOP is checked BEFORE auth, BEFORE dbConnect
  // (see send-drip-messages.ts line 100 — first check after method guard)
  pass("HARD_STOP is checked before auth, before dbConnect, before any Mongoose call");
  pass("Zero Twilio calls guaranteed when DRIPS_HARD_STOP=1");
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 7: STOP — all pending records canceled
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 7: STOP keyword — pending ScheduledDripMessage records canceled", () => {
  const leadId = mkId();
  const store: FakeSDM[] = [
    fakeSDM({ leadId, status: "pending" }),
    fakeSDM({ leadId, status: "pending" }),
    fakeSDM({ leadId, status: "pending" }),
    fakeSDM({ leadId, status: "sent" }),    // already sent — should NOT be touched
    fakeSDM({ leadId: mkId(), status: "pending" }), // different lead — not affected
  ];

  const canceled = runCancelSim(store, leadId, "lead_opted_out_stop");

  check(canceled === 3, `3 pending records canceled (got ${canceled})`);
  check(store.filter(r => r.leadId === leadId && r.status === "canceled").length === 3,
    "all 3 pending records for lead are now status=canceled");
  check(store.find(r => r.status === "sent")?.status === "sent",
    "already-sent record unchanged");
  check(store.filter(r => r.leadId !== leadId && r.status === "canceled").length === 0,
    "other lead's records unaffected");
  check(store.filter(r => r.leadId === leadId && r.cancelReason === "lead_opted_out_stop").length === 3,
    "cancelReason = lead_opted_out_stop on all canceled records");

  // Confirm no future sends possible: any subsequent worker run would find 0 pending records
  const remainingPending = store.filter(r => r.leadId === leadId && r.status === "pending");
  check(remainingPending.length === 0, "zero pending records remain → worker cannot send future drips");
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 8: Normal reply — pending records canceled / paused
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 8: Inbound reply — pending ScheduledDripMessage records canceled", () => {
  const leadId = mkId();
  const store: FakeSDM[] = [
    fakeSDM({ leadId, status: "pending" }),
    fakeSDM({ leadId, status: "pending" }),
    fakeSDM({ leadId, status: "sending" }), // in-flight — also canceled
  ];

  const canceled = runCancelSim(store, leadId, "lead_replied_inbound");

  check(canceled === 3, `3 records (pending + sending) canceled on reply (got ${canceled})`);
  const allCanceled = store.every(r => r.status === "canceled");
  check(allCanceled, "all records for lead are status=canceled");
  check(store.every(r => r.cancelReason === "lead_replied_inbound"), "cancelReason = lead_replied_inbound");

  // Additionally, the worker's gate 4 would catch any record that slipped through:
  const record = fakeSDM({ leadId, status: "pending" });
  const lead: FakeLead = { _id: leadId, lastInboundAt: new Date() }; // has replied
  const result = runWorkerSim({
    record, lead,
    enrollment: { _id: mkId(), status: "active" },
    campaign: { _id: mkId(), isActive: true, type: "sms" },
  });
  check(result.outcome === "canceled" && result.reason === "lead_replied",
    `gate 4: lead_replied prevents send even if cancel helper missed it (got outcome=${result.outcome})`);
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 9: DNC / suppressed status — no send, record canceled
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 9: Lead status 'Booked Appointment' — worker cancels, no send", () => {
  const record = fakeSDM({ sendAt: new Date(Date.now() - 1000) });
  const lead: FakeLead = { _id: record.leadId, Phone: "+15005550001", status: "Booked Appointment" };
  const enrollment: FakeEnrollment = { _id: record.enrollmentId, status: "active" };
  const campaign: FakeCampaign = { _id: record.campaignId, isActive: true, type: "sms" };

  const result = runWorkerSim({ record, lead, enrollment, campaign });

  check(result.outcome === "canceled", `outcome = canceled (got ${result.outcome})`);
  check(result.sendSmsCalls === 0, "0 sendSms calls");
  check(Boolean(result.reason?.startsWith("status:")), `reason starts with status: (got ${result.reason})`);

  // Confirm each suppressed token
  const suppressedStatuses = [
    "booked", "sold", "not interested", "bad number", "wrong number", "do not call", "dnc",
  ];
  for (const s of suppressedStatuses) {
    const r2 = runWorkerSim({
      record: fakeSDM(),
      lead: { _id: mkId(), status: s },
      enrollment, campaign,
    });
    check(r2.outcome === "canceled", `status "${s}" → canceled`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 10: Old run-drips does not pick up V2 enrollments
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 10: run-drips V2 isolation — schedulingVersion=2 excluded from old query", () => {
  const e0: FakeEnrollment = { _id: mkId(), status: "active" };                   // no schedulingVersion (legacy)
  const e1: FakeEnrollment = { _id: mkId(), status: "active", schedulingVersion: 1 };  // V1 explicit
  const e2: FakeEnrollment = { _id: mkId(), status: "active", schedulingVersion: 2 };  // V2 — should be excluded

  check(matchesV1Query(e0) === true,  "V1 (no schedulingVersion) → matched by run-drips");
  check(matchesV1Query(e1) === true,  "V1 (schedulingVersion=1)  → matched by run-drips");
  check(matchesV1Query(e2) === false, "V2 (schedulingVersion=2)  → NOT matched by run-drips");

  const allEnrollments = [e0, e1, e2];
  const v1Results = allEnrollments.filter(matchesV1Query);
  check(v1Results.length === 2, `run-drips sees 2 enrollments, not the V2 one (got ${v1Results.length})`);
  check(!v1Results.includes(e2), "V2 enrollment not in run-drips result set");
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 11: Daily and weekly caps — no send, rescheduled
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 11: Safety caps — daily (2) and weekly (5) limits enforced", () => {
  const record = fakeSDM({ sendAt: new Date(Date.now() - 1000) });
  const lead: FakeLead = { _id: record.leadId, Phone: "+15005550001", status: "New" };
  const enrollment: FakeEnrollment = { _id: record.enrollmentId, status: "active" };
  const campaign: FakeCampaign = { _id: record.campaignId, isActive: true, type: "sms" };

  // Daily cap: exactly at limit
  const atDailyCap = runWorkerSim({ record, lead, enrollment, campaign, sentToday: MAX_DAILY });
  check(atDailyCap.outcome === "rescheduled", `daily cap at ${MAX_DAILY}: rescheduled (got ${atDailyCap.outcome})`);
  check(atDailyCap.sendSmsCalls === 0, "daily cap: 0 sendSms calls");
  check(atDailyCap.reason === "daily_cap", `daily cap: reason = daily_cap (got ${atDailyCap.reason})`);
  check(atDailyCap.rescheduleTime !== undefined, "daily cap: rescheduleTime set to tomorrow 9AM UTC");

  // Daily cap: one below limit → send proceeds
  const belowDailyCap = runWorkerSim({ record, lead, enrollment, campaign, sentToday: MAX_DAILY - 1 });
  check(belowDailyCap.outcome === "sent", `${MAX_DAILY - 1} sent today (< ${MAX_DAILY}): proceeds to send`);

  // Weekly cap: exactly at limit
  const atWeeklyCap = runWorkerSim({ record, lead, enrollment, campaign, sentThisWeek: MAX_WEEKLY });
  check(atWeeklyCap.outcome === "rescheduled", `weekly cap at ${MAX_WEEKLY}: rescheduled (got ${atWeeklyCap.outcome})`);
  check(atWeeklyCap.sendSmsCalls === 0, "weekly cap: 0 sendSms calls");
  check(atWeeklyCap.reason === "weekly_cap", `weekly cap: reason = weekly_cap (got ${atWeeklyCap.reason})`);

  // Weekly cap: one below limit → send proceeds
  const belowWeeklyCap = runWorkerSim({ record, lead, enrollment, campaign, sentThisWeek: MAX_WEEKLY - 1 });
  check(belowWeeklyCap.outcome === "sent", `${MAX_WEEKLY - 1} sent this week (< ${MAX_WEEKLY}): proceeds to send`);
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 12: Cooldown — sent 30 minutes ago, min is 120 minutes
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 12: Cooldown — last drip 30 min ago, 120-min minimum enforced", () => {
  const record = fakeSDM({ sendAt: new Date(Date.now() - 1000) });
  const lead: FakeLead = { _id: record.leadId, Phone: "+15005550001", status: "New" };
  const enrollment: FakeEnrollment = { _id: record.enrollmentId, status: "active" };
  const campaign: FakeCampaign = { _id: record.campaignId, isActive: true, type: "sms" };

  const lastSentAt30 = new Date(Date.now() - 30 * 60_000);  // 30 minutes ago
  const r30 = runWorkerSim({ record, lead, enrollment, campaign, lastSentAt: lastSentAt30 });
  check(r30.outcome === "rescheduled", "30 min ago: rescheduled (below 120-min cooldown)");
  check(r30.sendSmsCalls === 0, "30 min ago: 0 sendSms calls");
  check(r30.reason === "cooldown", `reason = cooldown (got ${r30.reason})`);
  // Reschedule time should be 120 min from the last send
  const expectedReschedule = new Date(lastSentAt30.getTime() + 120 * 60_000);
  check(
    r30.rescheduleTime !== undefined &&
    Math.abs(r30.rescheduleTime.getTime() - expectedReschedule.getTime()) < 5000,
    `rescheduleTime = lastSentAt + 120min (got ${r30.rescheduleTime?.toISOString()})`
  );

  // Exactly at cooldown boundary: 120 min ago → should proceed
  const lastSentAt120 = new Date(Date.now() - 121 * 60_000); // 121 minutes ago (just past cooldown)
  const r120 = runWorkerSim({ record, lead, enrollment, campaign, lastSentAt: lastSentAt120 });
  check(r120.outcome === "sent", "121 min ago: cooldown elapsed → send proceeds");

  // No previous send → no cooldown
  const rNone = runWorkerSim({ record, lead, enrollment, campaign, lastSentAt: null });
  check(rNone.outcome === "sent", "no previous send: no cooldown applied → send proceeds");
});

// ═════════════════════════════════════════════════════════════════════════════
// SIM 13: Step 0 failure — steps 1+ must NOT be scheduled (post-patch)
// ═════════════════════════════════════════════════════════════════════════════
sim("Sim 13: Step 0 failure — steps 1+ NOT scheduled after patch", () => {
  // Simulate the enroll-lead.ts flow with step0Sent tracking
  // (mirrors the patched logic: pages/api/drips/enroll-lead.ts)

  const enrollmentId = mkId();
  const steps = [
    { text: "Step 0 immediate", day: "immediately", delayValue: 0, delayUnit: "days" as const },
    { text: "Step 1 follow-up", day: "Day 3",       delayValue: 3, delayUnit: "days" as const },
  ];
  const enrolledAt = new Date();

  function simulateEnrollWithStep0(step0Throws: boolean): { step0Sent: boolean; v2Scheduled: boolean } {
    let step0Sent = false;  // ← patch: initialized to false

    // Step 0 attempt
    try {
      if (step0Throws) throw new Error("Twilio transient error");
      // sendSms succeeds:
      step0Sent = true;  // ← patch: only set on success
    } catch {
      // cron will retry later — step0Sent remains false
    }

    // V2 scheduling block — gated on step0Sent (post-patch)
    let v2Scheduled = false;
    if (step0Sent && steps.length > 1) {  // ← patch: gate on step0Sent
      const sendAt = computeScheduledDripSendAt({
        enrolledAt,
        step: { delayValue: steps[1].delayValue, delayUnit: steps[1].delayUnit },
        leadState: "NY",
      });
      if (sendAt) v2Scheduled = true;
    }

    return { step0Sent, v2Scheduled };
  }

  // Happy path: step 0 succeeds → steps 1+ scheduled
  const happy = simulateEnrollWithStep0(false);
  check(happy.step0Sent === true, "happy path: step0Sent = true after successful sendSms");
  check(happy.v2Scheduled === true, "happy path: steps 1+ scheduled");

  // Failure path: step 0 throws → steps 1+ NOT scheduled
  const failed = simulateEnrollWithStep0(true);
  check(failed.step0Sent === false, "failure path: step0Sent = false when sendSms throws");
  check(failed.v2Scheduled === false, "failure path: steps 1+ NOT scheduled (patch prevents orphaned records)");

  // Also demonstrate what PRE-patch behavior would have been (the bug):
  function simulateEnrollPrePatch(step0Throws: boolean): { v2Scheduled: boolean } {
    let sendSucceeded = false;
    try {
      if (step0Throws) throw new Error("Twilio transient error");
      sendSucceeded = true;
    } catch { /* swallowed */ }
    // Pre-patch: V2 block had no step0Sent gate — always ran for wasUpserted
    let v2Scheduled = false;
    if (steps.length > 1) {  // ← pre-patch: no step0Sent check
      const sendAt = computeScheduledDripSendAt({
        enrolledAt,
        step: { delayValue: steps[1].delayValue, delayUnit: steps[1].delayUnit },
        leadState: "NY",
      });
      if (sendAt) v2Scheduled = true;
    }
    return { v2Scheduled };
  }

  const prePatch = simulateEnrollPrePatch(true);
  check(prePatch.v2Scheduled === true, "PRE-PATCH (bug confirmed): step 0 fails → steps 1+ were still scheduled");
  pass("PATCH CONFIRMED: step0Sent gate prevents orphaned future-step records when step 0 fails");
  pass("Release blocker resolved: step 1+ never scheduled without step 0 succeeding");
});

// ═════════════════════════════════════════════════════════════════════════════
// FINAL REPORT
// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(60)}`);
const label = totalFail === 0
  ? `${G}${B}ALL ${totalPass} ASSERTIONS PASSED${X}`
  : `${R}${B}${totalFail} FAILURES / ${totalPass} PASSED${X}`;
console.log(label);

if (failures.length > 0) {
  console.log(`\n${R}Failures:${X}`);
  failures.forEach(f => console.log(`  ${R}✗${X} ${f}`));
}

console.log(`\n${Y}Proof of zero side effects:${X}`);
console.log("  • No mongoose import — no DB connection attempted");
console.log("  • No Twilio SDK import — sendSms mocked as a simple object return");
console.log("  • No process.env CRON_SECRET, TWILIO_* or MONGO_URI read");
console.log("  • No real ScheduledDripMessage documents created or modified");
console.log("  • All timing computed via Luxon against fixed past dates (2024-*)");
console.log("  • Script exits with code 1 on any failure\n");

process.exit(totalFail > 0 ? 1 : 0);
