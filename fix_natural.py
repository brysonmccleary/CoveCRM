#!/usr/bin/env python3
"""
fix_natural.py — Comprehensive naturalness fix
Run: python3 fix_natural.py ~/Projects/covecrm/ai-voice-server/index.ts

FIXES:
1. open_question non-answers → free-response GPT path (not canned reprompt)
2. Greeting reply "yeah what's up?" → free-response, re-asks Step 1 naturally
3. shouldTreatCommitAsRealAnswer: open_question always advances on non-filler
   (remove the canAdvance/isFillerOnly gate — let free-response handle vague replies)
4. stepper-after-greeting: pass recentExchanges + userText so it sounds natural
5. getRepromptLineForStepType open_question ladder removed — replaced by free-response
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
# FIX 1 — shouldTreatCommitAsRealAnswer: open_question
# Currently: returns true on ANY non-filler text → "yeah what's up?" advances the stepper
# Fix: open_question ALWAYS returns true here — we let the free-response path
# handle cases where the answer didn't address the question. This way the stepper
# advances but GPT re-asks naturally if needed, rather than looping on a reprompt.
#
# The real guard is in the free-response branch: if the user's answer doesn't
# semantically match what was asked, GPT acknowledges and re-asks conversationally.
# ─────────────────────────────────────────────────────────────
FIX1_OLD = '''  // If we have transcription:
  if (text) {
    // Time questions: allow 1-word answers like "afternoon", "tomorrow", etc.
    if (stepType === "time_question") {
      return looksLikeTimeAnswer(text) || isTimeIndecisionOrAvailability(text);
    }

    // Non-time questions: be strict about filler.
    if (isFillerOnly(text)) return false;
    return true;
  }'''

FIX1_NEW = '''  // If we have transcription:
  if (text) {
    // Time questions: allow explicit time answers + affirmatives ("yeah" = today)
    if (stepType === "time_question") {
      return looksLikeTimeAnswer(text) || isTimeIndecisionOrAvailability(text);
    }

    // open_question / yesno_question: advance on any non-filler.
    // If the answer didn't actually address the question, the free-response branch
    // will handle it naturally — GPT re-asks conversationally rather than looping
    // on a canned reprompt line.
    if (isFillerOnly(text)) return false;
    return true;
  }'''

content = replace_once(content, FIX1_OLD, FIX1_NEW, "1 (shouldTreatCommitAsRealAnswer — comment update)")

# ─────────────────────────────────────────────────────────────
# FIX 2 — getRepromptLineForStepType open_question ladder
# Replace the canned open_question reprompt ladder with a flag that tells
# the reprompt path to use free-response instead.
# The free-response path already exists — we just need open_question to
# always route there instead of a canned line.
# ─────────────────────────────────────────────────────────────
FIX2_OLD = '''  if (stepType === "open_question") {
    // ✅ Patch: booking-only reprompts (no discovery)
    const ladder = [
      `Real quick — was this for just you, or a spouse as well?`,
      `Perfect — my job is just to set up a quick call with ${agent}. Would later today or tomorrow be better?`,
      `No worries — just to get you scheduled, is later today or tomorrow better?`,
    ];
    return ladder[Math.min(n, ladder.length - 1)];
  }'''

FIX2_NEW = '''  if (stepType === "open_question") {
    // open_question reprompts always use the free-response GPT path.
    // Return the booking fallback as a backstop — the useFreeResponse check
    // in the committed handler will override this with a GPT-generated response
    // that re-asks the question naturally based on context.
    return getBookingFallbackLine(ctx);
  }'''

content = replace_once(content, FIX2_OLD, FIX2_NEW, "2 (getRepromptLineForStepType open_question → free-response)")

# ─────────────────────────────────────────────────────────────
# FIX 3 — useFreeResponse: always fire for open_question non-answers
# The current useFreeResponse check has too many guards.
# For open_question with real transcript, ALWAYS use free-response.
# This is the core of the "handles anything" behavior.
# ─────────────────────────────────────────────────────────────
FIX3_OLD = '''      const useFreeResponse = (() => {
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
      })();'''

FIX3_NEW = '''      const useFreeResponse = (() => {
        try {
          if (!hasTranscript) return false;
          if (!lastUserText || lastUserText.trim().length < 4) return false;

          // Time/availability is handled by the time ladder — don't free-respond to that
          if (stepType === "time_question") return false;
          if (isTimeIndecisionOrAvailability(lastUserText)) return false;
          if (isTimeMentioned(lastUserText) && stepType === "time_question") return false;

          // open_question: ALWAYS use free-response for non-answers.
          // GPT will acknowledge what they said and re-ask the question naturally.
          // This is the "handles anything" path — no canned reprompts for open questions.
          if (stepType === "open_question") return true;

          // yesno_question: use free-response when they said something real but ambiguous
          if (stepType === "yesno_question" && repromptN >= 1) return true;

          // Generic fallback: use free-response when reprompt line is just the booking default
          const fallback = getBookingFallbackLine(state.context!).toLowerCase();
          if (repromptLine.toLowerCase().includes(fallback.slice(0, 40))) return true;

          return false;
        } catch { return false; }
      })();'''

content = replace_once(content, FIX3_OLD, FIX3_NEW, "3 (useFreeResponse — open_question always fires GPT)")

# ─────────────────────────────────────────────────────────────
# FIX 4 — buildFreeResponseInstruction: make the re-ask of the
# current step question more explicit in the prompt.
# Currently the step hint just says "work your way back to this."
# We need GPT to understand it should actually re-ask the question
# naturally, not just steer toward booking.
# ─────────────────────────────────────────────────────────────
FIX4_OLD = '''  const stepHint = currentStep
    ? `\nWHERE YOU ARE IN THE SCRIPT: You still need to ask: "${currentStep}"\nAfter handling what the lead said, work your way back to this.\n`
    : "";'''

FIX4_NEW = '''  const stepHint = currentStep
    ? `\nWHERE YOU ARE IN THE SCRIPT:\nYou still need to get an answer to this question: "${currentStep}"\n\nIMPORTANT: After responding to what they said, you MUST re-ask this question naturally.\nDon't skip it. Don't jump to booking. Re-ask it in your own words — conversationally, not robotically.\nExample: if the question is about spouse coverage, work it back in: "...anyway, was this just for you or did you want to cover your spouse too?"\n`
    : "";'''

content = replace_once(content, FIX4_OLD, FIX4_NEW, "4 (buildFreeResponseInstruction — explicit re-ask instruction)")

# ─────────────────────────────────────────────────────────────
# FIX 5 — stepper-after-greeting: pass userText + recentExchanges
# Currently uses old buildStepperTurnInstruction without opts.
# "Yeah what's up?" as greeting reply should produce a natural
# transition into Step 1 that acknowledges their energy.
# ─────────────────────────────────────────────────────────────
FIX5_OLD = 'str = buildStepperTurnInstruction(state.context!, lineToSay2);\n\n      state.awaitingUserAnswer = false;'

FIX5_NEW = '''str = buildStepperTurnInstruction(state.context!, lineToSay2, {
        userText: lastUserText,
        recentExchanges: state.recentExchanges,
      });

      // Push greeting exchange to memory
      if (lastUserText) pushExchange(state, "user", lastUserText, 0);
      pushExchange(state, "ai", lineToSay2, 0);

      state.awaitingUserAnswer = false;'''

content = replace_once(content, FIX5_OLD, FIX5_NEW, "5 (stepper-after-greeting — pass context to instruction)")

# ─────────────────────────────────────────────────────────────
# FIX 6 — buildFreeResponseInstruction: add explicit step-type hints
# When we know the step type, give GPT more specific guidance
# about what kind of answer we're looking for.
# Insert step-type context into the instruction.
# ─────────────────────────────────────────────────────────────
FIX6_OLD = '''function buildFreeResponseInstruction(
  ctx: AICallContext,
  opts: {
    userText: string;
    recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
    currentStepLine?: string;
  }
): string {'''

FIX6_NEW = '''function buildFreeResponseInstruction(
  ctx: AICallContext,
  opts: {
    userText: string;
    recentExchanges?: Array<{ role: "ai" | "user"; text: string; stepIndex?: number }>;
    currentStepLine?: string;
    stepType?: string;  // helps GPT know what kind of answer to steer toward
  }
): string {'''

content = replace_once(content, FIX6_OLD, FIX6_NEW, "6a (buildFreeResponseInstruction — add stepType param)")

FIX6B_OLD = '''  const stepHint = currentStep
    ? `\nWHERE YOU ARE IN THE SCRIPT:\nYou still need to get an answer to this question: "${currentStep}"\n\nIMPORTANT: After responding to what they said, you MUST re-ask this question naturally.\nDon't skip it. Don't jump to booking. Re-ask it in your own words — conversationally, not robotically.\nExample: if the question is about spouse coverage, work it back in: "...anyway, was this just for you or did you want to cover your spouse too?"\n`
    : "";'''

FIX6B_NEW = '''  const stepTypeHint = (() => {
    const st = String(opts.stepType || "").toLowerCase();
    if (st === "open_question") return `\nThis is an open question. You need a specific answer before moving forward. Do not skip it.`;
    if (st === "yesno_question") return `\nThis is a yes-or-no question. Steer toward a clear yes or no.`;
    if (st === "time_question") return `\nYou need a day or time. Offer today or tomorrow as the options.`;
    return "";
  })();

  const stepHint = currentStep
    ? `\nWHERE YOU ARE IN THE SCRIPT:\nYou still need to get an answer to this question: "${currentStep}"${stepTypeHint}\n\nIMPORTANT: After responding to what they said, you MUST re-ask this question naturally.\nDo not skip it. Do not jump ahead. Re-ask it in your own words, conversationally.\nExample: if the question is about spouse coverage, work it back in naturally.\n`
    : "";'''

content = replace_once(content, FIX6B_OLD, FIX6B_NEW, "6b (buildFreeResponseInstruction — step type hint)")

# ─────────────────────────────────────────────────────────────
# FIX 7 — Pass stepType to buildFreeResponseInstruction call site
# ─────────────────────────────────────────────────────────────
FIX7_OLD = '''          if (useFreeResponse) {
            instr = buildFreeResponseInstruction(state.context!, {
              userText: lastUserText,
              recentExchanges: state.recentExchanges,
              currentStepLine: steps[idx] || "",
            });'''

FIX7_NEW = '''          if (useFreeResponse) {
            instr = buildFreeResponseInstruction(state.context!, {
              userText: lastUserText,
              recentExchanges: state.recentExchanges,
              currentStepLine: steps[idx] || "",
              stepType: stepType,
            });'''

content = replace_once(content, FIX7_OLD, FIX7_NEW, "7 (pass stepType to buildFreeResponseInstruction)")

# ─────────────────────────────────────────────────────────────
# WRITE
# ─────────────────────────────────────────────────────────────
backup = path + ".bak3"
shutil.copy2(path, backup)
print(f"\nBackup saved to {backup}")

save(path, content)
print(f"Patched file written to {path}")
print(f"  {len(content):,} chars, {content.count(chr(10)):,} lines")
print("\nAll fixes applied.")
print("Run: cd ~/Projects/covecrm && npx tsc --noEmit -p ai-voice-server/tsconfig.json")
print("If clean: git add ai-voice-server/index.ts && git commit -m 'fix: natural open_question handling — GPT re-asks conversationally' && git push")
