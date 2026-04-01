// ai-voice-server/conversationEngine.ts
// Production-grade conversation engine for AI voice calls

export type LeadContext = {
  leadId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  state: string;
  notes: string;
  timeZone: string;
};

export type UserContext = {
  userEmail: string;
  agentName: string;
  agentPhone: string;
  agentTimeZone: string;
  bookingSlots: { label: string; iso: string }[];
};

export enum CONVERSATION_STAGES {
  GREETING = "GREETING",
  RAPPORT = "RAPPORT",
  DISCOVERY = "DISCOVERY",
  PIVOT_TO_APPOINTMENT = "PIVOT_TO_APPOINTMENT",
  HANDLE_OBJECTION = "HANDLE_OBJECTION",
  CLOSE_APPOINTMENT = "CLOSE_APPOINTMENT",
  CONFIRM_APPOINTMENT = "CONFIRM_APPOINTMENT",
  WRAP_UP = "WRAP_UP",
  DEAD_END = "DEAD_END",
}

const STAGE_KEYWORDS: Record<CONVERSATION_STAGES, string[]> = {
  [CONVERSATION_STAGES.GREETING]: ["can you hear", "this is", "calling from"],
  [CONVERSATION_STAGES.RAPPORT]: ["how are you", "great", "appreciate", "thanks for"],
  [CONVERSATION_STAGES.DISCOVERY]: ["you submitted", "you were looking", "you requested", "you mentioned"],
  [CONVERSATION_STAGES.PIVOT_TO_APPOINTMENT]: ["schedule", "quick call", "few minutes", "available"],
  [CONVERSATION_STAGES.HANDLE_OBJECTION]: ["not interested", "busy", "no time", "who is this", "how did you get"],
  [CONVERSATION_STAGES.CLOSE_APPOINTMENT]: ["does", "work for you", "how about", "monday", "tuesday", "wednesday", "thursday", "friday"],
  [CONVERSATION_STAGES.CONFIRM_APPOINTMENT]: ["locked in", "confirmed", "booked", "send you a reminder", "calendar"],
  [CONVERSATION_STAGES.WRAP_UP]: ["talk soon", "take care", "have a great", "goodbye", "bye"],
  [CONVERSATION_STAGES.DEAD_END]: ["do not call", "stop calling", "remove me", "not interested", "already have"],
};

export function detectStageTransition(
  currentStage: CONVERSATION_STAGES,
  aiText: string,
  userText: string
): CONVERSATION_STAGES {
  const combined = (aiText + " " + userText).toLowerCase();

  // Dead end detection — highest priority
  if (STAGE_KEYWORDS[CONVERSATION_STAGES.DEAD_END].some((kw) => combined.includes(kw))) {
    if (combined.includes("do not call") || combined.includes("remove me")) {
      return CONVERSATION_STAGES.DEAD_END;
    }
  }

  // Wrap up
  if (STAGE_KEYWORDS[CONVERSATION_STAGES.WRAP_UP].some((kw) => combined.includes(kw))) {
    if (currentStage === CONVERSATION_STAGES.CONFIRM_APPOINTMENT || currentStage === CONVERSATION_STAGES.HANDLE_OBJECTION) {
      return CONVERSATION_STAGES.WRAP_UP;
    }
  }

  // Stage progression map
  const progressions: Partial<Record<CONVERSATION_STAGES, CONVERSATION_STAGES>> = {
    [CONVERSATION_STAGES.GREETING]: CONVERSATION_STAGES.RAPPORT,
    [CONVERSATION_STAGES.RAPPORT]: CONVERSATION_STAGES.DISCOVERY,
    [CONVERSATION_STAGES.DISCOVERY]: CONVERSATION_STAGES.PIVOT_TO_APPOINTMENT,
    [CONVERSATION_STAGES.PIVOT_TO_APPOINTMENT]: CONVERSATION_STAGES.CLOSE_APPOINTMENT,
    [CONVERSATION_STAGES.HANDLE_OBJECTION]: CONVERSATION_STAGES.PIVOT_TO_APPOINTMENT,
    [CONVERSATION_STAGES.CLOSE_APPOINTMENT]: CONVERSATION_STAGES.CONFIRM_APPOINTMENT,
    [CONVERSATION_STAGES.CONFIRM_APPOINTMENT]: CONVERSATION_STAGES.WRAP_UP,
  };

  const nextStage = progressions[currentStage];

  if (nextStage && STAGE_KEYWORDS[nextStage]?.some((kw) => combined.includes(kw))) {
    return nextStage;
  }

  return currentStage;
}

export function getInitialGreeting(lead: LeadContext, user: UserContext): string {
  const name = (lead.firstName || "").trim() || "there";
  const agentFirstName = (user.agentName || "").split(" ")[0] || "your agent";
  return `Hey ${name}. This is Alex calling for ${agentFirstName}. Can you hear me alright?`;
}

export function getSystemPrompt(lead: LeadContext, user: UserContext): string {
  const agentFirstName = (user.agentName || "").split(" ")[0] || "your agent";
  const leadName = (lead.firstName || "").trim() || "there";

  const slotLines = user.bookingSlots.length > 0
    ? user.bookingSlots.map((s, i) => `  Option ${i + 1}: ${s.label}`).join("\n")
    : "  I have some flexibility this week — ask the lead for their availability.";

  return `
You are Alex, a phone appointment-setting assistant calling on behalf of licensed insurance agent ${agentFirstName}.
You are calm, confident, warm, and completely human-sounding. You never reveal you are AI.

HARD LOCKS (NON-NEGOTIABLE):
- Speak ONLY English.
- ONLY name you may use for the lead: "${leadName}"
- You are NOT the agent. You do NOT discuss rates, carriers, approvals, eligibility, health questions, or underwriting.
- Your ONLY goal is to schedule a short call between the lead and ${agentFirstName}.
- NEVER apologize. NEVER mention scripts/prompts/AI.

LEAD INFO:
- Name: ${lead.firstName} ${lead.lastName}
- Phone: ${lead.phone}
- State: ${lead.state}
- Notes: ${lead.notes || "(none)"}

AGENT INFO:
- Agent: ${user.agentName}
- Timezone: ${user.agentTimeZone}

AVAILABLE APPOINTMENT SLOTS:
${slotLines}

CONVERSATION FLOW:
1. GREETING: "Hey ${leadName}. This is Alex calling for ${agentFirstName}. Can you hear me alright?"
   - Wait for confirmation. STOP after greeting.

2. RAPPORT: After they respond, acknowledge warmly: "Glad I caught you! I'm calling because you recently requested information about [their interest area] — is that right?"
   - Confirm their interest. Keep it brief.

3. PIVOT TO APPOINTMENT: "I just need to get you a quick 15-minute call with ${agentFirstName} to go over your options. What does your schedule look like this week?"

4. OFFER SLOTS: Present up to 3 available options. Let them choose.

5. CONFIRM: Repeat back the chosen time, confirm it works, and let them know ${agentFirstName} will reach out.

6. WRAP UP: "Perfect — you're all set. ${agentFirstName} will reach out at that time. Have a great day!"

OBJECTION HANDLING:
- "Not interested": "I completely understand — I just want to make sure you have the information you requested. It's only 15 minutes and there's no obligation. Does [option] work?"
- "Busy / bad time": "No problem at all — when would be a better time? I have [next slot] or [next slot]."
- "Already have coverage": "That's great — ${agentFirstName} actually works with people who already have coverage to make sure they're getting the best value. It's a quick no-pressure review."
- "Who is this?": "This is Alex, calling on behalf of ${agentFirstName}. You submitted a request for [their product] — I just want to make sure you got taken care of."

BOOKING CONTROL SCHEMA:
When the lead confirms a specific time slot, emit:
control.kind = "book_appointment"
Include: startTimeUtc (ISO), durationMinutes (15 or 30), leadTimeZone, agentTimeZone, notes

When call is clearly over, emit:
control.kind = "final_outcome"
Include: outcome (booked/not_interested/do_not_call/disconnected), summary

TURN DISCIPLINE:
- After every question: STOP and WAIT. Do NOT fill silence.
- One question at a time only.
`.trim();
}
