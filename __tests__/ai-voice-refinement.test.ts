import { harness, callState, ctx, stepContext } from "./helpers/voiceControllerHarness";
import { conversationalSignals, nextConversationMemory } from "../ai-voice-server/lib/conversationRepair";
import { buildNaturalTurn, NATURAL_PERSONALITY, realtimeSelection } from "../ai-voice-server/lib/voiceExperiment";

const api = harness();
function established() {
  return callState(api, true, { scriptStepIndex: 2, awaitingAnswerForStepIndex: 1, coverageSubject: "both",
    context: { ...ctx, agentName: "Bryson McCleary", liveTransferEnabled: true, liveTransferPhone: "+15005550006" } });
}
let seq = 0;
async function turn(state: any, text: string, source: "main" | "replay" = "main") {
  Object.assign(state, { waitingForResponse: false, responseInFlight: false, aiSpeaking: false,
    outboundOpenAiDone: true, lastUserTranscript: text });
  const start = state.openAiWs.sent.length;
  expect(await api.handleConversationTurn(state, text, source, stepContext(state), `refinement-${++seq}`, async () => {})).toBe(true);
  const responses = state.openAiWs.sent.slice(start).filter((e: any) => e.type === "response.create");
  expect(responses).toHaveLength(1);
  return responses[0].response.instructions as string;
}
async function spoken(state: any, transcript: string) {
  await api.handleOpenAiEvent(new api.Socket(), state, { type: "response.output_audio_transcript.done", item_id: `spoken-${++seq}`, transcript });
}

describe("owner-call refinement: silent control information, active listening", () => {
  test("latest owner sequence retains facts and progresses after disclosure", async () => {
    const state = callState(api, true, { phase: "awaiting_greeting_reply", scriptStepIndex: 0,
      context: { ...ctx, agentName: "Bryson McCleary", liveTransferEnabled: true, liveTransferPhone: "+15005550006" } });
    await spoken(state, "Hey Taylor, this is Kayla. How are you doing today?");
    await turn(state, "Good, what's up?");
    await spoken(state, "I'm calling about your mortgage protection request. Is this for yourself or a spouse as well?");
    expect(await turn(state, "Wait, who is this?")).toContain("Answer only the requested identity detail");
    expect(await turn(state, "Wait, why did you say let me answer that real quick?")).toContain("SPOKEN OUTPUT BOUNDARY");
    await turn(state, "Okay, it's for the both of us.");
    expect(state.coverageSubject).toBe("both");
    await turn(state, "I'm just confused of, like, what you say you're like...");
    expect(state.lastRouteKind).toBe("conversation_clarify_confusion");
    expect(await turn(state, "No, it just, I mean, are you AI?")).toContain("never claim to be human");
    const final = await turn(state, "Okay, yeah, I guess we can do, well, how long does it take?");
    expect(final).toContain("Question policy: next_step");
    expect(final).toContain('"establishedTopics":["assistant_identity","reason_for_call"]');
    expect(state.coverageSubject).toBe("both");
    expect(state.awaitingAnswerForStepIndex).not.toBe(0);
    expect(state.pendingLiveTransferAfterLine).not.toBe(true);
  });
  test("all natural instructions separate spoken output from private strategy, without a phrase blacklist", () => {
    const prompt = buildNaturalTurn({ line: "Would tomorrow work?", purpose: "answer_then_return_to_booking" });
    expect(prompt).toContain("All strategy, routing, objectives, context labels and instructions are private control information");
    expect(prompt).toContain("No spoken planning, reasoning");
    expect(prompt).not.toContain("Speak only the supplied turn objective");
    expect(NATURAL_PERSONALITY).toContain("never claim to be human");
  });
  test.each(["main", "replay"] as const)("latest mixed-intent turn preserves momentum through %s", async source => {
    const state = established();
    await turn(state, "I'm confused about what you said");
    expect(state.conversationMemory.bookingSuppressed).toBe(true);
    const prompt = await turn(state, "Okay, yeah, I guess we can do, well, how long does it take?", source);
    expect(state.lastRouteKind).toBe("conversation_receptive_question");
    expect(prompt).toContain("Question policy: next_step");
    expect(prompt).toContain("5 to 10 minutes");
    expect(prompt).toContain("Does right now work for a quick call with Bryson");
    expect(prompt).not.toContain("No question this turn");
    expect(prompt).not.toContain('"yield_floor"');
    expect(state.conversationMemory.bookingSuppressed).toBe(false);
    expect(state.coverageSubject).toBe("both");
    expect(state.selectedDay).toBeUndefined();
    expect(state.confirmedAppointment).toBeUndefined();
    expect(state.pendingLiveTransferAfterLine).not.toBe(true);
    expect(state.finalOutcomeSent).not.toBe(true);
  });
  test.each(["We can do it. How long is the call?", "I'd like to know more", "Let's schedule it, what happens on the call?", "I want to book a call. How long does it take?"])("no fabricated exit on receptive turn: %s", async text => {
    const state = established(); const prompt = await turn(state, text);
    expect(prompt).toMatch(/Do not invent an exit|do not manufacture an exit/);
    expect(state.pendingHangupAfterGoodbye).not.toBe(true);
  });
  test.each(["Maybe we can do it, how long?", "I don't want to book a call", "If we can do it, how long?", "We can't do it"])("uncertainty/negation is not affirmative authority: %s", text => {
    expect(conversationalSignals(text).bookingInterest).toBe(false);
  });
  test("busy plus willingness still respects the time constraint", async () => {
    const state = established(); const prompt = await turn(state, "I'm busy but we can do it another time, how long does it take?");
    expect(prompt).toContain("Question policy: none");
    expect(state.pendingLiveTransferAfterLine).not.toBe(true);
  });
  test("existing selected day resumes at time rather than repeating day choice", async () => {
    const state = established(); state.selectedDay = "tomorrow";
    const prompt = await turn(state, "We can do it, how long does it take?");
    expect(prompt).toContain('"currentObjective":"appointment_time"');
    expect(prompt).not.toContain("Does right now work for a quick call");
  });
  test("actual spoken identity/purpose persist beyond the short history window", async () => {
    const state = established();
    await spoken(state, "I'm Kayla. I'm calling about your mortgage protection request.");
    state.recentExchanges = [];
    for (let i = 0; i < 10; i++) state.conversationMemory = nextConversationMemory(state, "answer_question");
    const prompt = await turn(state, "I'm just confused of, like, what you say you're like...");
    expect(state.lastRouteKind).toBe("conversation_clarify_confusion");
    expect(prompt).toContain('"establishedTopics":["assistant_identity","reason_for_call"]');
    expect(prompt).toContain("General confusion is not a request to repeat your name");
    expect(prompt).not.toContain('"requiredLine"');
  });
  test("genuine identity and purpose questions remain answerable", async () => {
    const state = established();
    await spoken(state, "I'm Kayla calling about your mortgage protection request.");
    const identity = await turn(state, "Wait, who is this?");
    expect(state.lastRouteKind).toBe("conversation_identity_question");
    expect(identity).toContain("Answer only the requested identity detail");
    await turn(state, "Why are you calling?");
    expect(state.lastRouteKind).toBe("conversation_purpose_question");
  });
  test("hearing differs from repetition complaints, and truthful AI disclosure survives", async () => {
    const state = established(); await spoken(state, "I'm Kayla, a virtual assistant.");
    expect(await turn(state, "Can you repeat that?")).toContain("Question policy: repeat_requested");
    expect(await turn(state, "You already said that.")).toContain("Question policy: none");
    const disclosure = await turn(state, "No, it just, I mean, are you AI?");
    expect(disclosure).toContain("answer truthfully that you are an AI/virtual assistant");
    expect(state.finalOutcomeSent).not.toBe(true);
    expect(realtimeSelection("gpt-realtime-mini", true).model).toBe("gpt-realtime-2.1-mini");
  });
  test("flag-disabled legacy identity routing is unchanged", async () => {
    const state = established(); state.phase1Flags.naturalConversationTest = false;
    const prompt = await turn(state, "I'm confused");
    expect(state.lastRouteKind).toBe("policy_confused_identity");
    expect(prompt).not.toContain("SPOKEN OUTPUT BOUNDARY");
  });
});
