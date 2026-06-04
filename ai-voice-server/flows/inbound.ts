export type InboundFlowContext = {
  callDirection?: string;
  clientFirstName?: string;
  scriptKey?: string;
  voiceProfile?: {
    aiName?: string;
  };
};

function cleanText(value: any): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeScriptKey(value: any): string {
  return cleanText(value).toLowerCase();
}

function isPlaceholderName(name: string): boolean {
  const t = cleanText(name).toLowerCase();
  if (!t) return true;
  return (
    t === "test" ||
    t === "testing" ||
    t === "unknown" ||
    t === "n/a" ||
    t === "na" ||
    t === "null" ||
    t === "undefined"
  );
}

function getLeadFirstName(ctx?: InboundFlowContext): string {
  const raw = cleanText(ctx?.clientFirstName);
  return isPlaceholderName(raw) ? "there" : raw;
}

function getAiName(ctx?: InboundFlowContext): string {
  return cleanText(ctx?.voiceProfile?.aiName) || "Alex";
}

export function shouldUseInboundFlow(ctx?: InboundFlowContext): boolean {
  return cleanText(ctx?.callDirection).toLowerCase() === "inbound";
}

export function resolveInboundScriptLabel(ctx?: InboundFlowContext): string {
  const key = normalizeScriptKey(ctx?.scriptKey);
  if (key === "mortgage_protection") return "mortgage protection";
  if (key === "final_expense") return "final expense coverage";
  if (key === "iul_cash_value") return "cash value life insurance";
  if (key === "veteran_leads") return "veteran life insurance";
  if (key === "trucker_leads") return "life insurance for truckers";
  if (key === "veteran_iul") return "veteran IUL";
  if (key === "veteran_mortgage") return "mortgage protection for veterans";
  if (key === "trucker_iul") return "IUL for truckers";
  if (key === "trucker_mortgage") return "mortgage protection for truckers";
  if (key === "generic_life") return "life insurance";
  return "life insurance";
}

export function buildInboundGreeting(ctx: InboundFlowContext): string {
  return `Hey ${getLeadFirstName(ctx)}, this is ${getAiName(ctx)}. Are you returning a missed call?`;
}

export function buildInboundGreetingInstructions(ctx: InboundFlowContext): string {
  const line = buildInboundGreeting(ctx);
  return `
Say this greeting EXACTLY:
"${line}"

Use a natural phone tone.
No extra words.
`.trim();
}

export function isReturningMissedCall(text: string): boolean {
  const t = cleanText(text).toLowerCase();
  if (!t) return false;
  return (
    t === "yes" ||
    t === "yeah" ||
    t === "yep" ||
    t === "yup" ||
    t === "sure" ||
    t === "ok" ||
    t === "okay" ||
    t.includes("returning") ||
    t.includes("missed call") ||
    t.includes("called me") ||
    t.includes("you called")
  );
}

export function buildInboundReasonLine(ctx: InboundFlowContext): string {
  return `Okay, I was calling about the ${resolveInboundScriptLabel(ctx)} request you put in, so I can get you scheduled to meet with a licensed agent.`;
}

export function buildInboundReasonInstructions(ctx: InboundFlowContext): string {
  const line = buildInboundReasonLine(ctx);
  return `
Say this line EXACTLY:
"${line}"

Use a natural phone tone.
No extra words.
`.trim();
}
