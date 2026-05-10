import OpenAI from "openai";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import CallLog from "@/models/CallLog";
import LeadMemoryFact from "@/models/LeadMemoryFact";
import LeadMemoryProfile from "@/models/LeadMemoryProfile";

function sanitizeMessagesForMemory(messages: any[]) {
  return messages.map((message) => ({
    direction: String(message?.direction || "unknown"),
    body: String(message?.text || "").trim().slice(0, 1000),
    timestamp: message?.createdAt || message?.sentAt || message?.receivedAt || null,
  })).filter((message) => message.body);
}

function buildLeadIdentity(lead: any) {
  return {
    firstName: String(lead?.["First Name"] || lead?.firstName || "").trim(),
    lastName: String(lead?.["Last Name"] || lead?.lastName || "").trim(),
    fullName: String(lead?.["Full Name"] || lead?.fullName || lead?.Name || lead?.name || "").trim(),
  };
}

function fallbackSummary(facts: any[], messages: any[], lastCall: any) {
  const factLines = facts.map((fact) => `${fact.key}: ${fact.value}`);
  const lastMessage = messages[0]?.body || "";
  return {
    shortSummary: factLines.slice(0, 3).join(" | ").slice(0, 240),
    longSummary: [factLines.join("\n"), lastMessage && `Last message: ${lastMessage}`, lastCall && `Last call status: ${lastCall.status}`]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 2000),
    nextBestAction: facts.some((fact) => fact.key === "callback_time")
      ? "Follow up at the requested callback time."
      : "Review the latest messages and follow up with a clear next step.",
  };
}

async function summarizeWithOpenAI(facts: any[], messages: any[], lastCall: any, leadIdentity: any) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "system",
        content:
          "Summarize lead context for an internal CRM. Return JSON with shortSummary, longSummary, nextBestAction, openLoops, objections. Use leadIdentity as the only source of lead name. Never infer the lead name from outbound messages, phone numbers, email addresses, owner/account metadata, or agent/persona names.",
      },
      {
        role: "user",
        content: JSON.stringify({ leadIdentity, facts, messages, lastCall }),
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "lead_memory_summary",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            shortSummary: { type: "string" },
            longSummary: { type: "string" },
            nextBestAction: { type: "string" },
            openLoops: { type: "array", items: { type: "string" } },
            objections: { type: "array", items: { type: "string" } },
          },
          required: ["shortSummary", "longSummary", "nextBestAction", "openLoops", "objections"],
        },
      },
    },
  });

  return JSON.parse(response.output_text || "{}");
}

export async function generateLeadMemorySummary(userEmail: string, leadId: string) {
  await mongooseConnect();

  const [lead, facts, rawMessages, lastCall] = await Promise.all([
    (Lead as any).findOne({ _id: leadId, userEmail }).select({
      "First Name": 1,
      "Last Name": 1,
      firstName: 1,
      lastName: 1,
      "Full Name": 1,
      fullName: 1,
      Name: 1,
      name: 1,
    }).lean(),
    LeadMemoryFact.find({ userEmail, leadId, status: "active" }).sort({ updatedAt: -1 }).lean(),
    Message.find({ userEmail, leadId }).sort({ createdAt: -1 }).limit(20).lean(),
    CallLog.find({ userEmail, leadId: String(leadId) }).sort({ timestamp: -1 }).limit(1).lean(),
  ]);

  const messages = sanitizeMessagesForMemory(rawMessages);
  const leadIdentity = buildLeadIdentity(lead);
  const aiSummary = await summarizeWithOpenAI(facts, messages, lastCall[0], leadIdentity).catch(() => null);
  const fallback = fallbackSummary(facts, messages, lastCall[0]);
  const summary = aiSummary || {
    ...fallback,
    openLoops: [],
    objections: facts.filter((fact) => fact.key === "objection").map((fact) => fact.value),
  };

  const profile = await LeadMemoryProfile.findOneAndUpdate(
    { userEmail, leadId },
    {
      $set: {
        shortSummary: summary.shortSummary || fallback.shortSummary,
        longSummary: summary.longSummary || fallback.longSummary,
        nextBestAction: summary.nextBestAction || fallback.nextBestAction,
        openLoops: Array.isArray(summary.openLoops) ? summary.openLoops : [],
        objections: Array.isArray(summary.objections)
          ? summary.objections
          : facts.filter((fact) => fact.key === "objection").map((fact) => fact.value),
        preferences: Object.fromEntries(
          facts
            .filter((fact) => fact.key.startsWith("preferred_"))
            .map((fact) => [fact.key, fact.value])
        ),
        lastUpdatedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return profile;
}
