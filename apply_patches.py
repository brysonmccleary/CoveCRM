#!/usr/bin/env python3
"""
apply_patches.py
Run from repo root:  python3 apply_patches.py ~/covecrm/ai-voice-server/index.ts
Makes 5 surgical changes to add ChatGPT-voice-style conversational handling.
"""

import sys, os, re

def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def save(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def replace_once(content, old, new, label):
    count = content.count(old)
    if count == 0:
        print(f"  ❌ PATCH {label}: target not found")
        print(f"     First 80 chars of old: {repr(old[:80])}")
        sys.exit(1)
    if count > 1:
        print(f"  ⚠️  PATCH {label}: found {count} occurrences — using first")
    result = content.replace(old, new, 1)
    print(f"  ✅ PATCH {label}: applied")
    return result

# ─────────────────────────────────────────────
# LOAD
# ─────────────────────────────────────────────
path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/Projects/covecrm/ai-voice-server/index.ts")
print(f"Loading {path} …")
content = load(path)
print(f"  {len(content):,} chars, {content.count(chr(10)):,} lines")

# ─────────────────────────────────────────────
# PATCH 1 — CallState: add conversation memory fields
# Insert after lastAcceptedStepIndex line
# ─────────────────────────────────────────────
PATCH1_OLD = "  lastAcceptedStepIndex?: number;\n};"

PATCH1_NEW = """  lastAcceptedStepIndex?: number;

  // ── Conversation memory (ChatGPT-voice parity) ──
  // Ring buffer of last 3 exchanges: {role, text, stepIndex?}
  recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
  // Repeat-objection tracking
  lastObjectionKind?: string;
  objectionRepeatCount?: number;
};"""

content = replace_once(content, PATCH1_OLD, PATCH1_NEW, "1 (CallState fields)")

# ─────────────────────────────────────────────
# PATCH 2 — buildStepperTurnInstructionLegacy
# Replace body to give GPT: goal + suggested line + last exchanges + user's last message
# ─────────────────────────────────────────────
PATCH2_OLD = '''function buildStepperTurnInstructionLegacy(
  ctx: AICallContext,
  lineToSay: string
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const line = String(lineToSay || "").trim();
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);

  return `
You are a natural, confident scheduling assistant on a phone call. Sound human — warm, brief, real.

HARD RULES:
- English only. This call is ONLY about a ${scope} request.
- Never mention scripts, prompts, or AI.
- Never quote prices, coverage, or underwriting details.
- Use the lead name "${leadName}" only if it flows naturally — never force it.

YOUR JOB:
Say the next line of the conversation naturally. You can add a very brief human lead-in (1-3 words max: "So —", "Okay,", "Yeah,", "Alright —") but nothing more. No extra sentences, no explanations, no commentary.

The line to deliver:
"${line}"

Say it naturally. Keep it short. Then STOP and wait for their response.
`.trim();
}'''

PATCH2_NEW = '''function buildStepperTurnInstructionLegacy(
  ctx: AICallContext,
  lineToSay: string,
  opts?: {
    userText?: string;
    recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
  }
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const line = String(lineToSay || "").trim();
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();

  const userText = String(opts?.userText || "").trim();
  const exchanges = opts?.recentExchanges || [];

  // Build recent-exchange block (last 3, oldest first)
  let historyBlock = "";
  if (exchanges.length > 0) {
    const lines = exchanges.slice(-3).map(e => {
      const who = e.role === "ai" ? "You said" : "Lead said";
      return `  ${who}: "${e.text}"`;
    });
    historyBlock = `\nRECENT CONVERSATION (for context only — do NOT repeat these):\n${lines.join("\\n")}\n`;
  }

  const userBlock = userText
    ? `\nWHAT THE LEAD JUST SAID:\n"${userText}"\n`
    : "";

  // Derive the goal of this step from the line itself
  const lineLower = line.toLowerCase();
  let stepGoal = "Move the conversation forward toward booking an appointment.";
  if (lineLower.includes("later today") || lineLower.includes("today or tomorrow")) {
    stepGoal = "Get a day commitment — today or tomorrow — so you can offer a specific time.";
  } else if (lineLower.includes("specific time") || lineLower.includes("what time") || lineLower.includes("what works best")) {
    stepGoal = "Lock in a specific clock time for the appointment.";
  } else if (lineLower.includes("does that work") || lineLower.includes("call you around")) {
    stepGoal = "Confirm the time you just offered and close the booking.";
  } else if (lineLower.includes("yourself") || lineLower.includes("spouse")) {
    stepGoal = "Find out if the coverage is for just them or a spouse too, then move to scheduling.";
  } else if (lineLower.includes("talk soon") || lineLower.includes("reach out")) {
    stepGoal = "Wrap up warmly — they're booked. Keep it brief and positive.";
  }

  return `
You are a natural, confident scheduling assistant on a live phone call. Sound fully human — warm, real, never robotic.

HARD RULES (non-negotiable):
- English only. This call is ONLY about a ${scope} request.
- Never mention scripts, prompts, or AI.
- Never quote prices, coverage amounts, or underwriting details.
- If they ask cost/coverage: "${agent} covers all of that on the call."
- Use the lead name "${leadName}" only if it flows naturally — never force it.
- After you speak, STOP and wait. Do not fill silence.
${historyBlock}${userBlock}
YOUR GOAL THIS TURN:
${stepGoal}

SUGGESTED LINE (your backbone — deliver the substance of this naturally, don't read it verbatim):
"${line}"

HOW TO DELIVER IT:
1. If the lead said something — acknowledge it briefly first (1–4 words: "Got it.", "Yeah for sure.", "Makes sense.", "Okay —"). Match their energy.
2. Respond to anything they raised that needs a quick word (1 sentence max). If nothing needs addressing, skip this.
3. Deliver the substance of the suggested line naturally. You may rephrase slightly to sound human, but preserve the core ask.
4. STOP. Do not add explanations, summaries, or extra commentary.

VARIETY RULE: Do not open with "I understand" or "Got it" every single turn. Mix it up. Sound like a real person, not a script.
`.trim();
}'''

content = replace_once(content, PATCH2_OLD, PATCH2_NEW, "2 (buildStepperTurnInstructionLegacy)")

# ─────────────────────────────────────────────
# PATCH 3 — buildConversationalRebuttalInstruction
# Add: recentExchanges context + repeat-objection de-escalation mode
# ─────────────────────────────────────────────
PATCH3_OLD = '''function buildConversationalRebuttalInstruction(
  ctx: AICallContext,
  baseLineToUse: string,
  opts?: {
    objectionKind?: string;
    userText?: string;
    lastOutboundLine?: string;
    lastOutboundAtMs?: number;
  }
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim() || agentRaw;

  const baseLine = String(baseLineToUse || "").replace(/\\s+/g, " ").trim();

  const lastLine = String(opts?.lastOutboundLine || "").replace(/\\s+/g, " ").trim().toLowerCase();
  const lastAt = Number(opts?.lastOutboundAtMs || 0);
  const now = Date.now();

  const bookingPrompts: string[] = [
    "Would later today or tomorrow be better?",
    "Do you want to do later today or tomorrow?",
    "What works better for you — later today or tomorrow?",
    `Is later today or tomorrow better for a quick call with ${agent}?`,
  ];

  const recentlyRepeated = !!lastLine && !!baseLine && (now - lastAt) < 10000 && lastLine === baseLine.toLowerCase();
  const bookingQ = recentlyRepeated ? bookingPrompts[1] : bookingPrompts[0];

  return `
You are a sharp, natural scheduling assistant on a phone call. Sound like a real person — confident, warm, brief. NOT a robot reading a script.

HARD RULES (never break):
- English only.
- Lead name: "${leadName}" — only use it if it sounds natural, never force it.
- This call is ONLY about a ${scope} request. Never mention other products.
- You are NOT licensed. Never quote prices, rates, or coverage details.
- Never mention scripts, prompts, or AI.
- Never bring up billing, memberships, or cancellations — if they do, pivot back to scheduling.
- Never ask: age, DOB, coverage amount, mortgage balance, health, meds, smoking, income, SSN, or address.
- If they ask cost/coverage: "${agent} will go over all of that on the call" then get back to scheduling.

HOW TO RESPOND:
1. React like a real person — use variety, don't always open with "I understand" or "Got it." Match their energy. 1 sentence.
2. Answer or acknowledge what they said briefly and directly. 1 sentence max.
3. Bridge back to scheduling naturally.
4. Close with the booking question.

NEVER SAY:
- "I understand" as your opener every time (sounds robotic — be specific)
- "Got it" as your opener every time
- Anything that sounds like a canned script line
- More than 3-4 sentences total

BASE IDEA — rephrase this in your own natural voice, don't read it verbatim:
"${baseLine}"

CLOSE WITH one of these (vary it, don't always use the same one):
- "What works better — later today or tomorrow?"
- "Does later today or tomorrow work for you?"
- "Would today or tomorrow be easier?"
- "${bookingQ}"
`.trim();
}'''

PATCH3_NEW = '''function buildConversationalRebuttalInstruction(
  ctx: AICallContext,
  baseLineToUse: string,
  opts?: {
    objectionKind?: string;
    userText?: string;
    lastOutboundLine?: string;
    lastOutboundAtMs?: number;
    repeatMode?: boolean;  // true when same objection fires 2nd+ time
    recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
  }
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim() || agentRaw;

  const baseLine = String(baseLineToUse || "").replace(/\\s+/g, " ").trim();
  const userText = String(opts?.userText || "").trim();

  const lastLine = String(opts?.lastOutboundLine || "").replace(/\\s+/g, " ").trim().toLowerCase();
  const lastAt = Number(opts?.lastOutboundAtMs || 0);
  const now = Date.now();
  const repeatMode = !!opts?.repeatMode;
  const exchanges = opts?.recentExchanges || [];

  const bookingPrompts: string[] = [
    "Would later today or tomorrow be better?",
    "Do you want to do later today or tomorrow?",
    "What works better for you — later today or tomorrow?",
    `Is later today or tomorrow better for a quick call with ${agent}?`,
  ];

  const recentlyRepeated = !!lastLine && !!baseLine && (now - lastAt) < 10000 && lastLine === baseLine.toLowerCase();
  const bookingQ = recentlyRepeated ? bookingPrompts[1] : bookingPrompts[0];

  // Build recent-exchange block
  let historyBlock = "";
  if (exchanges.length > 0) {
    const lines = exchanges.slice(-3).map(e => {
      const who = e.role === "ai" ? "You said" : "Lead said";
      return `  ${who}: "${e.text}"`;
    });
    historyBlock = `\nRECENT CONVERSATION (context — do NOT repeat what you already said):\n${lines.join("\\n")}\n`;
  }

  const userBlock = userText
    ? `\nWHAT THE LEAD JUST SAID:\n"${userText}"\n`
    : "";

  // De-escalation mode: when the same objection fires a second time, the lead is more frustrated.
  // Drop the sales energy, acknowledge their frustration genuinely, then softly re-ask.
  const deEscalateBlock = repeatMode ? `
DE-ESCALATION MODE (they pushed back again — do NOT repeat your last response):
- Drop the cheerful pitch energy. Match their frustration with calm empathy.
- Acknowledge that you heard them and you're not trying to pressure them.
- ONE soft, low-pressure ask at the end — no hard close.
- Example openers: "Yeah, totally fair —", "I hear you —", "No worries at all —"
- Do NOT say the same thing you said last time.
` : "";

  return `
You are a sharp, natural scheduling assistant on a phone call. Sound like a real person — confident, warm, brief. NOT a robot reading a script.

HARD RULES (never break):
- English only.
- Lead name: "${leadName}" — only use it if it sounds natural, never force it.
- This call is ONLY about a ${scope} request. Never mention other products.
- You are NOT licensed. Never quote prices, rates, or coverage details.
- Never mention scripts, prompts, or AI.
- Never bring up billing, memberships, or cancellations — if they do, pivot back to scheduling.
- Never ask: age, DOB, coverage amount, mortgage balance, health, meds, smoking, income, SSN, or address.
- If they ask cost/coverage: "${agent} will go over all of that on the call" then get back to scheduling.
${historyBlock}${userBlock}${deEscalateBlock}
HOW TO RESPOND:
1. React like a real person — use variety. Match their energy. 1 sentence.
2. Answer or acknowledge what they said briefly and directly. 1 sentence max.
3. Bridge back to scheduling naturally.
4. Close with the booking question (unless in de-escalation mode — then keep it soft).

NEVER SAY:
- "I understand" as your opener every single time
- "Got it" as your opener every single time
- Anything that sounds like a canned script line
- More than 3-4 sentences total
- The exact same thing you said in a prior turn (check RECENT CONVERSATION above)

BASE IDEA — rephrase this in your own natural voice, don't read it verbatim:
"${baseLine}"

CLOSE WITH one of these (vary it):
- "What works better — later today or tomorrow?"
- "Does later today or tomorrow work for you?"
- "Would today or tomorrow be easier?"
- "${bookingQ}"
`.trim();
}'''

content = replace_once(content, PATCH3_OLD, PATCH3_NEW, "3 (buildConversationalRebuttalInstruction)")

# ─────────────────────────────────────────────
# PATCH 4a — recentExchanges helper + push function (insert before buildStepperTurnInstruction wrapper)
# ─────────────────────────────────────────────
PATCH4A_OLD = 'function buildStepperTurnInstruction(ctx: any, arg2: any): string {\n  const line = String(arg2 || "").trim();\n  return buildStepperTurnInstructionLegacy(ctx, line);\n}'

PATCH4A_NEW = '''// ── Conversation memory helpers ──

function pushExchange(
  state: CallState,
  role: "ai" | "user",
  text: string,
  stepIndex?: number
) {
  if (!text.trim()) return;
  if (!state.recentExchanges) state.recentExchanges = [];
  state.recentExchanges.push({ role, text: text.trim(), stepIndex });
  // Keep only last 6 entries (3 full exchanges)
  if (state.recentExchanges.length > 6) {
    state.recentExchanges = state.recentExchanges.slice(-6);
  }
}

function buildStepperTurnInstruction(ctx: any, arg2: any, opts?: {
  userText?: string;
  recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
}): string {
  const line = String(arg2 || "").trim();
  return buildStepperTurnInstructionLegacy(ctx, line, opts);
}'''

content = replace_once(content, PATCH4A_OLD, PATCH4A_NEW, "4a (pushExchange helper + buildStepperTurnInstruction wrapper)")

# ─────────────────────────────────────────────
# PATCH 4b — REBUTTAL-GATE in handleOpenAiEvent (input_audio_buffer.committed path)
# Add: repeat-objection tracking + pass recentExchanges + push to exchange buffer
# Target: the objectionOrQuestionKind block in the main committed handler
# We find the unique block by its console.log then the rebuttal path
# ─────────────────────────────────────────────

# Find the REBUTTAL-GATE in the committed handler (not replayPending) by unique surrounding context
# The committed handler has:  if (objectionOrQuestionKind) { ... state.openAiWs.send ... state.awaitingUserAnswer = true; ... state.phase = "in_call"; return; }
# We patch the response.create send inside the committed handler's rebuttal block

PATCH4B_OLD = '''      const lineToSay = enforceBookingOnlyLine(
        state.context!,
        overrideRebuttalLine || getRebuttalLine(state.context!, objectionOrQuestionKind)
      );
      const perTurnInstr = buildConversationalRebuttalInstruction(state.context!, lineToSay, {
        objectionKind: objectionOrQuestionKind,
        userText: lastUserText,
        lastOutboundLine: state.lastPromptLine,
        lastOutboundAtMs: state.lastPromptSentAtMs,
      });

      // ✅ consume awaitingUserAnswer ONLY when we are about to speak
      state.awaitingUserAnswer = false;
      state.awaitingAnswerForStepIndex = undefined;

      state.userAudioMsBuffered = 0;
      state.lastUserTranscript = "";
      state.lowSignalCommitCount = 0;

      await humanPause();

      setWaitingForResponse(state, true, "response.create (rebuttal)");
      setAiSpeaking(state, true, "response.create (rebuttal)");
      setResponseInFlight(state, true, "response.create (rebuttal)");
      state.outboundOpenAiDone = false;

      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = lineToSay;
      state.lastResponseCreateAtMs = Date.now();

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: { modalities: ["audio", "text"], temperature: 0.6, instructions: perTurnInstr },
        })
      );


      // ✅ After an objection rebuttal, re-arm the stepper so the next user reply
      // is treated as answering the last asked step (keeps script flow natural).
      state.awaitingUserAnswer = true;
      state.awaitingAnswerForStepIndex = expectedAnswerIdx;

      state.phase = "in_call";
      return;
    }

    const audioMs = Number(state.userAudioMsBuffered || 0);'''

PATCH4B_NEW = '''      const lineToSay = enforceBookingOnlyLine(
        state.context!,
        overrideRebuttalLine || getRebuttalLine(state.context!, objectionOrQuestionKind)
      );

      // ── Repeat-objection tracking ──
      const isRepeatObjection =
        !!state.lastObjectionKind &&
        state.lastObjectionKind === objectionOrQuestionKind;
      if (isRepeatObjection) {
        state.objectionRepeatCount = (state.objectionRepeatCount || 0) + 1;
      } else {
        state.lastObjectionKind = objectionOrQuestionKind;
        state.objectionRepeatCount = 0;
      }
      const repeatMode = isRepeatObjection && (state.objectionRepeatCount || 0) >= 1;

      // Push user turn to exchange memory before building instruction
      if (lastUserText) pushExchange(state, "user", lastUserText, expectedAnswerIdx);

      const perTurnInstr = buildConversationalRebuttalInstruction(state.context!, lineToSay, {
        objectionKind: objectionOrQuestionKind,
        userText: lastUserText,
        lastOutboundLine: state.lastPromptLine,
        lastOutboundAtMs: state.lastPromptSentAtMs,
        repeatMode,
        recentExchanges: state.recentExchanges,
      });

      // ✅ consume awaitingUserAnswer ONLY when we are about to speak
      state.awaitingUserAnswer = false;
      state.awaitingAnswerForStepIndex = undefined;

      state.userAudioMsBuffered = 0;
      state.lastUserTranscript = "";
      state.lowSignalCommitCount = 0;

      await humanPause();

      setWaitingForResponse(state, true, "response.create (rebuttal)");
      setAiSpeaking(state, true, "response.create (rebuttal)");
      setResponseInFlight(state, true, "response.create (rebuttal)");
      state.outboundOpenAiDone = false;

      state.lastPromptSentAtMs = Date.now();
      state.lastPromptLine = lineToSay;
      state.lastResponseCreateAtMs = Date.now();

      // Push AI rebuttal line to exchange memory
      pushExchange(state, "ai", lineToSay, expectedAnswerIdx);

      state.openAiWs.send(
        JSON.stringify({
          type: "response.create",
          response: { modalities: ["audio", "text"], temperature: 0.6, instructions: perTurnInstr },
        })
      );


      // ✅ After an objection rebuttal, re-arm the stepper so the next user reply
      // is treated as answering the last asked step (keeps script flow natural).
      state.awaitingUserAnswer = true;
      state.awaitingAnswerForStepIndex = expectedAnswerIdx;

      state.phase = "in_call";
      return;
    }

    const audioMs = Number(state.userAudioMsBuffered || 0);'''

content = replace_once(content, PATCH4B_OLD, PATCH4B_NEW, "4b (REBUTTAL-GATE committed — repeat tracking + exchange memory)")

# ─────────────────────────────────────────────
# PATCH 4c — Wire recentExchanges + user push into the SCRIPT STEP path (committed handler)
# Find the stepper send block in committed handler and add pushExchange calls + pass opts
# ─────────────────────────────────────────────
PATCH4C_OLD = '''    const perTurnInstr = buildStepperTurnInstruction(state.context!, lineToSay);
    try { console.log("[AI-VOICE][STEPPER][SEND]", { callSid: state.callSid, stepIndex: idx, expectedAnswerIdx, stepType, lineToSay }); } catch {}
    // ✅ Patch 3: remember what we accepted from the user BEFORE clearing transcript
    if (lastUserText) {
      state.lastAcceptedUserText = lastUserText;
      state.lastAcceptedStepType = stepType;
      state.lastAcceptedStepIndex = expectedAnswerIdx;

      // ✅ Track last exact clock time (for booking control that triggers on the confirm "yes")
      if (isExactClockTimeMentioned(lastUserText)) {
        (state as any).lastExactTimeText = lastUserText;
        (state as any).lastExactTimeAtMs = Date.now();
      }
    }

    // ✅ consume awaitingUserAnswer ONLY when we are about to speak
    state.awaitingUserAnswer = false;
    state.awaitingAnswerForStepIndex = undefined;

    state.userAudioMsBuffered = 0;
    state.lastUserTranscript = "";
    state.lowSignalCommitCount = 0;
    state.repromptCountForCurrentStep = 0;

    await humanPause();

    setWaitingForResponse(state, true, "response.create (script step)");
    setAiSpeaking(state, true, "response.create (script step)");
    setResponseInFlight(state, true, "response.create (script step)");
    state.outboundOpenAiDone = false;
    try { console.log("[AI-VOICE][RESPONSE-CREATE][SCRIPT]", { callSid: state.callSid, phase: state.phase, waitingForResponse: !!state.waitingForResponse, responseInFlight: !!state.responseInFlight, aiSpeaking: !!state.aiSpeaking, stepIndex: idx, stepType, lineHash: hash8(lineToSay), instructionLen: perTurnInstr.length }); } catch {}'''

PATCH4C_NEW = '''    // Push user answer to exchange memory before building instruction
    if (lastUserText) pushExchange(state, "user", lastUserText, expectedAnswerIdx);

    const perTurnInstr = buildStepperTurnInstruction(state.context!, lineToSay, {
      userText: lastUserText,
      recentExchanges: state.recentExchanges,
    });
    try { console.log("[AI-VOICE][STEPPER][SEND]", { callSid: state.callSid, stepIndex: idx, expectedAnswerIdx, stepType, lineToSay }); } catch {}
    // ✅ Patch 3: remember what we accepted from the user BEFORE clearing transcript
    if (lastUserText) {
      state.lastAcceptedUserText = lastUserText;
      state.lastAcceptedStepType = stepType;
      state.lastAcceptedStepIndex = expectedAnswerIdx;

      // ✅ Track last exact clock time (for booking control that triggers on the confirm "yes")
      if (isExactClockTimeMentioned(lastUserText)) {
        (state as any).lastExactTimeText = lastUserText;
        (state as any).lastExactTimeAtMs = Date.now();
      }
    }

    // ✅ consume awaitingUserAnswer ONLY when we are about to speak
    state.awaitingUserAnswer = false;
    state.awaitingAnswerForStepIndex = undefined;

    state.userAudioMsBuffered = 0;
    state.lastUserTranscript = "";
    state.lowSignalCommitCount = 0;
    state.repromptCountForCurrentStep = 0;

    await humanPause();

    setWaitingForResponse(state, true, "response.create (script step)");
    setAiSpeaking(state, true, "response.create (script step)");
    setResponseInFlight(state, true, "response.create (script step)");
    state.outboundOpenAiDone = false;

    // Push AI line to exchange memory
    pushExchange(state, "ai", lineToSay, idx);

    try { console.log("[AI-VOICE][RESPONSE-CREATE][SCRIPT]", { callSid: state.callSid, phase: state.phase, waitingForResponse: !!state.waitingForResponse, responseInFlight: !!state.responseInFlight, aiSpeaking: !!state.aiSpeaking, stepIndex: idx, stepType, lineHash: hash8(lineToSay), instructionLen: perTurnInstr.length }); } catch {}'''

content = replace_once(content, PATCH4C_OLD, PATCH4C_NEW, "4c (script step path — push exchanges + pass opts to instruction)")

# ─────────────────────────────────────────────
# PATCH 5 — Free-response fallback
# After the reprompt block returns, if NOTHING matched (no objection, no real answer, hesitation only),
# we currently just return silently. Instead: build a freeform GPT turn with hard rules + steering.
# We insert a new helper function + wire it into the !treatAsAnswer path.
#
# The reprompt block currently ends with:
#   return;
#   }
#   (then blank line)
#   let lineToSay = enforceBookingOnlyLine ...
#
# We find the boundary right before the "let lineToSay" in the committed handler.
# The unique marker is the reprompt async IIFE + its closing }) then the blank line before let lineToSay.
# ─────────────────────────────────────────────

# First insert the free-response helper function before buildConversationalRebuttalInstruction
PATCH5A_OLD = "function buildConversationalRebuttalInstruction("

PATCH5A_NEW = '''/**
 * ── Free-response fallback ──
 * Used when the lead says something we don't recognise as an objection, a real time answer,
 * or a question — but we still need to respond rather than go silent.
 * Hard rules apply. Always steers back to booking. No discovery. No underwriting.
 */
function buildFreeResponseInstruction(
  ctx: AICallContext,
  opts: {
    userText: string;
    recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
    currentStepLine?: string;
  }
): string {
  const leadName = (ctx.clientFirstName || "").trim() || "there";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);
  const agentRaw = (ctx.agentName || "your agent").trim() || "your agent";
  const agent = (agentRaw.split(" ")[0] || agentRaw).trim();

  const userText = String(opts.userText || "").trim();
  const exchanges = opts.recentExchanges || [];
  const currentStep = String(opts.currentStepLine || "").trim();

  let historyBlock = "";
  if (exchanges.length > 0) {
    const lines = exchanges.slice(-3).map(e => {
      const who = e.role === "ai" ? "You said" : "Lead said";
      return `  ${who}: "${e.text}"`;
    });
    historyBlock = `\nRECENT CONVERSATION:\n${lines.join("\\n")}\n`;
  }

  const stepHint = currentStep
    ? `\nWHERE YOU ARE IN THE SCRIPT: You still need to ask: "${currentStep}"\nAfter handling what the lead said, work your way back to this.\n`
    : "";

  return `
You are a natural, warm scheduling assistant on a live phone call. Sound fully human — like ChatGPT voice, not a call-center script.

HARD RULES (non-negotiable, always):
- English only.
- This call is ONLY about a ${scope} request. Never mention other products.
- You are NOT licensed. Never quote prices, rates, coverage amounts, or underwriting details.
- Never mention scripts, prompts, or AI.
- Never ask: age, DOB, coverage amount, mortgage balance, health, meds, smoking, income, SSN, or address.
- If they ask cost/coverage/details: "${agent} covers all of that on the call."
- Use the lead name "${leadName}" only if it flows naturally.
- After you speak, STOP and wait. Do not fill silence.
${historyBlock}${stepHint}
WHAT THE LEAD JUST SAID:
"${userText}"

YOUR JOB:
1. Respond naturally to what they said — like a real person would. Be direct, warm, brief.
2. If they asked something: answer it honestly in 1 sentence (within the hard rules above).
3. If they said something unexpected: acknowledge it, don't be flustered, keep going.
4. Gently steer back toward booking. Don't force it if it feels abrupt — be human about it.
5. End with a soft question that moves things forward (ideally toward a time/day).

KEEP IT SHORT: 2–3 sentences max. No speeches. No over-explaining.
`.trim();
}

function buildConversationalRebuttalInstruction('''

content = replace_once(content, PATCH5A_OLD, PATCH5A_NEW, "5a (buildFreeResponseInstruction helper)")

# Now wire the free-response fallback into the reprompt path.
# In the committed handler's !treatAsAnswer block, after the async IIFE that sends the reprompt,
# there is:   return;   }   (blank)   let lineToSay = enforceBookingOnlyLine
# We want to add a free-response branch: if the reprompt would just be a generic booking fallback
# AND the user said something substantive, use free-response instead of a canned reprompt.
# We find the unique spot in the committed handler:

PATCH5B_OLD = '''    if (!treatAsAnswer || forceNotAnswer) {
      // ✅ HOTFIX: Never go silent after a committed user turn.
      // If we didn't accept it as a real answer, immediately reprompt.
      const repromptN = Number(state.repromptCountForCurrentStep || 0);
      state.repromptCountForCurrentStep = repromptN + 1;

      // ✅ Keep booking ladder stable:
      // If the user is clearly talking about availability/times (e.g. "what times do you have tomorrow evening"),
      // do NOT reset to "today or tomorrow" — offer concrete options and hold position.
      let repromptLine = getRepromptLineForStepType(state.context!, stepType, repromptN);
      try {
        if (hasTranscript) {
          const wantsTime =
            stepType === "time_question" ||
            isTimeIndecisionOrAvailability(lastUserText) ||
            isTimeMentioned(lastUserText);
          if (wantsTime) {
            const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
            const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
            repromptLine = getTimeOfferLine(
              state.context!,
              n,
              pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")),
              pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")),
              lastUserText
            );
            state.timeOfferCountForStepIndex = idx;
            state.timeOfferCount = n + 1;
          }
        }
      } catch {}
    
      try {
        console.log("[AI-VOICE][TURN-GATE] not-real-answer -> reprompt", {
          callSid: state.callSid,
          streamSid: state.streamSid,
          stepType,
          audioMs: Number(audioMs || 0),
          hasText: !!String(lastUserText || "").trim(),
          n: repromptN,
        });
      } catch {}
    
      (async () => {
        try {
          await humanPause();
        } catch {}
    
        // mark state as speaking/in-flight (use canonical setters)

        try {

          const instr = buildStepperTurnInstruction(state.context!, repromptLine);


          setWaitingForResponse(state, true, "response.create (reprompt)");

          setAiSpeaking(state, true, "response.create (reprompt)");

          setResponseInFlight(state, true, "response.create (reprompt)");

          state.outboundOpenAiDone = false;


          state.lastPromptSentAtMs = Date.now();

          state.lastPromptLine = repromptLine;

          state.lastResponseCreateAtMs = Date.now();


          state.openAiWs!.send(JSON.stringify({

            type: "response.create",

            response: { modalities: ["audio", "text"], instructions: instr },

          }));

        } catch (e) {

          try {
            console.log("[AI-VOICE] Error sending reprompt response.create:", String(e));
          } catch {}
        }
      })();
    
      return;
    }'''

PATCH5B_NEW = '''    if (!treatAsAnswer || forceNotAnswer) {
      // ✅ HOTFIX: Never go silent after a committed user turn.
      // If we didn't accept it as a real answer, immediately reprompt — or use free-response.
      const repromptN = Number(state.repromptCountForCurrentStep || 0);
      state.repromptCountForCurrentStep = repromptN + 1;

      // ✅ Keep booking ladder stable:
      // If the user is clearly talking about availability/times (e.g. "what times do you have tomorrow evening"),
      // do NOT reset to "today or tomorrow" — offer concrete options and hold position.
      let repromptLine = getRepromptLineForStepType(state.context!, stepType, repromptN);
      try {
        if (hasTranscript) {
          const wantsTime =
            stepType === "time_question" ||
            isTimeIndecisionOrAvailability(lastUserText) ||
            isTimeMentioned(lastUserText);
          if (wantsTime) {
            const sameStep = Number(state.timeOfferCountForStepIndex ?? -1) === Number(idx);
            const n = sameStep ? Number(state.timeOfferCount || 0) : 0;
            repromptLine = getTimeOfferLine(
              state.context!,
              n,
              pickDayHint(lastUserText, String(state.lastAcceptedUserText || "")),
              pickTimeWindowHint(lastUserText, String(state.lastAcceptedUserText || "")),
              lastUserText
            );
            state.timeOfferCountForStepIndex = idx;
            state.timeOfferCount = n + 1;
          }
        }
      } catch {}

      // ── Free-response branch ──
      // If the lead said something substantive that doesn't fit the time ladder or reprompt patterns,
      // use a freeform GPT response instead of a canned reprompt line.
      // Criteria: has real transcript + not a time/availability statement + repromptLine is the generic fallback.
      const useFreeResponse = (() => {
        try {
          if (!hasTranscript) return false;
          if (!lastUserText || lastUserText.trim().length < 4) return false;
          // Time/availability is handled by the time ladder above — don't free-respond to that
          if (isTimeIndecisionOrAvailability(lastUserText)) return false;
          if (isTimeMentioned(lastUserText)) return false;
          // If we're just re-asking the same step type and the reprompt is already tailored, use it
          if (stepType === "time_question") return false;
          // Use free-response when the line is the generic booking fallback (not tailored)
          const fallback = getBookingFallbackLine(state.context!).toLowerCase();
          if (repromptLine.toLowerCase().includes(fallback.slice(0, 40))) return true;
          // Also free-respond when on reprompt 1+ for open/yesno and user said something real
          if ((stepType === "open_question" || stepType === "yesno_question") && repromptN >= 1) return true;
          return false;
        } catch { return false; }
      })();

      try {
        console.log("[AI-VOICE][TURN-GATE] not-real-answer ->", useFreeResponse ? "free-response" : "reprompt", {
          callSid: state.callSid,
          streamSid: state.streamSid,
          stepType,
          audioMs: Number(audioMs || 0),
          hasText: !!String(lastUserText || "").trim(),
          n: repromptN,
          useFreeResponse,
        });
      } catch {}

      if (lastUserText) pushExchange(state, "user", lastUserText, expectedAnswerIdx);

      (async () => {
        try {
          await humanPause();
        } catch {}

        try {
          let instr: string;
          let lineForMemory: string;

          if (useFreeResponse) {
            instr = buildFreeResponseInstruction(state.context!, {
              userText: lastUserText,
              recentExchanges: state.recentExchanges,
              currentStepLine: steps[idx] || "",
            });
            lineForMemory = `[free-response to: "${lastUserText.slice(0, 60)}"]`;
          } else {
            instr = buildStepperTurnInstruction(state.context!, repromptLine, {
              userText: lastUserText,
              recentExchanges: state.recentExchanges,
            });
            lineForMemory = repromptLine;
          }

          pushExchange(state, "ai", lineForMemory);

          setWaitingForResponse(state, true, "response.create (reprompt/free)");
          setAiSpeaking(state, true, "response.create (reprompt/free)");
          setResponseInFlight(state, true, "response.create (reprompt/free)");
          state.outboundOpenAiDone = false;

          state.lastPromptSentAtMs = Date.now();
          state.lastPromptLine = useFreeResponse ? repromptLine : repromptLine;
          state.lastResponseCreateAtMs = Date.now();

          state.openAiWs!.send(JSON.stringify({
            type: "response.create",
            response: { modalities: ["audio", "text"], temperature: 0.75, instructions: instr },
          }));

        } catch (e) {
          try { console.log("[AI-VOICE] Error sending reprompt/free response.create:", String(e)); } catch {}
        }
      })();

      return;
    }'''

content = replace_once(content, PATCH5B_OLD, PATCH5B_NEW, "5b (free-response branch in !treatAsAnswer)")

# ─────────────────────────────────────────────
# PATCH 6 — Reset recentExchanges + objection repeat fields on call start (handleStart)
# ─────────────────────────────────────────────
PATCH6_OLD = "  state.awaitingUserAnswer = false;\n  state.awaitingAnswerForStepIndex = undefined;\n\n  // ✅ reset one-time TURN-GATE logs for this call"

PATCH6_NEW = """  state.awaitingUserAnswer = false;
  state.awaitingAnswerForStepIndex = undefined;

  // ── conversation memory reset ──
  state.recentExchanges = [];
  state.lastObjectionKind = undefined;
  state.objectionRepeatCount = 0;

  // ✅ reset one-time TURN-GATE logs for this call"""

content = replace_once(content, PATCH6_OLD, PATCH6_NEW, "6 (reset conversation memory on call start)")

# ─────────────────────────────────────────────
# WRITE
# ─────────────────────────────────────────────
backup = path + ".bak"
import shutil
shutil.copy2(path, backup)
print(f"\nBackup saved to {backup}")

save(path, content)
print(f"Patched file written to {path}")
print(f"  {len(content):,} chars, {content.count(chr(10)):,} lines")
print("\nAll patches applied. Run: cd ~/covecrm/ai-voice-server && npx tsc --noEmit")
