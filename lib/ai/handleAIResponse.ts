import { sendSMS } from "../twilio/sendSMS";
import Lead from "@/models/Lead";
import User from "@/models/User";
import Message from "@/models/Message"; // ✅ new
import { OpenAI } from "openai";
import delay from "../utils/delay";
import mongoose from "mongoose";
import { trackUsage } from "@/lib/billing/trackUsage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_AI_MESSAGES_BEFORE_LINK = 2;
const OPT_OUT_WORDS = ["stop", "unsubscribe", "no thanks", "not interested"];
const BASE_URL = "https://covecrm.com";

// Local interaction types
type InteractionType = "inbound" | "outbound" | "ai";
interface IInteraction {
  type: InteractionType;
  text: string;
  date?: Date;
  sid?: string;
  status?: string;
}

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

// --- helpers ----------------------------------------------------

function hasBookingLanguage(s: string) {
  return /\b(mon|tue|wed|thu|fri|sat|sun|today|tomorrow|tmrw|morning|afternoon|evening|\d{1,2}(:\d{2})?\s?(am|pm))\b/i
    .test(s || "");
}

// “Can you email/text/mail the info?” detector
function asksForInfoOnly(s: string) {
  const t = (s || "").toLowerCase();
  return (
    /\b(send|email|e-mail|text|txt|mail|message|pdf|brochure|doc|document|info|information)\b/.test(t) &&
    /\b(send|email|text|mail|just|can you|could you|do you have|is there)\b/.test(t) &&
    !hasBookingLanguage(t)
  );
}

// Anti-repeat: if we’d duplicate the last AI line, nudge wording
function rephraseIfDuplicate(draft: string, lastAI?: string) {
  if (!draft || !lastAI) return draft;
  const a = draft.replace(/\s+/g, " ").trim().toLowerCase();
  const b = lastAI.replace(/\s+/g, " ").trim().toLowerCase();
  if (a === b) {
    // small, natural variation
    return "Got it. What time works for a quick 5-minute call today or tomorrow?";
  }
  return draft;
}

// ---------------------------------------------------------------

export async function handleAIResponse(
  leadId: string,
  incomingMessage: string,
): Promise<void> {
  if (!mongoose.connection.readyState) {
    await mongoose.connect(process.env.MONGODB_URI!);
  }

  const lead: any = await Lead.findById(leadId);
  if (!lead) return;

  const user: any = await User.findOne({ email: lead.userEmail });
  if (!user) return;

  // ⛔ Freeze if usage balance too low
  if ((user.usageBalance || 0) < -20) {
    console.warn(`⛔ AI frozen due to low balance for ${user.email}`);
    return;
  }

  const aiName = user?.aiAssistantName || "Assistant";

  const normalizedMsg = (incomingMessage || "").toLowerCase();
  const interactionHistory: IInteraction[] = (lead.interactionHistory || []) as IInteraction[];
  const leadType: string = lead.leadType || "Final Expense";

  if (OPT_OUT_WORDS.some((word) => normalizedMsg.includes(word))) {
    console.log(`Lead ${leadId} opted out. No reply sent.`);
    return;
  }

  // Natural delay 2–3 minutes
  const delayMs = Math.floor(Math.random() * (180000 - 120000 + 1)) + 120000;
  await delay(delayMs);

  // ✅ Count prior AI replies
  let pastAIReplies = 0;
  for (const msg of interactionHistory) if (msg.type === "ai") pastAIReplies++;

  const bookingUrl = `${BASE_URL}/book/${encodeURIComponent(lead.userEmail)}`;
  const linkAlreadySent = interactionHistory.some(
    (i: IInteraction) => i.type === "ai" && typeof i.text === "string" && i.text.includes(bookingUrl),
  );

  // Build conversation memory (last 10 turns, lead↔AI only)
  const recent: IInteraction[] = [];
  for (const h of interactionHistory) if (h.type === "inbound" || h.type === "ai") recent.push(h);
  const recentLast10 = recent.slice(-10);

  // Last few AI lines to ban repetition
  const lastAiLines = recent
    .filter((m) => m.type === "ai")
    .map((m) => (m.text || "").trim())
    .filter(Boolean)
    .slice(-5);

  // Base domain-specific framing
  const domainPromptMap: Record<string, string> = {
    "Final Expense": `
You are ${aiName}, an appointment-setting assistant for Final Expense life insurance.
You are not a licensed agent—do not give quotes or policy details. Your job is to schedule a quick call with a licensed agent.
    `.trim(),
    Veteran: `
You are ${aiName}, an appointment-setting assistant for life insurance options for military/veterans.
You are not a licensed agent—avoid policy specifics. Your goal is to book a quick call with a licensed agent.
    `.trim(),
    "Mortgage Protection": `
You are ${aiName}, an appointment-setting assistant for Mortgage Protection life insurance.
Do not discuss quotes. Your goal is to schedule a brief call with a licensed agent.
    `.trim(),
    IUL: `
You are ${aiName}, an appointment-setting assistant for Indexed Universal Life (IUL).
You are not a financial advisor. Avoid giving advice; focus on booking a quick call with a licensed agent.
    `.trim(),
  };

  // Style & anti-repetition guardrails
  const styleRules = `
Write like a real human: warm, concise, and specific to what the lead just said.
1–2 short sentences max. No links/emojis/signatures.
Acknowledge briefly, then move the convo toward setting a time.
Ask exactly ONE concrete question that advances scheduling.
Avoid repeating any of these prior assistant lines: ${lastAiLines.join(" | ") || "(none)"}.
If they ask for cost/duration, answer briefly then ask for a time.
If they give a time/day, confirm it clearly and keep momentum.
  `.trim();

  const systemMessage = `${domainPromptMap[leadType] || domainPromptMap["Final Expense"]}\n\n${styleRules}`;

  // Build chat history for the model
  const messages: ChatMsg[] = [{ role: "system", content: systemMessage }];
  for (const h of recentLast10) {
    messages.push(h.type === "inbound" ? { role: "user", content: h.text } : { role: "assistant", content: h.text });
  }
  messages.push({ role: "user", content: incomingMessage });

  // If the lead mentions a time/day, nudge the model to confirm logistics
  if (hasBookingLanguage(incomingMessage)) {
    messages.push({
      role: "system",
      content:
        "The user mentioned a day/time. Confirm clearly and ask one focused follow-up if needed (e.g., ‘Does 3:30 pm your time work?’). Keep it under 2 sentences.",
    });
  }

  // Hard rule for “just send me the info”
  if (asksForInfoOnly(incomingMessage)) {
    const aiReply =
      "Unfortunately as of now there’s nothing to send over without getting a few details from you first. When’s a good time for a quick 5-minute call and then we can send everything out?";
    await sendWithCorrectNumber(lead, user, aiReply);
    await persistAI(lead, aiReply);
    return;
  }

  // Default prompt & model call
  let aiReply =
    "Hey! Do you have 5 minutes later today or tomorrow for a quick call with the agent?";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.65,
      presence_penalty: 0.6,
      frequency_penalty: 0.8,
    });

    const raw = (completion.choices?.[0]?.message?.content || "").toString().trim();
    if (raw.length > 2) aiReply = raw;

    // ✅ Charge for OpenAI usage ($0.01 per AI response)
    await trackUsage({ user, amount: 0.01, source: "openai" });
  } catch (err) {
    console.error("OpenAI error:", err);
  }

  // Append booking link only if we haven't sent it and we've tried a couple times already
  if (!linkAlreadySent && pastAIReplies >= MAX_AI_MESSAGES_BEFORE_LINK) {
    aiReply += `\n\nSchedule here: ${bookingUrl}`;
  }

  // Avoid repeating the last assistant line verbatim
  const lastAI = [...recent].reverse().find((m) => m.type === "ai")?.text || "";
  aiReply = rephraseIfDuplicate(aiReply, lastAI);

  await sendWithCorrectNumber(lead, user, aiReply);
  await persistAI(lead, aiReply);
}

// --- send/persist helpers --------------------------------------

async function sendWithCorrectNumber(lead: any, user: any, body: string) {
  // Prefer the exact number this thread used most recently:
  // - if last message was inbound, reply FROM that inbound’s “To” (the user’s number they texted)
  // - else if last message was outbound, reply FROM that outbound “from”
  // - fallback to the user's first configured number
  let fromOverride: string | undefined;

  const lastMsg = await Message.findOne({ leadId: lead._id })
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  if (lastMsg?.direction === "inbound" && lastMsg.to) {
    fromOverride = lastMsg.to as string;
  } else if (lastMsg?.direction !== "inbound" && lastMsg?.from) {
    fromOverride = lastMsg.from as string;
  } else if (Array.isArray(user?.numbers) && user.numbers.length > 0) {
    fromOverride = user.numbers[0]?.phoneNumber;
  }

  // `sendSMS` updated to accept an optional { from } override
  await sendSMS(lead.Phone, body, user, { from: fromOverride });
}

async function persistAI(lead: any, aiReply: string) {
  const interactionHistory: IInteraction[] = (lead.interactionHistory || []) as IInteraction[];
  interactionHistory.push({ type: "ai", text: aiReply, date: new Date() });

  lead.interactionHistory = interactionHistory;
  lead.isAIEngaged = true;
  lead.aiLastResponseAt = new Date();

  await lead.save();
}
