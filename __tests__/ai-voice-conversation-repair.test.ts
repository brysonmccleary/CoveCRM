import fs from "fs";
import path from "path";
import { harness, callState, ctx } from "./helpers/voiceControllerHarness";
import { conversationalSignals } from "../ai-voice-server/lib/conversationRepair";

const current = fs.readFileSync(path.join(process.cwd(), "ai-voice-server/index.ts"), "utf8");
// The untouched, flag-disabled controller is the control group. No git/history dependency.
const baseline = current;
const api = harness(current, { VOICE_PHASE1_TEST_EMAILS: ctx.userEmail,
  VOICE_REALTIME_21_MINI_TEST_V1: "true", VOICE_NATURAL_CONVERSATION_TEST_V1: "true" });
const specimen = ["Good, what's up?", "Just me.", "Well, I don't really know if I can go over this.",
  "You just said that.", "Well, I don't know if I have time to go over it.", "Yep, you already said that again.",
  "You're such a shitty fucking AI. I would never meet with you."];

function initial(a = api, enabled = true) {
  const state = callState(a, enabled, { phase: "awaiting_greeting_reply", scriptStepIndex: 0,
    context: { ...ctx, clientFirstName: "Marcus", agentName: "Bryson McCleary", scriptKey: "veteran_leads",
      liveTransferEnabled: true, liveTransferPhone: "+15005550006" } });
  state.scriptSteps = a.extractScriptStepsFromSelectedScript(a.getSelectedScriptText(state.context), "veteran_leads");
  return state;
}
async function turn(a: any, state: any, text: string, sequence: number) {
  Object.assign(state, { waitingForResponse: false, responseInFlight: false, aiSpeaking: false,
    outboundOpenAiDone: true, lastUserTranscript: text });
  const context = { idx: state.scriptStepIndex, steps: state.scriptSteps,
    expectedAnswerIdx: Math.max(0, state.scriptStepIndex - 1), stepType: "open_question" };
  const count = state.openAiWs.sent.length;
  const handled = await a.handleConversationTurn(state, text, "replay", context, `sequence-${sequence}`, async () => {});
  const emitted = state.openAiWs.sent.slice(count).filter((e: any) => e.type === "response.create");
  expect(handled).toBe(true);
  expect(emitted).toHaveLength(1);
  return { prompt: emitted[0].response.instructions as string, route: state.lastRouteKind,
    pending: state.awaitingAnswerForStepIndex, coverage: state.coverageSubject,
    memory: structuredClone(state.conversationMemory), ended: !!state.pendingHangupAfterGoodbye };
}
async function established() {
  const state = initial();
  await turn(api, state, specimen[0], 0);
  await turn(api, state, specimen[1], 1);
  return state;
}

describe("real failed call, sequential stateful replay (not generated speech)", () => {
  test("baseline reproduces stale coverage, unknown fallback, reclose and anger recovery", async () => {
    const old = harness(baseline); const state = initial(old, false); const trace = [];
    for (let i = 0; i < specimen.length; i++) trace.push(await turn(old, state, specimen[i], i));
    expect(trace[1].pending).toBe(0);
    expect(trace[2].route).toContain("post_coverage_unknown_free");
    expect(trace[2].prompt).toMatch(/Was this for yourself,? or a spouse as well\?/);
    expect(trace[5].route).toContain("correction");
    expect(trace[6].route).toBe("post_coverage_angry_recover");
    expect(trace[6].ended).toBe(false);
  });
  test("same call repaired: facts persist, concerns change strategy, refusal exits without DNC", async () => {
    const state = initial(); const trace = [];
    for (let i = 0; i < specimen.length; i++) trace.push(await turn(api, state, specimen[i], i));
    expect(trace[1]).toMatchObject({ coverage: "self", pending: 1 });
    expect(trace[2].route).toBe("conversation_time_availability");
    expect(trace[3].route).toBe("conversation_repetition");
    expect(trace[4].memory.timeConcerns).toBe(2);
    expect(trace[5].memory.repetitionComplaints).toBe(2);
    for (const event of trace.slice(2, 6)) {
      expect(event.coverage).toBe("self");
      expect(event.pending).toBe(1);
      expect(event.prompt).toContain("Question policy: none");
      expect(event.prompt).toContain('"answeredQuestions":["coverage_subject"]');
      expect(event.prompt).not.toContain('"requiredLine"');
    }
    expect(trace[6]).toMatchObject({ route: "policy_not_interested_exit", ended: true });
    expect(state.finalOutcomeSent).toBe(true);
    expect(state.lastObjectionKind).toBe("not_interested");
    expect(trace[6].prompt).toContain('"requiredLine":"Totally understood');
    expect(trace[6].prompt).toContain('"currentObjective":"close"');
    expect(trace[6].prompt).toContain("another appointment ask");
    expect(trace[6].prompt).not.toContain("remove you");
    expect(state.selectedTimeText).toBeUndefined();
  });
});

describe("compositional concern/precedence matrix", () => {
  test.each(["I can't talk right now.", "I'm in the middle of something.", "I only have a second.",
    "Can we do this another time?", "I'm busy.", "I don't have time for this right now.",
    "I don't really know if I can go over this.", "I'm not sure I have time to discuss it."])("time concern: %s", async text => {
    const state = await established(); const result = await turn(api, state, text, 2);
    expect(result.route).toBe("conversation_time_availability");
    expect(result.prompt).toContain("Question policy: none");
    expect(result.coverage).toBe("self");
  });
  test.each(["You already asked me that.", "I just answered that.", "Didn't you just say that?",
    "You're repeating yourself.", "We already went over this.", "I already told you."])("semantic repetition complaint: %s", async text => {
    const state = await established(); const result = await turn(api, state, text, 2);
    expect(result.route).toBe("conversation_repetition");
    expect(result.prompt).toContain("No question this turn");
    expect(result.memory.bookingSuppressed).toBe(true);
  });
  test.each(["I don't want an appointment.", "I'm not meeting with anybody.", "I would never meet with you.",
    "You're fucking annoying and I will not schedule an appointment."])("appointment refusal wins: %s", async text => {
    const state = await established(); const result = await turn(api, state, text, 2);
    expect(result.route).toBe("policy_not_interested_exit");
    expect(result.ended).toBe(true);
    expect(result.prompt).not.toContain("remove you");
  });
  test.each(["No thanks.", "I'm not interested.", "This is fucking annoying, no thanks."])("ordinary Not Interested retains counters, no pressure: %s", async text => {
    const state = await established(); const result = await turn(api, state, text, 2);
    expect(state.objectionCount).toBe(1);
    expect(result.ended).toBe(false);
    expect(result.prompt).toContain("without another appointment ask");
  });
  test.each(["This is annoying.", "You're pissing me off.", "This AI sucks."])("frustration is not refusal or DNC: %s", async text => {
    const state = await established(); const result = await turn(api, state, text, 2);
    expect(result.route).toBe("conversation_frustration");
    expect(result.ended).toBe(false);
    expect(state.finalOutcomeSent).not.toBe(true);
  });
  test.each(["Stop calling me", "Remove me from your list", "Fuck off, don't call me again"])("existing opt-out wins over everything: %s", async text => {
    const state = await established(); const result = await turn(api, state, text, 2);
    expect(["policy_hard_dnc", "post_coverage_hard_stop", "angry_hard_stop"]).toContain(result.route);
    const old = harness(baseline); const oldState = initial(old, false);
    await turn(old, oldState, specimen[0], 0);
    await turn(old, oldState, specimen[1], 1);
    const oldResult = await turn(old, oldState, text, 2);
    expect(result.ended).toBe(oldResult.ended);
    expect(state.awaitingUserAnswer).toBe(oldState.awaitingUserAnswer);
    expect(state.finalOutcomeSent).toBe(true);
  });
  test("cannot meet right now is not a permanent refusal", () => {
    expect(conversationalSignals("I can't meet right now, can we do this later?")).toMatchObject({ appointmentRefusal: false, timeConcern: true });
  });
});

describe("departures from the perfect script", () => {
  test("repeated objective attempts change strategy even before a complaint", async () => {
    const state = await established();
    state.conversationMemory.recentAttempts = [
      { objective: "booking_choice", strategy: "ask_objective" },
      { objective: "booking_choice", strategy: "ask_objective" }];
    const result = await turn(api, state, "I already have insurance", 2);
    expect(result.memory.lastConcern).toBe("repeated_objective");
    expect(result.prompt).toContain("Do not ask the same semantic");
  });
  test.each(["What about my spouse?", "Could this be for both?", "Maybe for myself"])("question/uncertainty is not a coverage fact: %s", async text => {
    const state = initial(); await turn(api, state, specimen[0], 0);
    await turn(api, state, text, 1);
    expect(state.coverageSubject).toBeUndefined();
  });
  test("hearing request repeats actual speech without losing satisfied facts", async () => {
    const state = await established();
    await api.handleOpenAiEvent(new api.Socket(), state, { type: "response.output_audio_transcript.done",
      item_id: "spoken-2", transcript: "We can find a time that works around your day." });
    const result = await turn(api, state, "I didn't hear you, can you repeat that?", 2);
    expect(result.route).toBe("conversation_hearing");
    expect(result.prompt).toContain("We can find a time that works around your day.");
    expect(result.prompt).toContain("Question policy: repeat_requested");
    expect(result.coverage).toBe("self");
  });
  test("coverage answer plus product question stores fact without replaying the frame", async () => {
    const state = initial(); await turn(api, state, "Good, what's up?", 0);
    const result = await turn(api, state, "For myself, but what is this program?", 1);
    expect(result.coverage).toBe("self");
    expect(result.route).toBe("conversation_question_after_coverage");
    expect(result.prompt).toContain("approved facts only");
  });
  test("busy plus explanation request answers question, no booking pressure", async () => {
    const state = await established(); const result = await turn(api, state, "I'm busy but explain briefly what this is about", 2);
    expect(result.prompt).toContain("Answer their actual question briefly");
    expect(result.prompt).toContain("Question policy: none");
  });
  test("explicit coverage correction updates the remembered fact", async () => {
    const state = await established(); const result = await turn(api, state, "Actually, my spouse", 2);
    expect(result.coverage).toBe("spouse");
    expect(result.pending).not.toBe(0);
  });
  test("partial answer clarifies without fabricated facts/booking", async () => {
    const state = initial(); await turn(api, state, specimen[0], 0);
    const result = await turn(api, state, "Well, I guess maybe", 1);
    expect(result.coverage).toBeUndefined();
    expect(result.prompt).toContain("clarify");
    expect(state.confirmedAppointment).toBeUndefined();
  });
  test("a voluntary scheduling answer can resume after a concern", async () => {
    const state = await established(); await turn(api, state, "I'm busy", 2);
    const result = await turn(api, state, "Tomorrow", 3);
    expect(state.selectedDay).toBe("tomorrow");
    expect(result.memory.bookingSuppressed).toBe(false);
    expect(state.confirmedAppointment).toBeUndefined();
  });
  test("later to explicit live transfer uses the existing transfer action", async () => {
    const state = await established(); await turn(api, state, "Can we do this later?", 2);
    await turn(api, state, "Actually connect me to the agent right now", 3);
    expect(state.pendingLiveTransferAfterLine).toBe(true);
    expect(state.confirmedAppointment).toBeUndefined();
  });
});
