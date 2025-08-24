// /lib/ai/handleAIResponse.ts
import { sendSms } from "../twilio/sendSMS"; // ⬅️ use object-form sender
import Lead from "@/models/Lead";
import User from "@/models/User";
import Message from "@/models/Message";
import { OpenAI } from "openai";
import delay from "../utils/delay";
import mongoose from "mongoose";
import { trackUsage } from "@/lib/billing/trackUsage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_AI_MESSAGES_BEFORE_LINK = 2;
const OPT_OUT_WORDS = ["stop", "unsubscribe", "no thanks", "not interested"];
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com").replace(/\/$/, "");

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

function hasBookingLanguage(s: string) {
  return /\b(mon|tue|wed|thu|fri|sat|sun|today|tomorrow|tmrw|morning|afternoon|evening|\d{1,2}(:\d{2})?\s?(am|pm))\b/i.test(
    s || "",
  );
}

function isSendInfoRequest(s: string) {
  const t = (s || "").toLowerCase();
  return (
    /\b(email|e-mail|mail|text|send|shoot|forward)\b.*\b(info|information|details|paperwork|brochure|quote|quotes)\b/.test(
      t,
    ) ||
    /\b(can you|could you|just)\b.*\b(email|mail|text)\b.*\b(it|me)\b/.test(t) ||
    t.includes("can you just email") ||
    t.includes("can you just text") ||
    t.includes("can you just mail")
  );
}

/**
 * Pull the user's owned numbers as clean E.164 strings.
 * Supports shapes like [{ phoneNumber: "+1555..." }, "+1555..."]
 */
function extractUserNumbers(user: any): string[] {
  const raw = Array.isArray(user?.numbers) ? user.numbers : [];
  const out: string[] = [];
  for (const n of raw) {
    if (!n) continue;
    if (typeof n === "string") out.push(n);
    else if (typeof n === "object" && typeof n.phoneNumber === "string")
      out.push(n.phoneNumber);
    else if (typeof n === "object" && typeof n.number === "string")
      out.push(n.number);
  }
  // de-dupe
  return Array.from(new Set(out));
}

/**
 * Choose a "from" number for this lead/thread:
 * 1) If the last message shows which Twilio number was used to talk to them, prefer that (sticky).
 * 2) Else, fall back to the user's first owned number (if any).
 * If none found, return null (we'll use the Messaging Service path).
 */
async function pickFromNumberForThread(leadId: string, user: any): Promise<string | null> {
  const userNums = extractUserNumbers(user);
  if (!userNums.length) return null;

  const last = await Message.findOne({ leadId }).sort({ createdAt: -1 }).lean();
  if (last) {
    // If last inbound, our Twilio number is in `to`; if outbound/ai, it's in `from`.
    const candidate =
      last.direction === "inbound" ? (last as any).to : (last as any).from;

    if (candidate && userNums.includes(candidate)) {
      return candidate;
    }
  }

  // Fallback to first user number
  return userNums[0] || null;
}

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
  const interactionHistory: IInteraction[] = (lead.interactionHistory ||
    []) as IInteraction[];
  const leadType: string = lead.leadType || "Final Expense";

  if (OPT_OUT_WORDS.some((word) => normalizedMsg.includes(word))) {
    console.log(`Lead ${leadId} opted out. No reply sent.`);
    return;
  }

  // Natural delay 2–3 minutes (kept)
  const delayMs = Math.floor(Math.random() * (180000 - 120000 + 1)) + 120000;
  await delay(delayMs);

  // Count prior AI replies
  let pastAIReplies = 0;
  for (const msg of interactionHistory) {
    if (msg.type === "ai") pastAIReplies++;
  }

  const bookingUrl = `${BASE_URL}/book/${encodeURIComponent(lead.userEmail)}`;
  const linkAlreadySent = interactionHistory.some(
    (i: IInteraction) =>
      i.type === "ai" &&
      typeof i.text === "string" &&
      i.text.includes(bookingUrl),
  );

  // Conversation memory (last 10 turns, lead↔AI only)
  const recent: IInteraction[] = [];
  for (const h of interactionHistory) {
    if (h.type === "inbound" || h.type === "ai") recent.push(h);
  }
  const recentLast10 = recent.slice(-10);

  // Build list of recent assistant lines to help de-dup after generation
  const recentAssistantLines = recentLast10
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

  // Style & anti-repetition guardrails (+ explicit "send info" handling)
  const styleRules = `
Write like a real human: warm, concise, and specific to what the lead just said.
Acknowledge their message in your own words (no copy/paste).
Ask exactly ONE concrete question that moves toward scheduling.
Never repeat the same sentence or offer twice in a row. Vary your phrasing.
Keep it to 1–2 short sentences max.
Don't discuss policy details, quotes, or eligibility—book a call instead.
If they ask to email/text/mail the information instead of a call, do NOT send a link or materials; say:
"Unfortunately as of now there's nothing to send over without getting some information from you, when's a good time for a quick 5 minute call and then we can send everything out"
Only include the booking link if we've already sent at least ${MAX_AI_MESSAGES_BEFORE_LINK} assistant messages in this thread AND the lead still hasn't given a time. Put the link on its own short line.
  `.trim();

  const systemMessage = `${domainPromptMap[leadType] || domainPromptMap["Final Expense"]}\n\n${styleRules}`;

  // Build chat history for the model
  const messages: ChatMsg[] = [{ role: "system", content: systemMessage }];
  for (const h of recentLast10) {
    messages.push(
      h.type === "inbound"
        ? { role: "user", content: h.text }
        : { role: "assistant", content: h.text },
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

  // Extra guard: if they explicitly asked to send info, short-circuit to the exact sentence
  if (isSendInfoRequest(incomingMessage)) {
    const aiReply =
      "Unfortunately as of now there's nothing to send over without getting some information from you, when's a good time for a quick 5 minute call and then we can send everything out";

    await persistAndSend({ lead, user, aiReply });
    return;
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

    const raw = (completion.choices?.[0]?.message?.content || "")
      .toString()
      .trim();
    if (raw.length > 2) aiReply = raw;

    // Post-filter to reduce repetition against our last few assistant lines
    if (recentAssistantLines.includes(aiReply.trim())) {
      aiReply = aiReply.replace(/^(Hey|Hi|Hello)[,!]?\s*/i, "Got it — ");
    }

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

  await persistAndSend({ lead, user, aiReply });
}

/** persist + send helper (object-form sender w/ thread-sticky "from") */
async function persistAndSend({
  lead,
  user,
  aiReply,
}: {
  lead: any;
  user: any;
  aiReply: string;
}) {
  // Choose the best "from" number for this thread (or null to use MSID)
  const fromOverride = await pickFromNumberForThread(String(lead._id), user);

  // Send (object-form; includes leadId for Message linkage)
  await sendSms({
    to: lead.Phone || (lead as any).phone,
    body: aiReply,
    userEmail: user.email,
    leadId: String(lead._id),
    from: fromOverride || undefined, // if undefined, MSID path is used
  });

  // Persist convo (interactionHistory mirrors UI)
  const interactionHistory: IInteraction[] = (lead.interactionHistory ||
    []) as IInteraction[];

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
