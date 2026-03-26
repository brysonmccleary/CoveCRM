#!/usr/bin/env python3
"""
fix_greeting_objection.py — 2 targeted fixes
Run: python3 fix_greeting_objection.py ~/Projects/covecrm/ai-voice-server/index.ts

FIX 1: isGreetingReply handler — check for objections BEFORE firing Step 1.
        If the lead says "already got it taken care of" as their first response,
        route to REBUTTAL-GATE instead of advancing the script.

FIX 2: Free-response speed — skip humanPause() for free-response turns.
        The 120-220ms pause + GPT generation was causing ~5s total delay.
        Free-response turns should fire immediately (no artificial pause).
"""

import sys, os, shutil

def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def save(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def replace_once(content, old, new, label):
    count = content.count(old)
    if count == 0:
        print(f"  ❌ FIX {label}: target not found")
        print(f"     First 80 chars: {repr(old[:80])}")
        sys.exit(1)
    if count > 1:
        print(f"  ⚠️  FIX {label}: {count} occurrences — using first")
    result = content.replace(old, new, 1)
    print(f"  ✅ FIX {label}: applied")
    return result

path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Projects/covecrm/ai-voice-server/index.ts"
)
print(f"Loading {path} ...")
content = load(path)
print(f"  {len(content):,} chars, {content.count(chr(10)):,} lines")

# ─────────────────────────────────────────────────────────────
# FIX 1 — isGreetingReply: check for objections first
# If the lead objects on their very first response (before the script
# even starts), we need to handle it as a rebuttal, not advance Step 1.
# ─────────────────────────────────────────────────────────────
FIX1_OLD = '''    if (isGreetingReply) {
      const lineToSay = steps[0] || getBookingFallbackLine(state.context!);

      // ✅ Guard: do NOT treat empty/noisy commits as a greeting reply.
      // Require real words OR strong audio (fallback) before advancing past greeting.
      const greetAudioMs = Number(state.userAudioMsBuffered || 0);
      if (!lastUserText && greetAudioMs < 1400) return;
      const ack = getGreetingAckPrefix(lastUserText);'''

FIX1_NEW = '''    if (isGreetingReply) {
      const lineToSay = steps[0] || getBookingFallbackLine(state.context!);

      // ✅ Guard: do NOT treat empty/noisy commits as a greeting reply.
      // Require real words OR strong audio (fallback) before advancing past greeting.
      const greetAudioMs = Number(state.userAudioMsBuffered || 0);
      if (!lastUserText && greetAudioMs < 1400) return;

      // ✅ Objection check: if the lead objects on their very first response
      // (e.g. "already got it taken care of", "not interested", "remove me"),
      // route to the rebuttal handler instead of advancing the script.
      // This catches objections that fire before awaitingUserAnswer is set.
      const greetingObjKind = lastUserText ? detectObjection(lastUserText) : null;
      const greetingQKind = lastUserText ? detectQuestionKindForTurn(lastUserText, state) : null;
      const greetingObjOrQ = greetingObjKind || greetingQKind;
      if (greetingObjOrQ) {
        // Treat exactly like the REBUTTAL-GATE path — just set phase and fall through.
        // We do this by setting awaitingUserAnswer = true temporarily so the rebuttal
        // gate fires on the NEXT committed event... but we need to handle it NOW.
        // Instead: build the rebuttal inline and send it.
        try {
          const overrideLine = enforceBookingOnlyLine(
            state.context!,
            getRebuttalLine(state.context!, greetingObjOrQ)
          );
          if (lastUserText) pushExchange(state, "user", lastUserText, 0);
          const rebuttalInstr = buildConversationalRebuttalInstruction(state.context!, overrideLine, {
            objectionKind: greetingObjOrQ,
            userText: lastUserText,
            lastOutboundLine: state.lastPromptLine,
            lastOutboundAtMs: state.lastPromptSentAtMs,
            recentExchanges: state.recentExchanges,
          });
          pushExchange(state, "ai", overrideLine, 0);

          state.awaitingUserAnswer = false;
          state.awaitingAnswerForStepIndex = undefined;
          state.userAudioMsBuffered = 0;
          state.lastUserTranscript = "";
          state.lowSignalCommitCount = 0;

          await humanPause();

          setWaitingForResponse(state, true, "response.create (greeting objection)");
          setAiSpeaking(state, true, "response.create (greeting objection)");
          setResponseInFlight(state, true, "response.create (greeting objection)");
          state.outboundOpenAiDone = false;

          state.lastPromptSentAtMs = Date.now();
          state.lastPromptLine = overrideLine;
          state.lastResponseCreateAtMs = Date.now();
          state.lastObjectionKind = greetingObjOrQ;
          state.objectionRepeatCount = 0;

          state.openAiWs.send(JSON.stringify({
            type: "response.create",
            response: { modalities: ["audio", "text"], temperature: 0.6, instructions: rebuttalInstr },
          }));

          // Re-arm stepper so next reply answers Step 1
          state.awaitingUserAnswer = true;
          state.awaitingAnswerForStepIndex = 0;
          state.phase = "in_call";
          return;
        } catch (e) {
          try { console.log("[AI-VOICE] greeting objection handler error:", String(e)); } catch {}
          // fall through to normal greeting reply if something goes wrong
        }
      }

      const ack = getGreetingAckPrefix(lastUserText);'''

content = replace_once(content, FIX1_OLD, FIX1_NEW, "1 (isGreetingReply — objection check before Step 1)")

# ─────────────────────────────────────────────────────────────
# FIX 2 — Free-response turns: skip humanPause()
# The artificial 120-220ms pause adds up with GPT generation latency.
# For free-response (conversational) turns, respond immediately.
# Script step turns keep the pause to sound natural.
# ─────────────────────────────────────────────────────────────
FIX2_OLD = '''      (async () => {
        try {
          await humanPause();
        } catch {}

        try {
          let instr: string;
          let lineForMemory: string;

          if (useFreeResponse) {'''

FIX2_NEW = '''      (async () => {
        try {
          // Free-response turns skip the artificial pause — respond immediately.
          // Script reprompt turns keep it to sound natural.
          if (!useFreeResponse) await humanPause();
        } catch {}

        try {
          let instr: string;
          let lineForMemory: string;

          if (useFreeResponse) {'''

content = replace_once(content, FIX2_OLD, FIX2_NEW, "2 (free-response — skip humanPause for faster reply)")

# ─────────────────────────────────────────────────────────────
# WRITE
# ─────────────────────────────────────────────────────────────
backup = path + ".bak4"
shutil.copy2(path, backup)
print(f"\nBackup saved to {backup}")

save(path, content)
print(f"Patched file written to {path}")
print(f"  {len(content):,} chars, {content.count(chr(10)):,} lines")
print("\nAll fixes applied.")
print("Run: cd ~/Projects/covecrm && npx tsc --noEmit -p ai-voice-server/tsconfig.json")
print("If clean: git add ai-voice-server/index.ts && git commit -m 'fix: greeting objection handling + faster free-response' && git push")
