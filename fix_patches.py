#!/usr/bin/env python3
"""
fix_patches.py  —  3 targeted fixes
Run:  python3 fix_patches.py ~/Projects/covecrm/ai-voice-server/index.ts

FIX 1: "Hello." / greeting filler words advancing the stepper
        isFillerOnly() doesn't catch "hello." "hi." "hey" etc.
        These must not count as real answers to the spouse question.

FIX 2: "Yeah." / affirmatives to a time_question should be treated as
        "today" (affirmative = pick the first/default option).
        looksLikeTimeAnswer needs to catch yes/yeah/sure/yep for time questions.

FIX 3: Greeting instruction — stop rambling, say the line cleanly and WAIT.
        The new buildStepperTurnInstruction adds too much scaffolding for the
        greeting turn. Greeting should be dead simple: just say the line, stop.
        Also guard against test/placeholder client names sounding robotic.
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
print(f"Loading {path} …")
content = load(path)
print(f"  {len(content):,} chars, {content.count(chr(10)):,} lines")

# ─────────────────────────────────────────────────────────────
# FIX 1 — isFillerOnly: add greeting words + single punctuation
# "hello." "hi." "hey" "hello?" etc. must not advance the stepper
# ─────────────────────────────────────────────────────────────
FIX1_OLD = '''function isFillerOnly(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return true;

  // common tiny acknowledgements / noise
  const fillers = new Set([
    "yeah",
    "yep",
    "yup",
    "uh",
    "uhh",
    "um",
    "umm",
    "mm",
    "mhm",
    "hmm",
    "uh huh",
    "uh-huh",
    "okay",
    "ok",
    "hello",
    "hey",
    "can you hear me",
    "yeah i can hear you",
    "i can hear you",
  ]);

  if (fillers.has(t)) return true;

  // Regex catch for stretched fillers: "uhhh", "ummm", "hmmmm", etc.
  if (/^(uh+|um+|mm+|mhm+|hmm+|er+|ah+|eh+)$/.test(t)) return true;

  // IMPORTANT:
  // Do NOT treat every 1-word reply as filler.
  // Words like "probably", "both", "tomorrow", "evening", "yes" can be meaningful depending on step type.
  return false;
}'''

FIX1_NEW = '''function isFillerOnly(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return true;

  // Strip trailing punctuation for matching ("hello." -> "hello")
  const stripped = t.replace(/[?.!,]+$/, "").trim();

  // common tiny acknowledgements / noise
  const fillers = new Set([
    "yeah",
    "yep",
    "yup",
    "uh",
    "uhh",
    "um",
    "umm",
    "mm",
    "mhm",
    "hmm",
    "uh huh",
    "uh-huh",
    "okay",
    "ok",
    // greeting words — these are NOT answers to script questions
    "hello",
    "hi",
    "hey",
    "hey there",
    "hi there",
    "good morning",
    "good afternoon",
    "good evening",
    "can you hear me",
    "yeah i can hear you",
    "i can hear you",
    "yes i can hear you",
    "yes i can",
    "loud and clear",
  ]);

  if (fillers.has(t) || fillers.has(stripped)) return true;

  // Regex catch for stretched fillers: "uhhh", "ummm", "hmmmm", etc.
  if (/^(uh+|um+|mm+|mhm+|hmm+|er+|ah+|eh+)$/.test(stripped)) return true;

  // greeting-only sentences (1–3 words, all greeting tokens)
  const greetingTokens = new Set(["hello","hi","hey","there","good","morning","afternoon","evening","howdy","yo"]);
  const words = stripped.split(/\s+/);
  if (words.length <= 3 && words.every(w => greetingTokens.has(w))) return true;

  // IMPORTANT:
  // Do NOT treat every 1-word reply as filler.
  // Words like "probably", "both", "tomorrow", "evening", "yes" can be meaningful depending on step type.
  return false;
}'''

content = replace_once(content, FIX1_OLD, FIX1_NEW, "1 (isFillerOnly — greeting words)")

# ─────────────────────────────────────────────────────────────
# FIX 2 — looksLikeTimeAnswer: affirmatives count as time answers
# "yeah", "yes", "sure", "sounds good" after "today or tomorrow"
# should be treated as picking today (move forward, don't reprompt)
# ─────────────────────────────────────────────────────────────
FIX2_OLD = '''function looksLikeTimeAnswer(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;

  // Accept "tomorrow", "afternoon", etc. as a time-answer to a time question (for stepper progression),
  // but do NOT confuse this with an exact time for booking.
  if (isDayReferenceMentioned(t)) return true;
  if (isTimeWindowMentioned(t)) return true;
  if (isExactClockTimeMentioned(t)) return true;

  return false;
}'''

FIX2_NEW = '''function looksLikeTimeAnswer(textRaw: string): boolean {
  const t = String(textRaw || "").trim().toLowerCase();
  if (!t) return false;

  // Accept "tomorrow", "afternoon", etc. as a time-answer to a time question (for stepper progression),
  // but do NOT confuse this with an exact time for booking.
  if (isDayReferenceMentioned(t)) return true;
  if (isTimeWindowMentioned(t)) return true;
  if (isExactClockTimeMentioned(t)) return true;

  // ✅ Affirmatives to "later today or tomorrow" = picking today / agreeing to schedule.
  // Treat as a valid time answer so we move forward instead of reprompting.
  const affirmatives = new Set([
    "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "alright",
    "sounds good", "that works", "works for me", "that's fine", "thats fine",
    "fine", "go ahead", "either", "either one", "both work", "whatever",
    "you pick", "your call", "doesn't matter", "doesnt matter",
  ]);
  const stripped = t.replace(/[?.!,]+$/, "").trim();
  if (affirmatives.has(stripped) || affirmatives.has(t)) return true;

  return false;
}'''

content = replace_once(content, FIX2_OLD, FIX2_NEW, "2 (looksLikeTimeAnswer — affirmatives)")

# ─────────────────────────────────────────────────────────────
# FIX 3 — Greeting response.create: use a dead-simple instruction
# The greeting turn should ONLY say the greeting line and stop.
# No history blocks, no goals, no scaffolding — just: say this, wait.
# Also: if clientFirstName looks like a test value, use "there" instead.
# ─────────────────────────────────────────────────────────────

# First add a helper to detect test/placeholder names
FIX3A_OLD = 'function getBookingFallbackLine(ctx: AICallContext): string {'

FIX3A_NEW = '''function isTestOrPlaceholderName(name: string): boolean {
  const t = String(name || "").trim().toLowerCase();
  if (!t) return true;
  const placeholders = new Set([
    "test", "testing", "tester", "demo", "sample", "lead", "user",
    "firstname", "first_name", "name", "unknown", "n/a", "na", "none",
    "undefined", "null", "placeholder",
  ]);
  return placeholders.has(t) || t.startsWith("test ") || t.endsWith(" test");
}

function getBookingFallbackLine(ctx: AICallContext): string {'''

content = replace_once(content, FIX3A_OLD, FIX3A_NEW, "3a (isTestOrPlaceholderName helper)")

# Now fix the greeting line construction — use "there" for test names
FIX3B_OLD = '''        const aiName = (liveState.context!.voiceProfile.aiName || "Alex").trim() || "Alex";
        const clientName = (liveState.context!.clientFirstName || "").trim() || "there";
        const greetingLine = `Hey ${clientName}. This is ${aiName}. Can you hear me alright?`;
        const greetingInstr = buildStepperTurnInstruction(liveState.context!, greetingLine);'''

FIX3B_NEW = '''        const aiName = (liveState.context!.voiceProfile.aiName || "Alex").trim() || "Alex";
        const clientNameRaw = (liveState.context!.clientFirstName || "").trim();
        const clientName = (!clientNameRaw || isTestOrPlaceholderName(clientNameRaw)) ? "there" : clientNameRaw;
        const greetingLine = `Hey ${clientName}. This is ${aiName}. Can you hear me alright?`;
        // Greeting instruction: dead simple — say the line, stop, wait. No history/goals scaffolding.
        const greetingInstr = buildGreetingInstructions(liveState.context!);'''

content = replace_once(content, FIX3B_OLD, FIX3B_NEW, "3b (greeting — test name guard + simple instruction)")

# Also fix buildGreetingInstructions to use the test name guard
FIX3C_OLD = '''function buildGreetingInstructions(ctx: AICallContext): string {
  const aiName = (ctx.voiceProfile.aiName || "Alex").trim() || "Alex";
  const clientName = (ctx.clientFirstName || "").trim() || "there";
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);

  return [
    'HARD ENGLISH LOCK: Speak ONLY English.',
    `HARD SCOPE LOCK: This call is ONLY about a ${scope} request. Do NOT mention any other product.`,
    'HARD NAME LOCK: You may ONLY use the lead name exactly as provided. If missing, say "there". Never invent names.',
    "",
    "SYSTEM GREETING (NON-NEGOTIABLE):",
    `- Your first words MUST start with: "Hey ${clientName}."`,
    "- Keep it SHORT: 1 sentence greeting + 1 simple question.",
    `- Say exactly: "Hey ${clientName}. This is ${aiName}. Can you hear me alright?"`,
    "- After the question, STOP talking and WAIT for the lead to respond.",
    "- Do NOT begin the booking script on this greeting turn.",
  ].join("\\n");
}'''

FIX3C_NEW = '''function buildGreetingInstructions(ctx: AICallContext): string {
  const aiName = (ctx.voiceProfile.aiName || "Alex").trim() || "Alex";
  const clientNameRaw = (ctx.clientFirstName || "").trim();
  const clientName = (!clientNameRaw || isTestOrPlaceholderName(clientNameRaw)) ? "there" : clientNameRaw;
  const scope = getScopeLabelForScriptKey(ctx.scriptKey);

  return `
You are ${aiName}, a scheduling assistant. You are making a phone call.

YOUR ONLY JOB RIGHT NOW:
Say this greeting EXACTLY, naturally, as a real person would:
"Hey ${clientName}. This is ${aiName}. Can you hear me alright?"

RULES:
- Say ONLY those words. Nothing more.
- After you say it, STOP COMPLETELY and wait for them to respond.
- Do NOT introduce yourself further. Do NOT mention the reason for the call yet.
- Do NOT start the booking script. That comes after they respond.
- English only.
`.trim();
}'''

content = replace_once(content, FIX3C_OLD, FIX3C_NEW, "3c (buildGreetingInstructions — tighter instruction)")

# ─────────────────────────────────────────────────────────────
# FIX 4 — After greeting reply, also guard against greeting-word
# answers ("hello", "hi") in the isGreetingReply path.
# If they say "hello" back, retry the hearing check instead of
# treating it as confirmation.
# ─────────────────────────────────────────────────────────────
FIX4_OLD = '''      if (isGreetingNegativeHearing(lastUserText)) {
        // If they couldn't hear, re-ask hearing check instead of advancing steps.
        const aiName2 = (state.context!.voiceProfile.aiName || "Alex").trim() || "Alex";
        const clientName2 = (state.context!.clientFirstName || "").trim() || "there";'''

FIX4_NEW = '''      // Also treat a bare greeting response ("hello", "hi") the same as negative hearing —
      // they didn't acknowledge us, just said hello back. Re-ask the hearing check.
      const isGreetingEcho = isFillerOnly(lastUserText) &&
        (["hello","hi","hey","hello?","hi?","hey?"].includes(
          String(lastUserText || "").trim().toLowerCase().replace(/[?.!]+$/, "")
        ));

      if (isGreetingNegativeHearing(lastUserText) || (isGreetingEcho && !lastUserText.toLowerCase().includes("hear"))) {
        // If they couldn't hear or just echoed hello back, re-ask hearing check instead of advancing steps.
        const aiName2 = (state.context!.voiceProfile.aiName || "Alex").trim() || "Alex";
        const clientNameRaw2 = (state.context!.clientFirstName || "").trim();
        const clientName2 = (!clientNameRaw2 || isTestOrPlaceholderName(clientNameRaw2)) ? "there" : clientNameRaw2;'''

content = replace_once(content, FIX4_OLD, FIX4_NEW, "4 (greeting echo — hello/hi treated as retry)")

# ─────────────────────────────────────────────────────────────
# WRITE
# ─────────────────────────────────────────────────────────────
backup = path + ".bak2"
shutil.copy2(path, backup)
print(f"\nBackup saved to {backup}")

save(path, content)
print(f"Patched file written to {path}")
print(f"  {len(content):,} chars, {content.count(chr(10)):,} lines")
print("\nAll fixes applied. Run: cd ~/Projects/covecrm && npx tsc --noEmit -p ai-voice-server/tsconfig.json")
