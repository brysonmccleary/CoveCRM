// /lib/ai/handleAIResponse.ts
import { sendSMS } from "../twilio/sendSMS";
import Lead from "@/models/Lead";
import User from "@/models/User";
import { OpenAI } from "openai";
import delay from "../utils/delay";
import mongoose from "mongoose";
import { trackUsage } from "@/lib/billing/trackUsage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_AI_MESSAGES_BEFORE_LINK = 2;
const OPT_OUT_WORDS = ["stop", "unsubscribe", "no thanks", "not interested"];
const BASE_URL = "https://covecrm.com";

// Local interaction types (noImplicitAny-safe)
type InteractionType = "inbound" | "outbound" | "ai";
interface IInteraction {
  type: InteractionType;
  text: string;
  date?: Date;
  sid?: string;
  status?: string;
}

type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

function hasBookingLanguage(s: string) {
  return /\b(mon|tue|wed|thu|fri|sat|sun|today|tomorrow|tmrw|morning|afternoon|evening|\d{1,2}(:\d{2})?\s?(am|pm))\b/i.test(
    s || ""
  );
}

export async function handleAIResponse(leadId: string, incomingMessage: string): Promise<void> {
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

  const aiName = user?.aiAssistantName || "Taylor";

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

  // ✅ Count prior AI replies WITHOUT using .filter callback params
  let pastAIReplies = 0;
  for (const msg of interactionHistory) {
    if (msg.type === "ai") pastAIReplies++;
  }

  const bookingUrl = `${BASE_URL}/book/${encodeURIComponent(lead.userEmail)}`;
  const linkAlreadySent = interactionHistory.some(
    (i: IInteraction) => i.type === "ai" && typeof i.text === "string" && i.text.includes(bookingUrl)
  );

  // Build conversation memory (last 10 turns, lead↔AI only)
  const recent: IInteraction[] = [];
  for (const h of interactionHistory) {
    if (h.type === "inbound" || h.type === "ai") recent.push(h);
  }
  const recentLast10 = recent.slice(-10);

  // Base domain-specific framing
  const domainPromptMap: Record<string, string> = {
    "Final Expense": `
You are ${aiName}, an appointment-setting assistant for Final Expense life insurance.
You are not a licensed agent—do not give quotes or policy details. Your job is to schedule a quick call with a licensed agent.
    `.trim(),
    Veteran: `
You are ${aiName}, an appointment-setting assistant for life insurance options available to military/veterans.
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
Acknowledge their message in your own words (no copy/paste).
Ask exactly ONE concrete question that moves toward scheduling.
Never repeat the same sentence or offer twice in a row. Vary your phrasing.
Keep it to 1–2 short sentences max.
Don't discuss policy details, quotes, or eligibility—book a call instead.
Only include the booking link if we've already sent at least ${MAX_AI_MESSAGES_BEFORE_LINK} assistant messages in this thread AND the lead still hasn't given a time. Put the link on its own short line.
Booking link (if needed): ${bookingUrl}
  `.trim();

  const systemMessage = `${domainPromptMap[leadType] || domainPromptMap["Final Expense"]}\n\n${styleRules}`;

  // Build chat history for the model (no implicit-any anywhere)
  const messages: ChatMsg[] = [{ role: "system", content: systemMessage }];
  for (const h of recentLast10) {
    messages.push(
      h.type === "inbound"
        ? { role: "user", content: h.text }
        : { role: "assistant", content: h.text }
    );
  }
  messages.push({ role: "user", content: incomingMessage });

  // If the lead mentions a time/day, nudge the model to confirm logistics
  if (hasBookingLanguage(incomingMessage)) {
    messages.push({
      role: "system",
      content:
        "The user mentioned a day/time. Confirm clearly, and ask one focused follow-up if needed (e.g., 'Does 3:30 pm your time work?'). Keep under 2 sentences.",
    });
  }

  let aiReply =
    "Hey! Just checking in. Do you have 5 minutes later today or tomorrow to chat real quick with your agent?";

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      temperature: 0.6,
      presence_penalty: 0.6,
      frequency_penalty: 0.8,
    });

    const raw = (completion.choices?.[0]?.message?.content || "").toString().trim();
    if (raw.length > 2) aiReply = raw;

    // ✅ Charge for OpenAI usage ($0.01 per AI response)
    await trackUsage({
      user,
      amount: 0.01,
      source: "openai",
    });
  } catch (err) {
    console.error("OpenAI error:", err);
  }

  // Append booking link only if we haven't sent it and we've tried a couple times already
  if (!linkAlreadySent && pastAIReplies >= MAX_AI_MESSAGES_BEFORE_LINK) {
    aiReply += `\n\nSchedule here: ${bookingUrl}`;
  }

  // ✅ pass user as 3rd arg to satisfy sendSMS(to, body, userIdOrUser)
  await sendSMS(lead.Phone, aiReply, user); // Includes balance freeze logic

  // Persist convo
  interactionHistory.push({
    type: "ai",
    text: aiReply,
    date: new Date(),
  });

  lead.interactionHistory = interactionHistory;
  lead.isAIEngaged = true;
  lead.aiLastResponseAt = new Date();

  await lead.save();
}
