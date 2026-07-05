import fs from "fs";
import path from "path";

type IntervalKind =
  | "ai_meter"
  | "openai_socket"
  | "human_audio"
  | "human_customer_billing"
  | "manual_customer_billing";

type Interval = {
  kind: IntervalKind;
  start: number;
  end: number;
  note: string;
};

type Scenario = {
  name: string;
  intervals: Interval[];
  expectations: { label: string; pass: boolean; observed: string; refs: string[]; fix?: string }[];
};

const root = process.cwd();

function ref(file: string, needle: string) {
  const abs = path.join(root, file);
  const text = fs.readFileSync(abs, "utf8");
  const idx = text.indexOf(needle);
  if (idx < 0) return `${file}:?`;
  const line = text.slice(0, idx).split(/\r?\n/).length;
  return `${file}:${line}`;
}

const refs = {
  transferSetsInProgress: ref("ai-voice-server/index.ts", "state.transferInProgress = true;"),
  transferClosesOpenAi: ref("ai-voice-server/index.ts", 'safelyCloseOpenAi(state, "live transfer redirect");'),
  openAiCloseLeavesCall: ref("ai-voice-server/index.ts", "Live-transfer: Twilio call is now in agent hands"),
  handleStopBillsVendorOnly: ref("ai-voice-server/index.ts", "await billAiDialerUsageForCall(state);"),
  wsCloseBillsVendorOnly: ref("ai-voice-server/index.ts", "billAiDialerUsageForCall(st).catch"),
  usageEndpointNoop: ref("pages/api/ai-calls/usage.ts", "billing no-op"),
  sessionMeterWatchdog: ref("pages/api/ai-calls/watchdog.ts", "trackAiDialerSessionUsage({ sessionId: sessId, userEmail: sessEmail });"),
  sessionFinalMeter: ref("pages/api/ai-calls/watchdog.ts", "trackAiDialerSessionUsage({ sessionId: sessId, userEmail: sessEmail, endAt });"),
  explicitStopMeter: ref("pages/api/ai-calls/session.ts", "await trackAiDialerSessionUsage({"),
  sessionMeterMath: ref("lib/billing/trackAiDialerSessionUsage.ts", "const totalElapsedSeconds = Math.floor"),
  transferAgentLegCreate: ref("pages/api/ai-calls/transfer-twiml.ts", "await client.calls.create(agentCallOptions);"),
  transferAgentStatusCallback: ref("pages/api/ai-calls/transfer-twiml.ts", "statusCallback: amdCallbackUrl.toString(),"),
  agentBridgeConference: ref("pages/api/ai-calls/agent-bridge-twiml.ts", "<Conference beep=\"false\""),
  fallbackRebootConnect: ref("pages/api/ai-calls/transfer-fallback.ts", "transferRebootPending in DB"),
  rebootTwimlStream: ref("pages/api/ai-calls/transfer-reboot-twiml.ts", "<Stream url="),
  amdMarksReboot: ref("pages/api/ai-calls/agent-amd-callback.ts", "transferRebootPending: true"),
  manualBillingDetect: ref("pages/api/twilio/voice-status.ts", 'updatedBillingCategory === "manual_dial"'),
  manualBillingMinutes: ref("pages/api/twilio/voice-status.ts", "const mins = ceilMinutesFromSeconds(seconds);"),
};

function overlap(a: Interval, b: Interval) {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}

function anyOverlap(intervals: Interval[], a: IntervalKind, b: IntervalKind) {
  return intervals.some((x) => x.kind === a && intervals.some((y) => y.kind === b && overlap(x, y)));
}

function windows(intervals: Interval[], kind: IntervalKind) {
  return intervals.filter((i) => i.kind === kind);
}

function fmt(t: number) {
  return `${t.toFixed(1)}s`;
}

function fmtIntervals(intervals: Interval[]) {
  return intervals
    .map((i) => `${i.kind} ${fmt(i.start)}-${fmt(i.end)} (${i.note})`)
    .join("; ");
}

function hasBillingGapDuringAiSession(intervals: Interval[]) {
  const ai = windows(intervals, "ai_meter");
  const active = intervals.filter((i) => i.kind === "openai_socket" || i.kind === "human_audio");
  return ai.some((meter) => {
    const cuts = [meter.start, meter.end, ...active.flatMap((i) => [i.start, i.end])].filter(
      (t) => t >= meter.start && t <= meter.end,
    ).sort((a, b) => a - b);
    for (let i = 0; i < cuts.length - 1; i++) {
      const mid = (cuts[i] + cuts[i + 1]) / 2;
      if (cuts[i] === cuts[i + 1]) continue;
      const covered = active.some((w) => w.start <= mid && mid < w.end);
      if (!covered) return true;
    }
    return false;
  });
}

function successfulTransfer(): Scenario {
  const intervals: Interval[] = [
    { kind: "ai_meter", start: 0, end: 190, note: "session wall-clock bills until call/session terminal" },
    { kind: "openai_socket", start: 0, end: 64.5, note: "closed on live transfer redirect" },
    { kind: "human_audio", start: 70, end: 190, note: "agent joins conference and talks to lead" },
  ];
  return {
    name: "1. Successful transfer",
    intervals,
    expectations: [
      {
        label: "AI dial-time meter stops at transfer",
        pass: false,
        observed: "AI session meter remains running until the transferred call ends.",
        refs: [refs.transferClosesOpenAi, refs.sessionMeterWatchdog, refs.sessionFinalMeter, refs.sessionMeterMath],
        fix: "Checkpoint/stop AI session billing at transfer redirect time, before the agent/customer conversation begins.",
      },
      {
        label: "OpenAI socket closes",
        pass: true,
        observed: "OpenAI is closed immediately after successful Twilio redirect.",
        refs: [refs.transferClosesOpenAi, refs.openAiCloseLeavesCall],
      },
      {
        label: "Human talk-time customer billing starts",
        pass: false,
        observed: "The agent leg uses agent-amd-callback/agent-bridge TwiML; no manual_dial billingCategory or voice-status billing callback is attached.",
        refs: [refs.transferAgentStatusCallback, refs.agentBridgeConference, refs.manualBillingDetect],
        fix: "Add a dedicated transfer-human billing callback/record keyed by callSid or conference, using final Twilio duration and only after AI billing has stopped.",
      },
      {
        label: "No AI-meter dead window and no overlap",
        pass: !hasBillingGapDuringAiSession(intervals) && !anyOverlap(intervals, "ai_meter", "human_audio"),
        observed: "There is a dead meter window from redirect to agent join, then overlap for the whole human conversation.",
        refs: [refs.transferSetsInProgress, refs.transferClosesOpenAi],
        fix: "Pause/stop AI metering at transfer redirect; start human billing only when the agent joins.",
      },
    ],
  };
}

function agentNoAnswer(): Scenario {
  const intervals: Interval[] = [
    { kind: "ai_meter", start: 0, end: 130, note: "same AI session keeps billing across failed transfer and reboot" },
    { kind: "openai_socket", start: 0, end: 64.5, note: "initial stream closes on redirect" },
    { kind: "openai_socket", start: 82, end: 130, note: "reboot stream after agent no-answer" },
  ];
  return {
    name: "2. Agent no-answer",
    intervals,
    expectations: [
      {
        label: "AI meter handles no-answer without dead-air billing",
        pass: false,
        observed: "The wall-clock session meter continues during the no-answer/reboot gap when no OpenAI stream is active.",
        refs: [refs.amdMarksReboot, refs.fallbackRebootConnect, refs.rebootTwimlStream, refs.sessionMeterMath],
        fix: "Pause AI session metering during transfer attempt gaps; resume only when the reboot stream starts.",
      },
      {
        label: "Socket closes and session does not stick forever",
        pass: true,
        observed: "Initial socket closes on redirect; reboot stream later closes on Twilio stop/close.",
        refs: [refs.transferClosesOpenAi, refs.handleStopBillsVendorOnly],
      },
    ],
  };
}

function agentImmediateHangup(): Scenario {
  const intervals: Interval[] = [
    { kind: "ai_meter", start: 0, end: 72, note: "session still meters through short transferred call" },
    { kind: "openai_socket", start: 0, end: 64.5, note: "closed on redirect" },
    { kind: "human_audio", start: 70, end: 72, note: "agent joins then hangs up" },
  ];
  return {
    name: "3. Agent hangs up immediately after joining",
    intervals,
    expectations: [
      {
        label: "Billing stops cleanly with no stuck meter",
        pass: false,
        observed: "The session can finish when Twilio terminal status arrives, but AI billing overlaps the human join window and human billing is absent.",
        refs: [refs.sessionFinalMeter, refs.agentBridgeConference, refs.transferAgentStatusCallback],
        fix: "Use explicit handoff billing state: stop AI at redirect/join, start and stop human billing on the agent/client connected interval.",
      },
    ],
  };
}

function clientHangsUpMidTransfer(): Scenario {
  const intervals: Interval[] = [
    { kind: "ai_meter", start: 0, end: 66, note: "final billed session duration if Twilio terminal arrives" },
    { kind: "openai_socket", start: 0, end: 64.5, note: "closed on redirect" },
  ];
  return {
    name: "4. Client hangs up mid-transfer",
    intervals,
    expectations: [
      {
        label: "Nothing runs after client hangup",
        pass: true,
        observed: "With a Twilio stop/terminal callback, OpenAI is closed and final session billing ends at the hangup.",
        refs: [refs.transferClosesOpenAi, refs.handleStopBillsVendorOnly, refs.sessionFinalMeter],
      },
      {
        label: "Only real-phone timing remains unproven",
        pass: true,
        observed: "The simulation assumes Twilio sends stop/terminal promptly when the lead hangs up during redirect.",
        refs: [refs.wsCloseBillsVendorOnly, refs.handleStopBillsVendorOnly],
      },
    ],
  };
}

function rebootFallback(): Scenario {
  const intervals: Interval[] = [
    { kind: "ai_meter", start: 0, end: 150, note: "one wall-clock session across initial AI and reboot AI" },
    { kind: "openai_socket", start: 0, end: 64.5, note: "initial AI window" },
    { kind: "openai_socket", start: 82, end: 150, note: "intended second AI/rebooking window" },
  ];
  return {
    name: "5. Reboot/fallback transfer path",
    intervals,
    expectations: [
      {
        label: "Second AI window is intentional and closes",
        pass: true,
        observed: "transferRebootPending routes the lead to a new <Connect><Stream> with rebookingMode=true.",
        refs: [refs.amdMarksReboot, refs.fallbackRebootConnect, refs.rebootTwimlStream],
      },
      {
        label: "Second AI window is metered correctly without gap billing",
        pass: false,
        observed: "The single wall-clock session meter bills the gap between the initial stream close and reboot stream start.",
        refs: [refs.sessionMeterMath, refs.sessionMeterWatchdog],
        fix: "Track billable AI stream segments or pause/resume the session meter across transfer attempts.",
      },
    ],
  };
}

function doubleBillCheck(): Scenario {
  const intervals = [
    ...successfulTransfer().intervals,
    ...rebootFallback().intervals.map((i) => ({ ...i, start: i.start + 300, end: i.end + 300 })),
  ];
  return {
    name: "6. Double-bill check across paths",
    intervals,
    expectations: [
      {
        label: "AI and human meters never bill same seconds",
        pass: false,
        observed: "Successful-transfer path has AI session metering over the human conversation window. Human customer billing is absent today, but adding it without stopping AI first would double-bill.",
        refs: [refs.transferClosesOpenAi, refs.sessionMeterMath, refs.agentBridgeConference],
        fix: "Enforce a handoff invariant: AI billable segment ends before any transfer-human billable segment can start.",
      },
      {
        label: "Same AI seconds cannot bill twice",
        pass: true,
        observed: "trackAiDialerSessionUsage uses billedSeconds as an optimistic lock/checkpoint for one session meter.",
        refs: [refs.sessionMeterMath, ref("lib/billing/trackAiDialerSessionUsage.ts", "billedSeconds: alreadyBilledSeconds")],
      },
    ],
  };
}

function simultaneousManualAndAi(): Scenario {
  const intervals: Interval[] = [
    { kind: "ai_meter", start: 0, end: 120, note: "AI session A" },
    { kind: "manual_customer_billing", start: 30, end: 95, note: "independent manual call B with separate callSid/manual_dial PSTN leg" },
  ];
  return {
    name: "7. Simultaneous manual + AI session",
    intervals,
    expectations: [
      {
        label: "Transfer in AI session does not corrupt unrelated manual billing",
        pass: true,
        observed: "Manual billing keys off manual_dial/pstn Call records; AI session billing keys off AICallSession sessionId/billedSeconds.",
        refs: [refs.manualBillingDetect, refs.manualBillingMinutes, refs.sessionMeterMath],
      },
    ],
  };
}

const scenarios = [
  successfulTransfer(),
  agentNoAnswer(),
  agentImmediateHangup(),
  clientHangsUpMidTransfer(),
  rebootFallback(),
  doubleBillCheck(),
  simultaneousManualAndAi(),
];

let fails = 0;
console.log("LIVE TRANSFER BILLING SIMULATION (fake state only; no network, DB, Twilio, OpenAI, or Stripe)");
console.log("");
for (const scenario of scenarios) {
  console.log(scenario.name);
  console.log(`  timeline: ${fmtIntervals(scenario.intervals)}`);
  for (const exp of scenario.expectations) {
    if (!exp.pass) fails++;
    console.log(`  ${exp.pass ? "PASS" : "FAIL"} - ${exp.label}`);
    console.log(`    observed: ${exp.observed}`);
    console.log(`    refs: ${exp.refs.join(", ")}`);
    if (exp.fix) console.log(`    smallest fix: ${exp.fix}`);
  }
  console.log("");
}

console.log(`RESULT: ${fails === 0 ? "PASS" : "FAIL"} (${fails} failing expectation${fails === 1 ? "" : "s"})`);
if (fails > 0) {
  process.exitCode = 1;
}
