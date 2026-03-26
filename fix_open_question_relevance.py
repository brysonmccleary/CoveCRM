#!/usr/bin/env python3
"""
fix_open_question_relevance.py
Adds a relevance gate for open_question steps: if the user's answer doesn't
address the question (e.g. "Yeah, what's up?" to "Was this for yourself or a spouse?"),
route to free-response GPT re-ask instead of blindly advancing the stepper.
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
        print(f"  ❌ {label}: target not found")
        print(f"     First 80 chars: {repr(old[:80])}")
        sys.exit(1)
    if count > 1:
        print(f"  ⚠️  {label}: {count} matches — using first")
    result = content.replace(old, new, 1)
    print(f"  ✅ {label}: applied")
    return result

path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
    "~/Projects/covecrm/ai-voice-server/index.ts"
)
print(f"Loading {path} ...")
content = load(path)
print(f"  {len(content):,} chars, {content.count(chr(10)):,} lines")

# ─────────────────────────────────────────────────────────────────────────────
# FIX: open_question relevance gate
#
# Insert BEFORE the prevIdx ack block. If stepType is open_question and the
# user's reply is clearly off-topic (doesn't answer the question at all),
# fire free-response instead of advancing.
#
# "Yeah, what's up?" = off-topic for "Was this for yourself or a spouse?"
# "Both of us" = on-topic → advance
# "Just me" = on-topic → advance
# "What do you mean?" = off-topic → free-response
# ─────────────────────────────────────────────────────────────────────────────

OLD = '''    const prevIdx = expectedAnswerIdx;


    if (


      prevIdx >= 0 &&


      state.lastAcceptedUserText &&


      state.lastAcceptedStepIndex === prevIdx


    ) {'''

NEW = '''    // ✅ open_question relevance gate: if the user's reply doesn't address
    // the current question at all, fire free-response (GPT re-asks naturally)
    // instead of advancing the stepper blindly.
    // Examples that should NOT advance:
    //   "Yeah, what's up?" to "Was this for yourself or a spouse?"
    //   "What do you mean?" to any open_question
    //   "Okay" / "Sure" — filler, not a real answer
    // Examples that SHOULD advance:
    //   "Just me", "Both of us", "Me and my wife", "Myself"
    if (stepType === "open_question" && hasTranscript && lastUserText) {
      const openQText = lastUserText.trim().toLowerCase();
      // Signals that indicate the user is NOT answering but reacting
      const isOffTopic =
        // question-back / confusion
        /\bwhat(\'s| is)? (this|that|up|going on)\b/.test(openQText) ||
        /\bwhat do you (mean|want|need)\b/.test(openQText) ||
        /\bwhy (are you|is this)\b/.test(openQText) ||
        /\bwho (is this|are you|am i)\b/.test(openQText) ||
        /\bhow did you\b/.test(openQText) ||
        // pure filler / acknowledgement with no info
        (isFillerOnly(openQText) && openQText.length < 15) ||
        // "yeah what's up" / "yep what's up" — answering + questioning back
        /^(yeah|yep|yes|yup|sure|okay|ok|hi|hello)[,.]?\s*(what'?s? up|what do you (want|need)|what is (this|it)|huh)\??$/.test(openQText);

      if (isOffTopic) {
        // Don't advance — fire free-response so GPT re-asks conversationally
        const repromptLine = getRepromptLineForStepType(state.context!, stepType, 0);
        if (lastUserText) pushExchange(state, "user", lastUserText, expectedAnswerIdx);

        const freeInstr = buildFreeResponseInstruction(state.context!, {
          userText: lastUserText,
          repromptLine,
          stepType,
          lastOutboundLine: state.lastPromptLine,
          lastOutboundAtMs: state.lastPromptSentAtMs,
          recentExchanges: state.recentExchanges,
        });

        (async () => {
          try {
            setWaitingForResponse(state, true, "response.create (open_question off-topic)");
            setAiSpeaking(state, true, "response.create (open_question off-topic)");
            setResponseInFlight(state, true, "response.create (open_question off-topic)");
            state.outboundOpenAiDone = false;

            state.lastPromptSentAtMs = Date.now();
            state.lastPromptLine = repromptLine;
            state.lastResponseCreateAtMs = Date.now();

            state.openAiWs!.send(JSON.stringify({
              type: "response.create",
              response: { modalities: ["audio", "text"], temperature: 0.75, instructions: freeInstr },
            }));
          } catch (e) {
            try { console.log("[AI-VOICE] open_question off-topic free-response error:", String(e)); } catch {}
          }
        })();
        return;
      }
    }

    const prevIdx = expectedAnswerIdx;


    if (


      prevIdx >= 0 &&


      state.lastAcceptedUserText &&


      state.lastAcceptedStepIndex === prevIdx


    ) {'''

content = replace_once(content, OLD, NEW, "open_question relevance gate before stepper advance")

backup = path + ".bak5"
shutil.copy2(path, backup)
print(f"\nBackup saved to {backup}")
save(path, content)
print(f"Patched file written to {path}")
print(f"  {len(content):,} chars, {content.count(chr(10)):,} lines")
print("\nDone.")
print("Run: cd ~/Projects/covecrm && npx tsc --noEmit -p ai-voice-server/tsconfig.json")
print("If clean: git add ai-voice-server/index.ts && git commit -m 'fix: open_question relevance gate — off-topic replies re-ask via GPT' && git push")
