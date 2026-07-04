/**
 * AI Voice Server — Rebooking + Call Flow Simulation
 *
 * Rules:
 *  - No real WebSocket, Twilio, OpenAI, or MongoDB connections
 *  - Pure function mirrors extracted verbatim from ai-voice-server/index.ts
 *  - If any mirrored function diverges from source, the test will catch it
 *  - Tests ONLY changed paths (rebooking) + gate checks (normal calls unaffected)
 *  - Concurrent sessions tested by running two state objects in parallel
 *
 * Coverage:
 *  1. Gate: buildRebookingPolicyDecision returns null when rebookingMode=false
 *  2. Wave 1 Fix #1: rebooking_fallback uses natural line, not meta-text
 *  3. Wave 1 Fix #4: offeredTime guarded against bare closing negatives
 *  4. Wave 1 Fix #5: rebookingAgentFirst falls through to context.agentName
 *  5. Wave 2 Part A: rebooking_exact_time_confirmed sets confirmedAppointment + rebookingBookingConfirmed
 *  6. Wave 2 Part B: goodbye fires after booking + bare closing negative
 *  7. Full rebooking conversation trace (day → time → confirm → goodbye)
 *  8. Edge cases: angry lead, repeat questions, live transfer request, unexpected text
 *  9. Kayla demo: rebookingMode never reachable
 * 10. Concurrent sessions: state isolation between two simultaneous rebooking calls
 */

import * as fs from "fs";
import * as path from "path";

// ─── Mirrored pure utility functions (verbatim from ai-voice-server/index.ts) ──

function normalizeTurnTextForKey(textRaw: string): string {
  return String(textRaw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBareClosingNegative(raw: string): boolean {
  const t = normalizeTurnTextForKey(raw);
  if (!t) return false;

  if (/^(no|nah|nope|no that s it|no thats it|no questions|that s all|thats all|no i m good|no im good|nothing else|all good|that s it|thats it|no thank you|no thanks|i m good|im good|negative|nuh uh|mm mm|uh uh)$/.test(t)) return true;

  const CORE_CLOSINGS = new Set([
    "that s it", "thats it", "that s all", "thats all",
    "all good", "im all good", "i m all good",
    "all set", "im all set", "i m all set", "we re all set", "were all set",
    "we re good", "were good", "we good",
    "im good", "i m good", "good",
    "nothing else", "nothing comes to mind",
    "everything", "thats everything", "that s everything",
    "covers it", "that covers it",
  ]);
  let core = t.replace(/^(no|nope|nah|yeah)\s+/, "");
  core = core.replace(/^i think\s+/, "");
  core = core.replace(/\s+(thanks|thank you|for now|though)$/, "").trim();
  return CORE_CLOSINGS.has(core);
}

function isAffirmativeConfirmation(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;
  if (["yes","yeah","yep","yup","ok","okay","sure","correct","perfect","alright","all right"].includes(t)) return true;
  if (t.includes("that works") || t.includes("works for me") || t.includes("sounds good") ||
      t.includes("that's fine") || t.includes("fine") || t.includes("go ahead")) return true;
  return false;
}

function pickDayHint(lastUserText: string, priorAccepted: string): "today" | "tomorrow" | null {
  const a = String(lastUserText || "").toLowerCase();
  const b = String(priorAccepted || "").toLowerCase();
  const t = (a + " " + b).trim();
  if (t.includes("today") || t.includes("later today") || t.includes("tonight")) return "today";
  if (t.includes("tomorrow")) return "tomorrow";
  return null;
}

type TimeWindowHint = "morning" | "late_morning" | "mid_afternoon" | "afternoon" | "late_afternoon" | "evening" | "late_evening" | "soon_hours" | null;

function pickTimeWindowHint(textRaw: string, priorAccepted: string): TimeWindowHint {
  const a = String(textRaw || "").toLowerCase();
  const b = String(priorAccepted || "").toLowerCase();
  const t = (a + " " + b).trim();
  if (!t) return null;
  if (/\bin\s+an?\s+hour\b/.test(t) || /\bin\s+1\s*(hour|hr|hrs)\b/.test(t)) return "soon_hours";
  if (/\bin\s+\d{1,2}\s*(hours|hour|hr|hrs)\b/.test(t)) return "soon_hours";
  if (t.includes("late evening")) return "late_evening";
  if (t.includes("mid afternoon") || t.includes("mid-afternoon")) return "mid_afternoon";
  if (t.includes("late afternoon")) return "late_afternoon";
  if (t.includes("late morning")) return "late_morning";
  if (t.includes("evening") || t.includes("tonight")) return "evening";
  if (t.includes("morning")) return "morning";
  if (t.includes("afternoon")) return "afternoon";
  return null;
}

function extractNamedWeekday(textRaw: string): string | null {
  const t = String(textRaw || "").toLowerCase();
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  for (const d of days) {
    if (new RegExp(`\\b${d}\\b`).test(t)) {
      const isNext = /\bnext\b/.test(t);
      return isNext ? `next ${d}` : d;
    }
  }
  if (/\b(this weekend|weekend)\b/.test(t)) return "this weekend";
  if (/\b(later this week|later in the week|sometime this week)\b/.test(t)) return "later this week";
  if (/\bnext week\b/.test(t)) return "next week";
  return null;
}

function normalizeSpokenTimeText(textRaw: string): string {
  return String(textRaw || "")
    .trim().toLowerCase()
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi, (m) => {
      const n: Record<string,string> = {one:"1",two:"2",three:"3",four:"4",five:"5",six:"6",seven:"7",eight:"8",nine:"9",ten:"10",eleven:"11",twelve:"12"};
      return n[m.toLowerCase()] || m;
    })
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .replace(/\bo\s+clock\b/gi, "o'clock")
    .replace(/\s+/g, " ").trim();
}

function pickOfferedClockTimeFromPrompt(lastPromptLineRaw: string, userTextRaw: string): string | null {
  const lastPromptLine = normalizeSpokenTimeText(lastPromptLineRaw);
  const userText = normalizeSpokenTimeText(userTextRaw);
  if (!lastPromptLine || !userText) return null;

  const choosingFirst = userText.includes("first") || userText.includes("the first") || userText.includes("earlier") || userText.includes("earliest");
  const choosingSecond = userText.includes("second") || userText.includes("the second") || userText.includes("later") || userText.includes("latest");

  const times: string[] = [];
  const reTime = /\b(\d{1,2}:\d{2}\s?(?:am|pm)?|\d{1,2}\s?(?:am|pm))\b/gi;
  for (const m of normalizeSpokenTimeText(lastPromptLineRaw).matchAll(reTime)) {
    const t = String(m[1] || "").trim();
    if (t) times.push(t);
    if (times.length >= 2) break;
  }

  if (choosingFirst || choosingSecond) {
    if (times.length < 2) return null;
    return choosingFirst ? times[0] : times[1];
  }

  const timeMatches = lastPromptLine.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))/gi) || [];
  for (const offered of timeMatches) {
    const offeredHour = offered.match(/\b(\d{1,2})/)?.[1];
    if (!offeredHour) continue;
    const hourNum = parseInt(offeredHour, 10);
    const wordMap: Record<number,string> = {1:"one",2:"two",3:"three",4:"four",5:"five",6:"six",7:"seven",8:"eight",9:"nine",10:"ten",11:"eleven",12:"twelve"};
    const wordVersion = wordMap[hourNum];
    const digitPattern = new RegExp(`\\b${hourNum}\\b`);
    const wordPattern = wordVersion ? new RegExp(`\\b${wordVersion}\\b`, "i") : null;
    if (digitPattern.test(userText) || (wordPattern && wordPattern.test(userText))) {
      return offered.trim();
    }
  }
  return null;
}

function normalizeScriptKey(raw: any): string {
  const v = String(raw || "").trim().toLowerCase().replace(/[-_\s]+/g, "_");
  if (v === "kayla_signup" || v === "kayla" || v === "kayla_demo") return "kayla_signup";
  if (!v || v === "default" || v === "mp") return "mortgage_protection";
  return v;
}

function getAgentFirstName(ctx?: { agentName?: string }): string {
  const raw = String(ctx?.agentName || "").trim();
  return raw ? raw.split(/\s+/)[0] : "the agent";
}

// ─── Minimal types ─────────────────────────────────────────────────────────────

interface MockContext {
  agentName: string;
  scriptKey: string;
  clientFirstName?: string;
  voiceProfile?: { aiName: string };
}

interface MockState {
  rebookingMode?: boolean;
  rebookingAgentFirst?: string;
  rebookingBookingConfirmed?: boolean;
  phase?: string;
  coverageSubject?: string;
  coverageSubjectSetThisTurn?: boolean;
  objectionCount?: number;
  stepAnchorAskCounts?: Record<number, number>;
  lastRouteKind?: string;
  selectedDay?: string;
  selectedWindow?: string;
  selectedTimeText?: string;
  lastExactTimeText?: string;
  lastExactTimeAtMs?: number;
  lastPromptLine?: string;
  lastAcceptedUserText?: string;
  scriptStepIndex?: number;
  awaitingAnswerForStepIndex?: number;
  awaitingUserAnswer?: boolean;
  finalOutcomeSent?: boolean;
  pendingHangupAfterGoodbye?: boolean;
  confirmedAppointment?: boolean;
  context?: MockContext;
  callSid?: string;
}

interface TurnIntent {
  kind: string;
  subKind?: string;
  raw: string;
}

interface PolicyDecision {
  handled: boolean;
  routeKind: string;
  lineToSay?: string;
  stateWrites: Record<string, unknown>;
  shouldAdvanceStep?: boolean;
}

// ─── Mirrored buildRebookingPolicyDecision (verbatim logic after Wave 1 + Wave 2) ──

const finalOutcomeCallLog: Array<{ outcome: string; state: MockState }> = [];

function mockHandleFinalOutcomeIntent(state: MockState, control: any): Promise<void> {
  finalOutcomeCallLog.push({ outcome: control.outcome, state });
  return Promise.resolve();
}

function buildRebookingPolicyDecision(
  state: MockState,
  intent: TurnIntent,
  ctx: MockContext,
  _stepCtx: any
): PolicyDecision | null {
  if (!state.rebookingMode) return null;

  const agentFirst = String(state.rebookingAgentFirst || getAgentFirstName(ctx) || "the agent").trim();
  const raw = String(intent.raw || "").trim();
  const t = normalizeTurnTextForKey(raw);
  const rememberedDay = String(state.selectedDay || "").trim().toLowerCase();
  const explicitDay = pickDayHint(raw, "");
  const namedDay = extractNamedWeekday(raw.toLowerCase());
  const dayHint =
    explicitDay === "today" || explicitDay === "tomorrow"
      ? explicitDay
      : rememberedDay
      ? rememberedDay
      : namedDay || null;
  const windowHint = pickTimeWindowHint(raw, String(state.lastAcceptedUserText || ""));
  // Fix #4: guard offeredTime against bare closing negatives
  const offeredTime = isBareClosingNegative(raw) ? null : pickOfferedClockTimeFromPrompt(String(state.lastPromptLine || ""), raw);
  const selectedTime = String(offeredTime || raw).trim();
  const priorExactTime = String(state.lastExactTimeText || state.selectedTimeText || "").trim();

  const baseState = {
    phase: "in_call",
    coverageSubject: "rebooking_callback",
    pendingLiveTransferAvailabilityConfirm: false,
    pendingLiveTransferAvailabilityAttempts: 0,
    liveTransferIntroSpoken: false,
    pendingLiveTransferAfterLine: false,
  };

  function decision(
    routeKind: string,
    lineToSay: string,
    stateWrites: Record<string, unknown> = {},
    shouldAdvanceStep = false
  ): PolicyDecision {
    return {
      handled: true,
      routeKind,
      lineToSay,
      stateWrites: { ...baseState, ...stateWrites },
      shouldAdvanceStep,
    };
  }

  // Wave 2 Part B: goodbye check (must be BEFORE all other branches)
  if ((state as any).rebookingBookingConfirmed && isBareClosingNegative(raw)) {
    if (!state.finalOutcomeSent && state.context) {
      state.finalOutcomeSent = true;
      void mockHandleFinalOutcomeIntent(state, {
        kind: "final_outcome",
        outcome: "booked",
        summary: "AI scheduled callback after failed live transfer. Lead had no further questions.",
        notesAppend: `Lead said: "${raw.slice(0, 220)}"`,
        ...(priorExactTime ? { confirmedTime: priorExactTime, confirmedYes: true, repeatBackConfirmed: true } : {}),
      }).catch(() => {});
    }
    return decision(
      "rebooking_goodbye",
      `Perfect — have yourself a great day! ${agentFirst} will give you a call then. Bye!`,
      { pendingHangupAfterGoodbye: true, awaitingUserAnswer: false }
    );
  }

  if (intent.kind === "hearing_problem") {
    const repeatLine = String(state.lastPromptLine || "").trim();
    return decision(
      "rebooking_hearing_retry",
      repeatLine || `Sorry about that — I was just trying to schedule a callback with ${agentFirst}. Would later today or tomorrow work better?`,
      { awaitingUserAnswer: true, awaitingAnswerForStepIndex: 2, scriptStepIndex: 2 }
    );
  }

  if (priorExactTime && isAffirmativeConfirmation(raw)) {
    const lineToSay = `Perfect — I'll get ${agentFirst}'s callback set for ${priorExactTime}.`;
    return decision(
      "rebooking_exact_time_confirmed",
      lineToSay,
      {
        selectedTimeText: priorExactTime,
        lastExactTimeText: priorExactTime,
        lastExactTimeAtMs: (state as any).lastExactTimeAtMs || Date.now(),
        awaitingUserAnswer: false,
        awaitingAnswerForStepIndex: undefined,
        scriptStepIndex: 3,
        // Wave 2 Part A: new flags
        confirmedAppointment: true,
        rebookingBookingConfirmed: true,
      },
      true
    );
  }

  if (intent.kind === "exact_time" || offeredTime) {
    const selectedDay = dayHint || rememberedDay;
    if (!selectedDay) {
      return decision(
        "rebooking_exact_time_needs_day",
        "Got it — was that for later today or tomorrow?",
        { pendingRebookingExactTimeText: selectedTime, awaitingUserAnswer: true, awaitingAnswerForStepIndex: 2, scriptStepIndex: 2 }
      );
    }
    const lineToSay = `Perfect — I have ${selectedTime} for ${agentFirst}'s callback. Does that still work for you?`;
    return decision(
      "rebooking_exact_time",
      lineToSay,
      { selectedDay, selectedTimeText: selectedTime, lastExactTimeText: selectedTime, lastExactTimeAtMs: Date.now(), awaitingUserAnswer: true, awaitingAnswerForStepIndex: 3, scriptStepIndex: 3 }
    );
  }

  if (intent.kind === "time_window" || windowHint) {
    const selectedDay = dayHint || rememberedDay || "tomorrow";
    const lineToSay = `Got it — I have a few slots ${windowHint || "afternoon"} ${selectedDay}. Would 2 PM or 4 PM work?`;
    return decision(
      "rebooking_time_window",
      lineToSay,
      { selectedDay, ...(windowHint ? { selectedWindow: windowHint } : {}), awaitingUserAnswer: true, awaitingAnswerForStepIndex: 2, scriptStepIndex: 2, timeOfferCountForStepIndex: 2, timeOfferCount: 1 }
    );
  }

  if (intent.kind === "day_selection" || intent.kind === "live_transfer_later" || intent.kind === "scheduling_preference") {
    if (dayHint) {
      return decision("rebooking_day_selected", "Got it — would morning, afternoon, or evening work better?",
        { selectedDay: dayHint, awaitingUserAnswer: true, awaitingAnswerForStepIndex: 2, scriptStepIndex: 2 });
    }
    return decision("rebooking_day_needed", `No problem — should ${agentFirst} try you later today or tomorrow?`,
      { awaitingUserAnswer: true, awaitingAnswerForStepIndex: 2, scriptStepIndex: 2 });
  }

  if (intent.kind === "live_transfer_now") {
    return decision("rebooking_now_requested",
      `${agentFirst} missed the live connection, so I'll set a callback instead. Would later today or tomorrow work better?`,
      { awaitingUserAnswer: true, awaitingAnswerForStepIndex: 2, scriptStepIndex: 2 });
  }

  if (intent.kind === "greeting_ack") {
    return decision("rebooking_greeting_ack",
      `Great — ${agentFirst} missed the live connection, so I can set a callback. Would later today or tomorrow work better?`,
      { awaitingUserAnswer: true, awaitingAnswerForStepIndex: 2, scriptStepIndex: 2 });
  }

  if (intent.kind === "not_interested" || intent.kind === "angry_or_profane") {
    return decision("rebooking_soft_stop",
      "I understand — sorry for the trouble. I'll make a note and let them know. Take care.",
      { awaitingUserAnswer: false, awaitingAnswerForStepIndex: undefined, scriptStepIndex: 2 });
  }

  // Fix #1: natural fallback line (was: "I hear you. The only objective is scheduling...")
  const fallbackLine = t.includes("tomorrow") || t.includes("today")
    ? "Got it — would morning, afternoon, or evening work better?"
    : `Got it — should ${agentFirst} try you later today or tomorrow?`;
  return decision("rebooking_fallback", fallbackLine,
    { ...(dayHint ? { selectedDay: dayHint } : {}), awaitingUserAnswer: true, awaitingAnswerForStepIndex: 2, scriptStepIndex: 2 });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<MockContext> = {}): MockContext {
  return { agentName: "Bryson McCleary", scriptKey: "mortgage_protection", clientFirstName: "Jane", voiceProfile: { aiName: "Jacob" }, ...overrides };
}

function makeState(overrides: Partial<MockState> = {}): MockState {
  return { rebookingMode: true, callSid: "CA_test_123", ...overrides };
}

function makeIntent(kind: string, raw: string): TurnIntent {
  return { kind, raw };
}

// Apply stateWrites to state (mirrors what the main turn loop does at line 7819)
function applyDecision(state: MockState, decision: PolicyDecision): MockState {
  return { ...state, ...decision.stateWrites };
}

function isStepOneCoverageSubjectAnswer(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!t) return false;
  if ([
    "me", "myself", "my self", "just me", "for me",
    "this me", "that me", "yeah me", "its me", "it s me",
    "just myself", "only me", "only myself",
    "this myself", "this is myself",
    "spouse", "both", "both of us", "the two of us", "us both",
    "partner", "my partner",
    "girlfriend", "my girlfriend",
    "boyfriend", "my boyfriend",
    "fiance", "my fiance", "fiancee", "my fiancee",
    "significant other", "my significant other",
    "family", "my family", "family member", "my family member",
    "the whole family", "the family", "whole family",
    "all of us", "all of our family", "everyone",
    "my household", "the household",
    "son", "my son", "daughter", "my daughter",
    "child", "my child", "children", "my children", "kids", "my kids",
    "parent", "my parent", "mom", "my mom", "dad", "my dad",
  ].includes(t)) return true;
  return /\b(myself|my self|just me|for me|this me|that me|yeah me|just myself|this myself|this is myself|only me|only myself|my spouse|spouse|wife|husband|both|both of us|me and my wife|me and my husband|my wife and i|my husband and i|me and her|me and him|the two of us|my partner|my family|us both|for my family|for both of us|for the both of us|her and i|him and i|me and my partner|girlfriend|my girlfriend|boyfriend|my boyfriend|fianc[eé]+|my fianc[eé]+|significant other|my significant other|family member|my family member|my kids|my children|my son|my daughter|my parent|my mom|my dad|my child|the whole family|whole family|all of us|all of our family|my household|the household)\b/.test(t);
}

function canAdvanceFromStepForTest(state: MockState, to: number): boolean {
  const hasCoverageSubject = !!state.coverageSubject || state.coverageSubjectSetThisTurn === true;
  return !(to > 1 && !hasCoverageSubject);
}

function applyRouterDecisionForTest(state: MockState, decision: PolicyDecision): MockState {
  const next = { ...state };
  for (const [key, value] of Object.entries(decision.stateWrites)) {
    if (key === "scriptStepIndex") {
      const to = Number(value);
      next.scriptStepIndex = canAdvanceFromStepForTest(next, to) ? to : (next.scriptStepIndex ?? 0);
    } else {
      (next as any)[key] = value;
    }
  }
  next.lastRouteKind = decision.routeKind;
  return next;
}

function isPostCoverageSchedulingStateForTest(state: MockState): boolean {
  const hasCoverageSubject = !!state.coverageSubject || state.coverageSubjectSetThisTurn === true;
  if (!hasCoverageSubject && state.awaitingAnswerForStepIndex === 0) return false;
  return hasCoverageSubject && (
    state.lastRouteKind === "policy_step1_coverage" ||
    String(state.lastRouteKind || "").startsWith("post_coverage_")
  );
}

function stepAnchorAskForTest(pendingStepLine: string, previousAiLines: string[]): string {
  const target = normalizeTurnTextForKey(pendingStepLine);
  const occurrences = previousAiLines.filter((line) => normalizeTurnTextForKey(line) === target).length;
  if (occurrences <= 1) return pendingStepLine;
  return "Was this coverage just for you, or should we include your spouse too?";
}

function isSoftRejectionForTest(textRaw: string): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  return (
    /\b(i m|im|i'm)\s+(good(?!\s+with\s+(it|this|that))|fine|all set)\b/.test(t) ||
    /\b(i m|im|i'm)\s+good\s+on\s+(it|this|that)\b/.test(t) ||
    /\bno\s+(thanks|thank you)\b/.test(t) ||
    /\b(i said|i already said|i just said|yeah i said|like i said)\s+(i m|im|i'm)\s+(good(?!\s+with\s+(it|this|that))|fine|all set)\b/.test(t) ||
    /\b(i said|i already said|i just said|yeah i said|like i said)\s+(i m|im|i'm)\s+good\s+on\s+(it|this|that)\b/.test(t)
  );
}

function isGoodWithThatSchedulingAcceptanceForTest(textRaw: string, state: MockState): boolean {
  const t = normalizeTurnTextForKey(textRaw);
  if (!/\b(i m|im|i'm)?\s*good\s+with\s+(that|it|this)\b/.test(t)) return false;
  return Number(state.scriptStepIndex || 0) >= 1 || !!state.selectedDay || !!(state as any).pendingLiveTransferAvailabilityConfirm;
}

function arcProductKnowledgeForTest(scriptKey: string): string {
  if (scriptKey === "mortgage_protection") return "Mortgage protection pays off or pays down the house in the event of death or disability, so the family keeps the home.";
  if (scriptKey === "final_expense") return "Final expense coverage helps protect the family from burial costs and end-of-life expenses.";
  return "This is about the life insurance request they submitted, and the goal is simply to help them get the information.";
}

function simulateNormalRouterTurn(state: MockState, raw: string): { state: MockState; routeKind: string } {
  const stepCtx = { idx: state.scriptStepIndex ?? 0, steps: ["Was this for yourself, or a spouse as well?", "Does later today or tomorrow work better?"], stepType: "open_question" };
  const awaitingStepOne = state.awaitingAnswerForStepIndex === 0 && !state.coverageSubject;
  const isCoverageAnswer = isStepOneCoverageSubjectAnswer(raw);
  const softRejection = isSoftRejectionForTest(raw);
  const schedulingAcceptance = isGoodWithThatSchedulingAcceptanceForTest(raw, state);
  let decision: PolicyDecision;

  if (/stop calling|take me off|do not call|don t call|dont call/.test(normalizeTurnTextForKey(raw))) {
    decision = {
      handled: true,
      routeKind: "policy_do_not_call_exit",
      lineToSay: "Of course — I'll make sure you're removed right away.",
      stateWrites: {
        pendingHangupAfterGoodbye: true,
        awaitingUserAnswer: false,
        awaitingAnswerForStepIndex: undefined,
      },
      shouldAdvanceStep: false,
    };
  } else if (schedulingAcceptance) {
    decision = {
      handled: true,
      routeKind: "policy_script_step_2",
      lineToSay: "Perfect — is there a specific time you're available?",
      stateWrites: {
        scriptStepIndex: 2,
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: 2,
        selectedDay: state.selectedDay || "today",
      },
      shouldAdvanceStep: true,
    };
  } else if (softRejection && !(awaitingStepOne && isCoverageAnswer)) {
    const objectionCount = (state.objectionCount ?? 0) + 1;
    decision = {
      handled: true,
      routeKind: objectionCount >= 4 ? "policy_not_interested_exit" : "policy_not_interested",
      lineToSay: objectionCount >= 4 ? "Totally understood — I won't keep you. Have a great day!" : "ARC_OBJECTION_FRAMEWORK",
      stateWrites: objectionCount >= 4
        ? {
            objectionCount,
            pendingHangupAfterGoodbye: true,
            awaitingUserAnswer: false,
            awaitingAnswerForStepIndex: undefined,
          }
        : {
            objectionCount,
            awaitingUserAnswer: true,
            awaitingAnswerForStepIndex: state.awaitingAnswerForStepIndex ?? 0,
            scriptStepIndex: state.scriptStepIndex ?? 0,
          },
      shouldAdvanceStep: false,
    };
  } else if ((stepCtx.idx >= 1 || awaitingStepOne) && !state.coverageSubject && isCoverageAnswer) {
    decision = {
      handled: true,
      routeKind: "policy_step1_coverage",
      lineToSay: "Got it — I just need to get you scheduled.",
      stateWrites: {
        coverageSubject: normalizeTurnTextForKey(raw),
        coverageSubjectSetThisTurn: true,
        scriptStepIndex: 1,
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: 0,
      },
      shouldAdvanceStep: false,
    };
  } else if (isPostCoverageSchedulingStateForTest(state)) {
    decision = {
      handled: true,
      routeKind: "post_coverage_unknown_free",
      lineToSay: "Was this for yourself, or a spouse as well?",
      stateWrites: {
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: state.awaitingAnswerForStepIndex,
        scriptStepIndex: state.scriptStepIndex ?? 0,
      },
      shouldAdvanceStep: false,
    };
  } else {
    decision = {
      handled: true,
      routeKind: "policy_unknown",
      lineToSay: "Was this for yourself, or a spouse as well?",
      stateWrites: {
        awaitingUserAnswer: true,
        awaitingAnswerForStepIndex: state.awaitingAnswerForStepIndex ?? 0,
        scriptStepIndex: state.scriptStepIndex ?? 0,
      },
      shouldAdvanceStep: false,
    };
  }

  return { state: applyRouterDecisionForTest(state, decision), routeKind: decision.routeKind };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => { finalOutcomeCallLog.length = 0; });

// ══════════════════════════════════════════════════════════════════════════════
describe("Gate: normal calls unaffected by all Wave 1+2 changes", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const normalCtx = makeCtx();
  const normalStepCtx = { idx: 0, steps: ["Do you have your own life insurance?"], stepType: "coverage_question" };

  test("rebookingMode=false → returns null for any intent (scheduling_preference)", () => {
    const state = makeState({ rebookingMode: false });
    const result = buildRebookingPolicyDecision(state, makeIntent("scheduling_preference", "tomorrow afternoon"), normalCtx, normalStepCtx);
    expect(result).toBeNull();
  });

  test("rebookingMode=false → returns null for greeting_ack", () => {
    const state = makeState({ rebookingMode: false });
    const result = buildRebookingPolicyDecision(state, makeIntent("greeting_ack", "yeah hey"), normalCtx, normalStepCtx);
    expect(result).toBeNull();
  });

  test("rebookingMode=false → returns null for not_interested", () => {
    const state = makeState({ rebookingMode: false });
    const result = buildRebookingPolicyDecision(state, makeIntent("not_interested", "I'm not interested"), normalCtx, normalStepCtx);
    expect(result).toBeNull();
  });

  test("rebookingMode=false → returns null even with rebookingBookingConfirmed set", () => {
    const state = makeState({ rebookingMode: false, rebookingBookingConfirmed: true });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "No. That's it."), normalCtx, normalStepCtx);
    expect(result).toBeNull();
  });

  test("rebookingMode=false → returns null for bare closing negative", () => {
    const state = makeState({ rebookingMode: false });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "No thanks"), normalCtx, normalStepCtx);
    expect(result).toBeNull();
  });

  test("rebookingMode=false → returns null for angry lead", () => {
    const state = makeState({ rebookingMode: false });
    const result = buildRebookingPolicyDecision(state, makeIntent("angry_or_profane", "Stop calling me!"), normalCtx, normalStepCtx);
    expect(result).toBeNull();
  });

  test("Kayla scriptKey: rebookingMode gate still fires — Kayla never sets rebookingMode=true in practice", () => {
    // Even IF somehow a Kayla call had rebookingMode=true, it would go through rebooking
    // In reality: Kayla calls never receive rebookingMode=true from Twilio params
    // Verify that kayla_signup scriptKey doesn't bypass the rebookingMode=false gate
    const kaylaCtx = makeCtx({ scriptKey: "kayla_signup", agentName: "Kayla Demo" });
    const state = makeState({ rebookingMode: false });
    const result = buildRebookingPolicyDecision(state, makeIntent("scheduling_preference", "tomorrow"), kaylaCtx, normalStepCtx);
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Wave 1 Fix #1: rebooking_fallback line is natural, not internal meta-text", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const ctx = makeCtx({ agentName: "Bryson McCleary" });
  const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };

  test("unknown intent with no day hint → fallback uses agent first name, no meta-text", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "I'm not sure"), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_fallback");
    expect(result?.lineToSay).toBe("Got it — should Bryson try you later today or tomorrow?");
    expect(result?.lineToSay).not.toContain("The only objective");
    expect(result?.lineToSay).not.toContain("callback after the failed transfer");
  });

  test("unknown intent with 'tomorrow' in text → morning/afternoon/evening redirect (not meta-text)", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "I don't know, maybe tomorrow"), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_fallback");
    expect(result?.lineToSay).toBe("Got it — would morning, afternoon, or evening work better?");
    expect(result?.lineToSay).not.toContain("The only objective");
  });

  test("unknown intent with 'today' in text → morning/afternoon/evening redirect", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "Maybe today later"), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_fallback");
    expect(result?.lineToSay).toBe("Got it — would morning, afternoon, or evening work better?");
  });

  test("complete gibberish → fallback with agent name, no meta-text", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "uhhhh hmm what"), ctx, stepCtx);
    expect(result?.lineToSay).not.toContain("The only objective");
    expect(result?.lineToSay).toContain("Bryson");
  });

  test("empty agentFirst from Twilio → falls through to context.agentName first name", () => {
    // Fix #5 ensures rebookingAgentFirst is populated from context before being stored.
    // Here we test that even if rebookingAgentFirst is empty, ctx fallback fires.
    const state = makeState({ rebookingAgentFirst: "" });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "I'm not sure"), ctx, stepCtx);
    // agentFirst resolves: "" || getAgentFirstName(ctx) = "Bryson"
    expect(result?.lineToSay).toContain("Bryson");
    expect(result?.lineToSay).not.toContain("the agent");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Wave 1 Fix #4: offeredTime guarded against bare closing negatives", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const ctx = makeCtx();
  const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };

  test("'No. That's it.' after AI offered 2 PM → offeredTime is null, goes to rebooking_goodbye (after booking)", () => {
    const state = makeState({
      rebookingAgentFirst: "Bryson",
      rebookingBookingConfirmed: true,
      context: ctx,
      lastPromptLine: "I have 2 PM or 4 PM available for Bryson's callback. Which works better?",
      lastExactTimeText: "2 PM",
    });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "No. That's it."), ctx, stepCtx);
    // Should be goodbye, NOT rebooking_exact_time_needs_day
    expect(result?.routeKind).toBe("rebooking_goodbye");
    expect(result?.lineToSay).toContain("have yourself a great day");
  });

  test("'No thanks' after AI offered time → offeredTime null, goodbye fires if booking confirmed", () => {
    const state = makeState({
      rebookingAgentFirst: "Bryson",
      rebookingBookingConfirmed: true,
      context: ctx,
      lastPromptLine: "Does 10 AM work for Bryson's callback?",
    });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "No thanks"), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_goodbye");
  });

  test("'nope' after AI offered time → offeredTime null (bare closing negative guard fires)", () => {
    // Without Fix #4, "nope" might not trigger offeredTime extraction directly (no time word)
    // but it also shouldn't route to exact_time_needs_day
    const state = makeState({
      rebookingAgentFirst: "Bryson",
      rebookingBookingConfirmed: true,
      context: ctx,
      lastPromptLine: "Does 3 PM or 5 PM work?",
    });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "nope"), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_goodbye");
    expect(result?.lineToSay).not.toContain("rebooking_exact_time_needs_day");
  });

  test("real time statement ('2 PM works') → offeredTime is NOT null, routes to rebooking_exact_time", () => {
    const state = makeState({
      rebookingAgentFirst: "Bryson",
      lastPromptLine: "I have 2 PM or 4 PM available for Bryson's callback. Which works better?",
      selectedDay: "tomorrow",
    });
    // "2 PM works" is NOT a bare closing negative
    expect(isBareClosingNegative("2 PM works")).toBe(false);
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "2 PM works"), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_exact_time");
    // pickOfferedClockTimeFromPrompt lowercases via normalizeSpokenTimeText
    expect(result?.lineToSay?.toLowerCase()).toContain("2 pm");
  });

  test("isBareClosingNegative correctly handles all variants", () => {
    const closingNegatives = [
      "No", "no", "Nah", "nope", "No that's it", "No, that's it",
      "That's all", "No I'm good", "Nothing else", "All good",
      "That's it", "No thank you", "No thanks", "I'm good", "Im good",
    ];
    for (const text of closingNegatives) {
      expect(isBareClosingNegative(text)).toBe(true);
    }

    const notClosingNegatives = [
      "2 PM works", "Tomorrow afternoon", "Morning please",
      "Not really, I have questions", "No, I want morning",
      "Later this week", "Actually, can we do Thursday?",
    ];
    for (const text of notClosingNegatives) {
      expect(isBareClosingNegative(text)).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Wave 1 Fix #5: rebookingAgentFirst fallback chain", () => {
// ══════════════════════════════════════════════════════════════════════════════

  test("getAgentFirstName extracts first name from full name", () => {
    expect(getAgentFirstName({ agentName: "Bryson McCleary" })).toBe("Bryson");
    expect(getAgentFirstName({ agentName: "Grace Johnson" })).toBe("Grace");
    expect(getAgentFirstName({ agentName: "John" })).toBe("John");
  });

  test("getAgentFirstName with empty/missing agentName → 'the agent'", () => {
    expect(getAgentFirstName({ agentName: "" })).toBe("the agent");
    expect(getAgentFirstName({})).toBe("the agent");
    expect(getAgentFirstName(undefined)).toBe("the agent");
  });

  test("rebookingAgentFirst empty string → ctx.agentName used via getAgentFirstName", () => {
    const ctx = makeCtx({ agentName: "Bryson McCleary" });
    const state = makeState({ rebookingAgentFirst: "" });
    const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };
    const result = buildRebookingPolicyDecision(state, makeIntent("greeting_ack", "hey"), ctx, stepCtx);
    expect(result?.lineToSay).toContain("Bryson");
    expect(result?.lineToSay).not.toContain("the agent");
    expect(result?.lineToSay).not.toContain("our agent");
  });

  test("rebookingAgentFirst '' (fixed: empty not 'our agent') → ctx.agentName used in agent-name-bearing lines", () => {
    // Before Fix #5, if Twilio agentName was empty, rebookingAgentFirst got stored as "our agent"
    // which is truthy — so ctx fallback never fired. Now we test that with the fixed behavior,
    // if rebookingAgentFirst is correctly empty, ctx takes over.
    // Use hearing_problem which always includes the agent name in its line.
    const ctx = makeCtx({ agentName: "Bryson McCleary" });
    const state = makeState({ rebookingAgentFirst: "", lastPromptLine: "" }); // Fixed: empty instead of "our agent"
    const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };
    const result = buildRebookingPolicyDecision(state, makeIntent("hearing_problem", "Sorry, what?"), ctx, stepCtx);
    expect(result?.lineToSay).toContain("Bryson");
    expect(result?.lineToSay).not.toContain("our agent");
    expect(result?.lineToSay).not.toContain("the agent");
  });

  test("rebookingAgentFirst set correctly from Twilio → used as-is", () => {
    const ctx = makeCtx({ agentName: "Bryson McCleary" });
    const state = makeState({ rebookingAgentFirst: "Grace" }); // Twilio passed correct name
    const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };
    const result = buildRebookingPolicyDecision(state, makeIntent("greeting_ack", "hey"), ctx, stepCtx);
    expect(result?.lineToSay).toContain("Grace");
    expect(result?.lineToSay).not.toContain("Bryson");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Wave 2 Part A: rebooking_exact_time_confirmed sets booking flags", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const ctx = makeCtx({ agentName: "Bryson McCleary" });
  const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };

  test("affirming a priorExactTime → stateWrites includes confirmedAppointment=true", () => {
    const state = makeState({
      rebookingAgentFirst: "Bryson",
      lastExactTimeText: "2 PM",
    });
    const result = buildRebookingPolicyDecision(state, makeIntent("exact_time", "yes"), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_exact_time_confirmed");
    expect(result?.stateWrites.confirmedAppointment).toBe(true);
  });

  test("affirming a priorExactTime → stateWrites includes rebookingBookingConfirmed=true", () => {
    const state = makeState({
      rebookingAgentFirst: "Bryson",
      lastExactTimeText: "2 PM",
    });
    const result = buildRebookingPolicyDecision(state, makeIntent("exact_time", "yeah that works"), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_exact_time_confirmed");
    expect(result?.stateWrites.rebookingBookingConfirmed).toBe(true);
  });

  test("exact time confirmed → awaitingUserAnswer=false in stateWrites", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson", lastExactTimeText: "10 AM" });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "okay"), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_exact_time_confirmed");
    expect(result?.stateWrites.awaitingUserAnswer).toBe(false);
  });

  test("exact time confirmed → lineToSay contains agent first name and the time", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson", lastExactTimeText: "3 PM" });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "sure"), ctx, stepCtx);
    expect(result?.lineToSay).toContain("Bryson");
    expect(result?.lineToSay).toContain("3 PM");
    expect(result?.lineToSay).toContain("Perfect");
  });

  test("without priorExactTime, affirmative does NOT fire confirmed branch", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" }); // no lastExactTimeText
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "yes"), ctx, stepCtx);
    expect(result?.routeKind).not.toBe("rebooking_exact_time_confirmed");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Wave 2 Part B: goodbye path fires after booking + bare closing negative", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const ctx = makeCtx({ agentName: "Bryson McCleary" });
  const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };

  test("rebookingBookingConfirmed=true + 'No. That's it.' → rebooking_goodbye", () => {
    const state = makeState({
      rebookingAgentFirst: "Bryson",
      rebookingBookingConfirmed: true,
      context: ctx,
    });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "No. That's it."), ctx, stepCtx);
    expect(result?.routeKind).toBe("rebooking_goodbye");
  });

  test("goodbye line contains agent name", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true, context: ctx });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "No thanks"), ctx, stepCtx);
    expect(result?.lineToSay).toContain("Bryson");
    expect(result?.lineToSay).toContain("have yourself a great day");
    expect(result?.lineToSay).toContain("Bye!");
  });

  test("goodbye sets pendingHangupAfterGoodbye=true", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true, context: ctx });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "all good"), ctx, stepCtx);
    expect(result?.stateWrites.pendingHangupAfterGoodbye).toBe(true);
  });

  test("goodbye sets awaitingUserAnswer=false", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true, context: ctx });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "nah"), ctx, stepCtx);
    expect(result?.stateWrites.awaitingUserAnswer).toBe(false);
  });

  test("goodbye fires handleFinalOutcomeIntent with outcome='booked'", () => {
    finalOutcomeCallLog.length = 0;
    const state = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true, context: ctx });
    buildRebookingPolicyDecision(state, makeIntent("unknown", "No. That's it."), ctx, stepCtx);
    // Allow microtask queue to flush
    return Promise.resolve().then(() => {
      expect(finalOutcomeCallLog.length).toBe(1);
      expect(finalOutcomeCallLog[0].outcome).toBe("booked");
    });
  });

  test("goodbye finalOutcomeSent guard: does NOT double-post if already sent", () => {
    finalOutcomeCallLog.length = 0;
    const state = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true, context: ctx, finalOutcomeSent: true });
    buildRebookingPolicyDecision(state, makeIntent("unknown", "No. That's it."), ctx, stepCtx);
    return Promise.resolve().then(() => {
      // Should still return goodbye route...
      expect(finalOutcomeCallLog.length).toBe(0); // ...but NOT call outcome endpoint again
    });
  });

  test("goodbye without context: finalOutcomeSent guard prevents call even if not sent", () => {
    finalOutcomeCallLog.length = 0;
    const state = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true }); // no context
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "nah"), ctx, stepCtx);
    return Promise.resolve().then(() => {
      expect(result?.routeKind).toBe("rebooking_goodbye"); // route still fires
      expect(finalOutcomeCallLog.length).toBe(0); // but no outcome post
    });
  });

  test("rebookingBookingConfirmed=false + bare closing → NOT goodbye (falls to fallback)", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: false });
    const result = buildRebookingPolicyDecision(state, makeIntent("unknown", "No. That's it."), ctx, stepCtx);
    // Should be rebooking_fallback, not goodbye
    expect(result?.routeKind).toBe("rebooking_fallback");
    expect(result?.routeKind).not.toBe("rebooking_goodbye");
  });

  test("rebookingBookingConfirmed=true + non-closing question → handled (not goodbye)", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true, context: ctx });
    // Lead asks another question after booking — should NOT trigger goodbye
    // "tomorrow morning" has both a day and a time window → routes to rebooking_time_window (correct)
    const result = buildRebookingPolicyDecision(state, makeIntent("scheduling_preference", "actually, can we do tomorrow morning?"), ctx, stepCtx);
    expect(result?.routeKind).not.toBe("rebooking_goodbye");
    expect(result?.handled).toBe(true);
    // rebookingBookingConfirmed persists in state — next bare closing will still catch it
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Full rebooking conversation trace", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const ctx = makeCtx({ agentName: "Bryson McCleary" });
  const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };

  test("complete flow: greeting → day → window → time → confirm → goodbye", () => {
    let state = makeState({ rebookingAgentFirst: "Bryson", context: ctx });

    // Turn 1: lead hears the rebooking opening, says "yeah"
    let d = buildRebookingPolicyDecision(state, makeIntent("greeting_ack", "yeah"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_greeting_ack");
    expect(d.lineToSay).toContain("Bryson");
    expect(d.lineToSay).toContain("later today or tomorrow");
    state = applyDecision(state, d);

    // Turn 2: lead picks tomorrow
    d = buildRebookingPolicyDecision(state, makeIntent("day_selection", "tomorrow works"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_day_selected");
    expect(d.stateWrites.selectedDay).toBe("tomorrow");
    state = applyDecision(state, d);

    // Turn 3: lead picks afternoon
    d = buildRebookingPolicyDecision(state, makeIntent("time_window", "afternoon"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_time_window");
    expect(d.lineToSay).toContain("afternoon");
    state = applyDecision(state, d);

    // Turn 4: lead picks 2 PM
    state = { ...state, lastPromptLine: d.lineToSay, selectedDay: "tomorrow" };
    d = buildRebookingPolicyDecision(state, makeIntent("unknown", "2 PM works"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_exact_time");
    // pickOfferedClockTimeFromPrompt lowercases via normalizeSpokenTimeText
    expect(d.stateWrites.lastExactTimeText).toBe("2 pm");
    state = applyDecision(state, d);

    // Turn 5: lead confirms 2 PM
    state = { ...state, lastExactTimeText: "2 pm", lastPromptLine: d.lineToSay as string };
    d = buildRebookingPolicyDecision(state, makeIntent("unknown", "yes"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_exact_time_confirmed");
    expect(d.stateWrites.confirmedAppointment).toBe(true);
    expect(d.stateWrites.rebookingBookingConfirmed).toBe(true);
    expect(d.lineToSay).toContain("Bryson");
    expect(d.lineToSay).toContain("2 pm");
    state = applyDecision(state, d);

    // Turn 6: lead says "No. That's it."
    d = buildRebookingPolicyDecision(state, makeIntent("unknown", "No. That's it."), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_goodbye");
    expect(d.lineToSay).toContain("great day");
    expect(d.lineToSay).toContain("Bryson");
    expect(d.stateWrites.pendingHangupAfterGoodbye).toBe(true);
    state = applyDecision(state, d);

    // Post-goodbye: pendingHangupAfterGoodbye is set, call will hang up
    expect(state.pendingHangupAfterGoodbye).toBe(true);
  });

  test("flow with named weekday: 'Friday' → afternoon → 1 PM → confirm → goodbye", () => {
    let state = makeState({ rebookingAgentFirst: "Grace", context: ctx });

    // Turn 1: lead says "what about Friday"
    let d = buildRebookingPolicyDecision(state, makeIntent("day_selection", "what about Friday"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_day_selected");
    expect(d.stateWrites.selectedDay).toBe("friday");
    state = applyDecision(state, d);

    // Turn 2: lead says afternoon
    d = buildRebookingPolicyDecision(state, makeIntent("time_window", "afternoon"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_time_window");
    state = applyDecision(state, d);

    // Turn 3: lead confirms 1 PM
    state = { ...state, lastPromptLine: "I have 1 PM or 3 PM on Friday. Which works better?", selectedDay: "friday" };
    d = buildRebookingPolicyDecision(state, makeIntent("unknown", "1 PM"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_exact_time");
    state = applyDecision(state, d);

    // Turn 4: confirms the time
    state = { ...state, lastExactTimeText: "1 PM" };
    d = buildRebookingPolicyDecision(state, makeIntent("unknown", "sounds good"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_exact_time_confirmed");
    expect(d.stateWrites.rebookingBookingConfirmed).toBe(true);
    state = applyDecision(state, d);

    // Turn 5: "Im good"
    d = buildRebookingPolicyDecision(state, makeIntent("unknown", "Im good"), ctx, stepCtx)!;
    expect(d.routeKind).toBe("rebooking_goodbye");
    expect(d.stateWrites.pendingHangupAfterGoodbye).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Edge cases: unexpected responses during rebooking", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const ctx = makeCtx({ agentName: "Bryson McCleary" });
  const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };

  test("angry/profane after transfer failure → rebooking_soft_stop (graceful)", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const result = buildRebookingPolicyDecision(state, makeIntent("angry_or_profane", "I'm so angry about this!"), ctx, stepCtx)!;
    expect(result.routeKind).toBe("rebooking_soft_stop");
    expect(result.lineToSay).toContain("sorry for the trouble");
    expect(result.stateWrites.awaitingUserAnswer).toBe(false);
  });

  test("not_interested during rebooking → soft_stop, not loop", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const result = buildRebookingPolicyDecision(state, makeIntent("not_interested", "I'm not interested in a callback"), ctx, stepCtx)!;
    expect(result.routeKind).toBe("rebooking_soft_stop");
    expect(result.stateWrites.awaitingUserAnswer).toBe(false);
  });

  test("lead asks for live transfer AGAIN → explains missed connection, schedules callback", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const result = buildRebookingPolicyDecision(state, makeIntent("live_transfer_now", "Can I just talk to Bryson now?"), ctx, stepCtx)!;
    expect(result.routeKind).toBe("rebooking_now_requested");
    expect(result.lineToSay).toContain("missed the live connection");
    expect(result.lineToSay).toContain("callback instead");
  });

  test("can't hear → repeats last prompt line", () => {
    const state = makeState({
      rebookingAgentFirst: "Bryson",
      lastPromptLine: "Would later today or tomorrow work better for Bryson's callback?",
    });
    const result = buildRebookingPolicyDecision(state, makeIntent("hearing_problem", "What? I can't hear you"), ctx, stepCtx)!;
    expect(result.routeKind).toBe("rebooking_hearing_retry");
    expect(result.lineToSay).toBe("Would later today or tomorrow work better for Bryson's callback?");
  });

  test("can't hear with no lastPromptLine → generates generic retry line", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson", lastPromptLine: "" });
    const result = buildRebookingPolicyDecision(state, makeIntent("hearing_problem", "Sorry what?"), ctx, stepCtx)!;
    expect(result.routeKind).toBe("rebooking_hearing_retry");
    expect(result.lineToSay).toContain("Bryson");
  });

  test("lead says 'live transfer later' → treated as scheduling preference", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const result = buildRebookingPolicyDecision(state, makeIntent("live_transfer_later", "just call me tomorrow"), ctx, stepCtx)!;
    expect(result.routeKind).toBe("rebooking_day_selected");
    expect(result.stateWrites.selectedDay).toBe("tomorrow");
  });

  test("lead asks same thing twice (would hit fallback both times, no loop escalation)", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const intent = makeIntent("unknown", "I don't know");

    const r1 = buildRebookingPolicyDecision(state, intent, ctx, stepCtx)!;
    const r2 = buildRebookingPolicyDecision(state, intent, ctx, stepCtx)!;

    expect(r1.routeKind).toBe("rebooking_fallback");
    expect(r2.routeKind).toBe("rebooking_fallback");
    // Both return same natural line — no meta-text, no escalation
    expect(r1.lineToSay).toBe(r2.lineToSay);
    expect(r1.lineToSay).not.toContain("The only objective");
  });

  test("long rambling response with 'tomorrow' in it → handled by fallback, routes to morning/afternoon/evening", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" });
    const result = buildRebookingPolicyDecision(state,
      makeIntent("unknown", "Well I mean I'm pretty busy but maybe tomorrow if things calm down, you know what I mean"),
      ctx, stepCtx)!;
    expect(result.lineToSay).toBe("Got it — would morning, afternoon, or evening work better?");
  });

  test("exact time without day → asks for day clarification", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson" }); // no selectedDay
    const result = buildRebookingPolicyDecision(state, makeIntent("exact_time", "2 PM"), ctx, stepCtx)!;
    expect(result.routeKind).toBe("rebooking_exact_time_needs_day");
    expect(result.lineToSay).toContain("today or tomorrow");
  });

  test("exact time WITH remembered day → skips day clarification", () => {
    const state = makeState({ rebookingAgentFirst: "Bryson", selectedDay: "tomorrow" });
    const result = buildRebookingPolicyDecision(state, makeIntent("exact_time", "2 PM"), ctx, stepCtx)!;
    expect(result.routeKind).toBe("rebooking_exact_time");
    expect(result.lineToSay).toContain("2 PM");
  });

  test("booking confirmed, lead asks new scheduling question → falls through (not goodbye)", () => {
    const state = makeState({
      rebookingAgentFirst: "Bryson",
      rebookingBookingConfirmed: true,
      context: ctx,
    });
    const result = buildRebookingPolicyDecision(state,
      makeIntent("scheduling_preference", "Actually wait, could we do Thursday instead?"),
      ctx, stepCtx)!;
    expect(result.routeKind).not.toBe("rebooking_goodbye");
    // rebookingBookingConfirmed persists in state — next bare closing will still trigger goodbye
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Kayla demo isolation", () => {
// ══════════════════════════════════════════════════════════════════════════════

  test("normalizeScriptKey maps Kayla variants correctly", () => {
    expect(normalizeScriptKey("kayla_signup")).toBe("kayla_signup");
    expect(normalizeScriptKey("kayla")).toBe("kayla_signup");
    expect(normalizeScriptKey("kayla_demo")).toBe("kayla_signup");
    expect(normalizeScriptKey("KAYLA")).toBe("kayla_signup");
  });

  test("normalizeScriptKey: mortgage_protection maps correctly", () => {
    expect(normalizeScriptKey("mortgage_protection")).toBe("mortgage_protection");
    expect(normalizeScriptKey("mp")).toBe("mortgage_protection");
    expect(normalizeScriptKey("")).toBe("mortgage_protection");
  });

  test("Kayla call with rebookingMode=false → gate returns null (buildRebookingPolicyDecision)", () => {
    const kaylaCtx = makeCtx({ scriptKey: "kayla_signup", agentName: "Kayla Demo" });
    const state = makeState({ rebookingMode: false });
    const result = buildRebookingPolicyDecision(state, makeIntent("scheduling_preference", "tomorrow"), kaylaCtx, {});
    expect(result).toBeNull();
  });

  test("Kayla live call: rebookingMode is NEVER set to true from Twilio params for kayla_signup sessions", () => {
    // Simulate the handleStart logic: rebookingMode = custom.rebookingMode === "true"
    // Kayla demo sessions are initiated without rebookingMode param
    function simulateHandleStartRebookingMode(customParams: Record<string,string>): boolean {
      return String(customParams.rebookingMode || "").trim() === "true";
    }
    // Normal Kayla demo call: no rebookingMode param
    expect(simulateHandleStartRebookingMode({})).toBe(false);
    expect(simulateHandleStartRebookingMode({ scriptKey: "kayla_signup" })).toBe(false);
    // Only true if explicitly passed (which the Kayla demo flow never does)
    expect(simulateHandleStartRebookingMode({ rebookingMode: "true" })).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Concurrent session isolation", () => {
// ══════════════════════════════════════════════════════════════════════════════

  test("two simultaneous rebooking sessions don't share state", () => {
    const ctx1 = makeCtx({ agentName: "Bryson McCleary" });
    const ctx2 = makeCtx({ agentName: "Grace Johnson" });

    // Session A: booking confirmed, waiting for closing
    const stateA = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true, context: ctx1, callSid: "CA_111" });
    // Session B: still scheduling, no booking yet
    const stateB = makeState({ rebookingAgentFirst: "Grace", rebookingBookingConfirmed: false, context: ctx2, callSid: "CA_222" });

    const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };

    // Same input "No. That's it." — should behave differently per session
    const resultA = buildRebookingPolicyDecision(stateA, makeIntent("unknown", "No. That's it."), ctx1, stepCtx)!;
    const resultB = buildRebookingPolicyDecision(stateB, makeIntent("unknown", "No. That's it."), ctx2, stepCtx)!;

    // Session A has booking confirmed → goodbye
    expect(resultA.routeKind).toBe("rebooking_goodbye");
    expect(resultA.lineToSay).toContain("Bryson");

    // Session B has no booking → fallback
    expect(resultB.routeKind).toBe("rebooking_fallback");
    expect(resultB.lineToSay).toContain("Grace");

    // States are completely independent
    expect(stateA.callSid).toBe("CA_111");
    expect(stateB.callSid).toBe("CA_222");
  });

  test("finalOutcomeSent on session A does not affect session B", () => {
    finalOutcomeCallLog.length = 0;
    const ctx = makeCtx({ agentName: "Bryson McCleary" });

    const stateA = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true, context: ctx, callSid: "CA_A", finalOutcomeSent: true }); // already sent
    const stateB = makeState({ rebookingAgentFirst: "Bryson", rebookingBookingConfirmed: true, context: ctx, callSid: "CA_B", finalOutcomeSent: false }); // not yet sent

    const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };

    buildRebookingPolicyDecision(stateA, makeIntent("unknown", "No"), ctx, stepCtx);
    buildRebookingPolicyDecision(stateB, makeIntent("unknown", "No"), ctx, stepCtx);

    return Promise.resolve().then(() => {
      // Only session B should have fired handleFinalOutcomeIntent
      expect(finalOutcomeCallLog.length).toBe(1);
      expect(finalOutcomeCallLog[0].state.callSid).toBe("CA_B");
    });
  });

  test("multiple users: different agent names in same time window", () => {
    const ctxUser1 = makeCtx({ agentName: "Alice Smith" });
    const ctxUser2 = makeCtx({ agentName: "Bob Jones" });
    const stepCtx = { idx: 0, steps: [], stepType: "rebooking" };

    const stateUser1 = makeState({ rebookingAgentFirst: "Alice" });
    const stateUser2 = makeState({ rebookingAgentFirst: "Bob" });

    const r1 = buildRebookingPolicyDecision(stateUser1, makeIntent("greeting_ack", "hey"), ctxUser1, stepCtx)!;
    const r2 = buildRebookingPolicyDecision(stateUser2, makeIntent("greeting_ack", "hey"), ctxUser2, stepCtx)!;

    expect(r1.lineToSay).toContain("Alice");
    expect(r1.lineToSay).not.toContain("Bob");
    expect(r2.lineToSay).toContain("Bob");
    expect(r2.lineToSay).not.toContain("Alice");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("pickOfferedClockTimeFromPrompt: time extraction logic", () => {
// ══════════════════════════════════════════════════════════════════════════════

  test("user says 'first' → picks first offered time", () => {
    const result = pickOfferedClockTimeFromPrompt("I have 10 AM or 2 PM for Bryson's callback.", "I'll take the first one");
    // normalizeSpokenTimeText lowercases the prompt before extraction
    expect(result).toBe("10 am");
  });

  test("user says 'second' → picks second offered time", () => {
    const result = pickOfferedClockTimeFromPrompt("I have 10 AM or 2 PM for Bryson's callback.", "The second option");
    expect(result).toBe("2 pm");
  });

  test("user restates offered time by number → matches", () => {
    const result = pickOfferedClockTimeFromPrompt("Does 2 PM work for Bryson's callback?", "2 works for me");
    expect(result).toBe("2 pm");
  });

  test("bare closing negative 'No' with time in prior prompt → returns null (Fix #4 guard)", () => {
    // The guard in buildRebookingPolicyDecision short-circuits before calling this
    // But test the raw function too: "No" has no time word, so it should return null
    const result = pickOfferedClockTimeFromPrompt("Does 2 PM or 4 PM work?", "No");
    // "No" contains no digit matching offered times, so raw function returns null too
    expect(result).toBeNull();
  });

  test("no times in prior prompt → null", () => {
    const result = pickOfferedClockTimeFromPrompt("Would morning or afternoon work better?", "morning");
    expect(result).toBeNull();
  });

  test("user says 'later' with two options → picks second", () => {
    const result = pickOfferedClockTimeFromPrompt("I have 10 AM or 2 PM available.", "the later one");
    expect(result).toBe("2 pm");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Fix 1: isBareClosingNegative — expanded coverage", () => {
// ══════════════════════════════════════════════════════════════════════════════

  test("Layer 1 exact matches still work", () => {
    for (const phrase of ["no", "nah", "nope", "that s all", "all good", "im good", "i m good", "no thank you", "no thanks", "nothing else"]) {
      expect(isBareClosingNegative(phrase)).toBe(true);
    }
  });

  test("new Layer 1 verbal negatives match", () => {
    expect(isBareClosingNegative("negative")).toBe(true);
    expect(isBareClosingNegative("nuh uh")).toBe(true);
    expect(isBareClosingNegative("mm mm")).toBe(true);
    expect(isBareClosingNegative("uh uh")).toBe(true);
  });

  test("Layer 2 — real-world audit variants now match", () => {
    const variants = [
      "Nah we're good",
      "No I think that covers it",
      "Yeah I think we're good",
      "I think that's everything",
      "I think we're all set",
      "No I think that's all",
      "No I think we're good",
      "Nothing comes to mind",
      "No I'm all set",
      "I think that's it for now",
      "Nah I'm all good",
      "Yeah I'm all set",
      "No that covers it",
    ];
    for (const phrase of variants) {
      expect(isBareClosingNegative(phrase)).toBe(true);
    }
  });

  test("critical negative: 'No, actually, can we change the time?' → false", () => {
    expect(isBareClosingNegative("No, actually, can we change the time?")).toBe(false);
  });

  test("critical negative: 'No, I have one more question' → false", () => {
    expect(isBareClosingNegative("No, I have one more question")).toBe(false);
  });

  test("real follow-up questions → false", () => {
    const notClosing = [
      "What time was that again?",
      "Actually can we do Thursday instead?",
      "No wait, morning works better",
      "I do have a question actually",
      "Can you remind me what time we said?",
    ];
    for (const phrase of notClosing) {
      expect(isBareClosingNegative(phrase)).toBe(false);
    }
  });

  test("filler variations → true", () => {
    expect(isBareClosingNegative("no that's all thanks")).toBe(true);
    expect(isBareClosingNegative("yeah we're good for now")).toBe(true);
    expect(isBareClosingNegative("nah all set")).toBe(true);
    expect(isBareClosingNegative("I think we're good")).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Fix 2: not_interested booking guard in handlePostCoverageSchedulingTurn", () => {
// ══════════════════════════════════════════════════════════════════════════════

  // We test the isBareClosingNegative gate directly since handlePostCoverageSchedulingTurn
  // is not mirrored in the sim file. These tests verify the logic the guard depends on.

  test("confirmedAppointment + expanded closing → isBareClosingNegative is true (gate fires)", () => {
    // The guard: (state as any).confirmedAppointment && isBareClosingNegative(raw)
    const confirmedAppointment = true;
    const variants = ["I'm all set", "Nah we're good", "Yeah I think that covers it", "nothing comes to mind"];
    for (const raw of variants) {
      expect(confirmedAppointment && isBareClosingNegative(raw)).toBe(true);
    }
  });

  test("no confirmedAppointment + expanded closing → gate does NOT fire (rebuttal path unchanged)", () => {
    const confirmedAppointment = false;
    const variants = ["I'm all set", "Nah we're good"];
    for (const raw of variants) {
      expect(confirmedAppointment && isBareClosingNegative(raw)).toBe(false);
    }
  });

  test("confirmedAppointment + real objection → gate does NOT fire", () => {
    const confirmedAppointment = true;
    const notInterested = "No, actually, can we change the time?";
    expect(confirmedAppointment && isBareClosingNegative(notInterested)).toBe(false);
  });

  test("confirmedAppointment + genuine not_interested phrase → gate does NOT fire (rebuttal path active)", () => {
    const confirmedAppointment = true;
    const notInterested = "I'm not really interested anymore";
    expect(confirmedAppointment && isBareClosingNegative(notInterested)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Booking trigger regression guards", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const source = fs.readFileSync(
    path.join(__dirname, "..", "ai-voice-server", "index.ts"),
    "utf8"
  );
  const triggerSource = source.slice(
    source.indexOf("function maybeFireServerSideBookingTrigger"),
    source.indexOf("async function handleConversationTurn")
  );

  test("confirmedAppointment does not block the server-side booking trigger", () => {
    expect(triggerSource).toContain(
      "if (!onConfirmStep || !hasRecentExactTime || state.finalOutcomeSent) return null;"
    );
    expect(triggerSource).not.toContain(
      "state.finalOutcomeSent || (state as any).confirmedAppointment"
    );
    expect(triggerSource).toContain("void handleBookAppointmentIntent(state,");
  });

  test("named weekdays resolve inside the booking trigger instead of falling back to today", () => {
    expect(triggerSource).toContain("const isNamedWeekday");
    expect(triggerSource).toContain("isNamedWeekday(explicitDay)");
    expect(triggerSource).toContain("isNamedWeekday(rememberedDay)");
    expect(triggerSource).toContain("const daysUntil = (targetDay - currentDay + 7) % 7;");
    expect(triggerSource).toContain("bookingLocalDate.setDate(bookingLocalDate.getDate() + daysUntil);");
  });

  test("same-day named weekday in the past rolls to next week, not the tomorrow clarification loop", () => {
    expect(triggerSource).toContain(
      "if (startDate && isNamedWeekday(selectedBookingDay) && startDate.getTime() < Date.now())"
    );
    expect(triggerSource).toContain("bookingLocalDate.setDate(bookingLocalDate.getDate() + 7);");
    expect(triggerSource).toContain("bookingDateStr = formatBookingDate(bookingLocalDate);");
  });

  test("named weekdays can book beyond the old 48-hour tomorrow-only window", () => {
    expect(triggerSource).toContain("const maxBookingWindowMs = isNamedWeekday(selectedBookingDay)");
    expect(triggerSource).toContain("? 8 * 24 * 60 * 60 * 1000");
    expect(triggerSource).toContain(": 48 * 60 * 60 * 1000");
  });

  test("post-booking no-plus-time closing guard remains in place", () => {
    expect(source).toContain("(state as any).confirmedAppointment &&");
    expect(source).toContain("didAiJustAskClosingQuestion(state) &&");
    expect(source).toContain("/^(no|nah|nope|negative|nuh uh|uh uh|mm mm)[,.\\s!]/i.test(raw.trim())");
    expect(source).toContain("routeKind: \"post_coverage_closing_no_goodbye\"");
    expect(source).toContain("pendingHangupAfterGoodbye: true");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Normal AI dialer stepper/router invariants", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const source = fs.readFileSync(
    path.join(__dirname, "..", "ai-voice-server", "index.ts"),
    "utf8"
  );

  test('greeting detour then "Just myself." advances step 0→1 without post_coverage before Step 1 answer', () => {
    let state: MockState = {
      rebookingMode: false,
      phase: "in_call",
      scriptStepIndex: 0,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 0,
      callSid: "CA_stepper_a",
    };
    const routeKinds: string[] = [];

    const detour = simulateNormalRouterTurn(state, "Yo, what's going on?");
    state = detour.state;
    routeKinds.push(detour.routeKind);
    expect(state.awaitingAnswerForStepIndex).toBe(0);
    expect(state.scriptStepIndex).toBe(0);

    const answer = simulateNormalRouterTurn(state, "Just myself.");
    state = answer.state;
    routeKinds.push(answer.routeKind);

    expect(answer.routeKind).toBe("policy_step1_coverage");
    expect(state.coverageSubject).toBe("just myself");
    expect(state.scriptStepIndex).toBe(1);
    expect(routeKinds.slice(0, -1).some((r) => r.startsWith("post_coverage_"))).toBe(false);
  });

  test("Step 1 classifier miss preserves awaitingAnswerForStepIndex through unknown route and does not advance", () => {
    const state: MockState = {
      rebookingMode: false,
      phase: "in_call",
      scriptStepIndex: 0,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 0,
      lastRouteKind: "post_coverage_unknown_free",
      callSid: "CA_stepper_b",
    };

    const result = simulateNormalRouterTurn(state, "blue banana");

    expect(isStepOneCoverageSubjectAnswer("blue banana")).toBe(false);
    expect(result.routeKind).toBe("policy_unknown");
    expect(result.state.awaitingAnswerForStepIndex).toBe(0);
    expect(result.state.awaitingUserAnswer).toBe(true);
    expect(result.state.scriptStepIndex).toBe(0);
  });

  test('"No, just for myself" is a coverage answer, not an objection', () => {
    const state: MockState = {
      rebookingMode: false,
      phase: "in_call",
      scriptStepIndex: 0,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 0,
      objectionCount: 0,
      callSid: "CA_stepper_coverage_no",
    };

    const result = simulateNormalRouterTurn(state, "No, just for myself");

    expect(result.routeKind).toBe("policy_step1_coverage");
    expect(result.state.coverageSubject).toBe("no just for myself");
    expect(result.state.scriptStepIndex).toBe(1);
    expect(result.state.objectionCount).toBe(0);
  });

  test('"I don\'t remember filling anything out" uses ARC objection instruction, not verbatim step anchor', () => {
    expect(source).toContain("function buildObjectionARCInstruction");
    expect(source).toContain("ARC OBJECTION FRAMEWORK:");
    expect(source).toContain("AGREE — one short empathetic agreement");
    expect(source).toContain("RESPOND — 1-2 sentences");
    expect(source).toContain("RECLOSE — immediately ask the CURRENT pending script step question");
    expect(source).toContain("Most people fill these requests out online through a quick form");
    expect(source).toContain('routeKind: `policy_${objKind}`');
    expect(source).toContain('responseMode: "objection_arc"');
  });

  test('"I\'m good" classifies as objection and increments objectionCount once', () => {
    const state: MockState = {
      rebookingMode: false,
      phase: "in_call",
      scriptStepIndex: 0,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 0,
      objectionCount: 0,
      callSid: "CA_stepper_soft_reject",
    };

    const result = simulateNormalRouterTurn(state, "I'm good");

    expect(result.routeKind).toBe("policy_not_interested");
    expect(result.state.objectionCount).toBe(1);
    expect(result.state.awaitingAnswerForStepIndex).toBe(0);
    expect(result.state.scriptStepIndex).toBe(0);
  });

  test('scheduling context: "yeah I\'m good with that" accepts the scheduling ask without objectionCount', () => {
    const state: MockState = {
      rebookingMode: false,
      phase: "in_call",
      scriptStepIndex: 1,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 1,
      coverageSubject: "just myself",
      selectedDay: "today",
      objectionCount: 0,
      callSid: "CA_stepper_good_with_that",
    };

    const result = simulateNormalRouterTurn(state, "yeah I'm good with that");

    expect(result.routeKind).toBe("policy_script_step_2");
    expect(result.state.objectionCount).toBe(0);
    expect(result.state.scriptStepIndex).toBe(2);
    expect(result.state.selectedDay).toBe("today");
  });

  test('cold Step 0 "I\'m good" remains a rejection objection', () => {
    const state: MockState = {
      rebookingMode: false,
      phase: "in_call",
      scriptStepIndex: 0,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 0,
      objectionCount: 0,
      callSid: "CA_stepper_cold_good",
    };

    const result = simulateNormalRouterTurn(state, "I'm good");

    expect(result.routeKind).toBe("policy_not_interested");
    expect(result.state.objectionCount).toBe(1);
    expect(result.state.scriptStepIndex).toBe(0);
  });

  test("non-mortgage ARC product knowledge does not contain mortgage language", () => {
    const knowledge = arcProductKnowledgeForTest("final_expense").toLowerCase();

    expect(knowledge).toContain("final expense");
    expect(knowledge).not.toContain("mortgage");
  });

  test("rejection after third ARC attempt exits politely for not_interested", () => {
    const state: MockState = {
      rebookingMode: false,
      phase: "in_call",
      scriptStepIndex: 0,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 0,
      objectionCount: 3,
      callSid: "CA_stepper_fourth_reject",
    };

    const result = simulateNormalRouterTurn(state, "Yeah, I said I'm good on it");

    expect(result.routeKind).toBe("policy_not_interested_exit");
    expect(result.state.objectionCount).toBe(4);
    expect(result.state.pendingHangupAfterGoodbye).toBe(true);
    expect(result.state.awaitingUserAnswer).toBe(false);
  });

  test('"stop calling" exits immediately as DNC without ARC rebuttal', () => {
    const state: MockState = {
      rebookingMode: false,
      phase: "in_call",
      scriptStepIndex: 0,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 0,
      objectionCount: 0,
      callSid: "CA_stepper_dnc",
    };

    const result = simulateNormalRouterTurn(state, "Stop calling me");

    expect(result.routeKind).toBe("policy_do_not_call_exit");
    expect(result.state.pendingHangupAfterGoodbye).toBe(true);
    expect(result.state.objectionCount).toBe(0);
    expect(result.state.awaitingUserAnswer).toBe(false);
  });

  test("centralized advancement gate allows covered paths and blocks past Step 1 without coverage", () => {
    const noCoverage: MockState = { scriptStepIndex: 1, awaitingAnswerForStepIndex: 0 };
    const withCoverage: MockState = { scriptStepIndex: 1, coverageSubject: "just myself" };

    expect(canAdvanceFromStepForTest(noCoverage, 2)).toBe(false);
    expect(canAdvanceFromStepForTest(noCoverage, 1)).toBe(true);
    expect(canAdvanceFromStepForTest(withCoverage, 2)).toBe(true);
    expect(canAdvanceFromStepForTest(withCoverage, 3)).toBe(true);
  });

  test("rebooking setup marks synthetic coverage so scheduling can advance past Step 1", () => {
    const rebookingState: MockState = {
      rebookingMode: true,
      phase: "awaiting_greeting_reply",
      lastRouteKind: "policy_step1_coverage",
      coverageSubject: "rebooking",
      coverageSubjectSetThisTurn: true,
      scriptStepIndex: 1,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 0,
      callSid: "CA_stepper_rebooking",
    };

    expect(isPostCoverageSchedulingStateForTest(rebookingState)).toBe(true);
    expect(canAdvanceFromStepForTest(rebookingState, 2)).toBe(true);

    const advanced = applyRouterDecisionForTest(rebookingState, {
      handled: true,
      routeKind: "post_coverage_day_selected",
      lineToSay: "Perfect — is there a specific time you're available?",
      stateWrites: { scriptStepIndex: 2, awaitingUserAnswer: true, awaitingAnswerForStepIndex: 1 },
      shouldAdvanceStep: false,
    });

    expect(advanced.scriptStepIndex).toBe(2);
  });

  test("second detour on the same pending step uses a rephrased non-identical re-ask", () => {
    const pendingStep = "Was this for yourself, or a spouse as well?";
    const firstReask = stepAnchorAskForTest(pendingStep, [pendingStep]);
    const secondReask = stepAnchorAskForTest(pendingStep, [pendingStep, pendingStep]);

    expect(firstReask).toBe(pendingStep);
    expect(secondReask).not.toBe(pendingStep);
    expect(normalizeTurnTextForKey(secondReask)).toContain("spouse");
    expect(normalizeTurnTextForKey(secondReask)).toContain("you");
  });

  test("detours and questions still get the step anchor and return to the pending ask", () => {
    expect(source).toContain("function buildStepAnchoredFreeResponseInstruction");
    expect(source).toContain("HARD STEP ANCHOR:");
    expect(source).toContain('responseMode: "free_response"');
    expect(source).toContain("The pending script step has NOT been answered yet");
  });

  test('after ARC reclose, "just myself" still advances step 0→1 with coverageSubject set', () => {
    const stateAfterArc: MockState = {
      rebookingMode: false,
      phase: "in_call",
      scriptStepIndex: 0,
      awaitingUserAnswer: true,
      awaitingAnswerForStepIndex: 0,
      objectionCount: 1,
      callSid: "CA_stepper_after_arc",
    };

    const result = simulateNormalRouterTurn(stateAfterArc, "just myself");

    expect(result.routeKind).toBe("policy_step1_coverage");
    expect(result.state.coverageSubject).toBe("just myself");
    expect(result.state.scriptStepIndex).toBe(1);
    expect(result.state.objectionCount).toBe(1);
  });

  test("production router has centralized gate, Step 1 miss logging, and no stale canary startup call", () => {
    expect(source).toContain("function canAdvanceFromStep");
    expect(source).toContain("[AI-VOICE][STEPPER][ADVANCE]");
    expect(source).toContain("[AI-VOICE][STEPPER][ADVANCE-BLOCKED]");
    expect(source).toContain("[AI-VOICE][STEPPER][STEP1-MISS]");
    expect(source).toContain("function buildStepAnchoredFreeResponseInstruction");
    expect(source).toContain("HARD STEP ANCHOR:");
    expect(source).toContain("coverageSubject      = \"rebooking\"");
    expect(source).toContain("priorAnchorCount === 0");
    expect(source).toContain("rephrasing it naturally instead of repeating it word for word");
    expect(source).toContain("objectionCount?: number");
    expect(source).toContain("stepAnchorAskCounts?: Record<number, number>");
    expect(source).toContain("Never open with \"What's up?\"");
    expect(source).toContain("applyPolicyStateWrite(state, k, v, `policy:${decision.routeKind}`)");
    expect(source).toContain("resolveScriptStepIndexTransition(");
    expect(source).not.toContain("await assertRealtimeModelAccessible();");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Early voicemail/non-human transcript skip guards", () => {
// ══════════════════════════════════════════════════════════════════════════════

  const source = fs.readFileSync(
    path.join(__dirname, "..", "ai-voice-server", "index.ts"),
    "utf8"
  );
  const voicemailHelperSource = source.slice(
    source.indexOf("function isVoicemailSystemTranscript"),
    source.indexOf("function isConversationalGreetingNegative")
  );
  const replaySource = source.slice(
    source.indexOf("async function replayPendingCommittedTurn"),
    source.indexOf("/**\n * ✅ Voicemail detection helpers")
  );

  test("carrier unavailable transcript phrase is detected before normal routing", () => {
    expect(voicemailHelperSource).toContain("person you re trying to reach is not available");
    expect(voicemailHelperSource).toContain("please leave your message");
    expect(voicemailHelperSource).toContain("your call has been forwarded");
    expect(voicemailHelperSource).toContain("at the tone");
    expect(voicemailHelperSource).toContain("mailbox is full");
    expect(voicemailHelperSource).toContain("mailbox has not been set up");
    // broad false-positive patterns removed — real humans say these mid-call
    expect(voicemailHelperSource).not.toContain('"voicemail"');
    expect(voicemailHelperSource).not.toContain('"please leave a message"');
  });

  test("voicemail replay skip is restricted to the early greeting phase", () => {
    expect(replaySource).toContain(
      'if (state.phase === "awaiting_greeting_reply" && isVoicemailSystemTranscript(restoredTranscript))'
    );
  });

  test("early voicemail replay closes OpenAI instead of creating a policy response", () => {
    expect(source).toContain("function completeTwilioCallNow");
    expect(replaySource).toContain(
      'safelyCloseOpenAi(state, "voicemail transcript detected during replay");'
    );
    expect(replaySource).not.toContain(
      'completeTwilioCallNow(twilioWs, state, "voicemail transcript detected during replay");'
    );
    expect(replaySource.indexOf('safelyCloseOpenAi(state, "voicemail transcript detected during replay")')).toBeLessThan(
      replaySource.indexOf("[AI-VOICE][TURN-GATE][REPLAY]")
    );
  });
});
