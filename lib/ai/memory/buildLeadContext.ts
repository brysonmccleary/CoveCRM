import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import Message from "@/models/Message";
import CallLog from "@/models/CallLog";
import LeadMemoryFact from "@/models/LeadMemoryFact";
import LeadMemoryProfile from "@/models/LeadMemoryProfile";

export async function buildLeadContext(userEmail: string, leadId: string) {
  await mongooseConnect();

  const [lead, profile, facts, messages, lastCall] = await Promise.all([
    (Lead as any).findOne({ _id: leadId, userEmail }).lean(),
    LeadMemoryProfile.findOne({ userEmail, leadId }).lean(),
    LeadMemoryFact.find({ userEmail, leadId, status: "active" }).sort({ updatedAt: -1 }).lean(),
    Message.find({ userEmail, leadId }).sort({ createdAt: -1 }).limit(10).lean(),
    CallLog.find({ userEmail, leadId: String(leadId) }).sort({ timestamp: -1 }).limit(1).lean(),
  ]);

  const folderSettings =
    lead?.folderId ? await Folder.findOne({ _id: lead.folderId, userEmail }).lean() : null;

  const keyFacts = facts.map((fact) => ({
    key: fact.key,
    value: fact.value,
    confidence: fact.confidence,
  }));
  const recentMessages = messages
    .slice()
    .reverse()
    .map((message) => ({
      direction: String(message.direction || "unknown"),
      text: String(message.text || "").trim(),
      createdAt: message.createdAt,
    }))
    .filter((message) => message.text);

  const keyFactsText = keyFacts.length
    ? keyFacts.map((fact) => `- ${fact.key}: ${fact.value}`).join("\n")
    : "(none)";
  const lastMessagesText = recentMessages.length
    ? recentMessages
        .map((message) => `- ${message.direction}: ${message.text}`)
        .join("\n")
    : "(none)";
  const objections = Array.isArray(profile?.objections) ? profile.objections : [];
  const objectionsText = objections.length
    ? objections.map((item) => `- ${String(item || "").trim()}`).filter(Boolean).join("\n")
    : "(none)";
  const preferences =
    profile?.preferences && typeof profile.preferences === "object" && !Array.isArray(profile.preferences)
      ? profile.preferences
      : {};
  const preferencesText = Object.entries(preferences).length
    ? Object.entries(preferences)
        .map(([key, value]) => `- ${key}: ${String(value ?? "").trim()}`)
        .filter((line) => !line.endsWith(":"))
        .join("\n")
    : "(none)";

  return {
    leadSummary: profile?.shortSummary || "",
    keyFacts,
    keyFactsText,
    lastMessages: recentMessages,
    lastMessagesText,
    lastCallSummary: lastCall[0] || null,
    nextBestAction: profile?.nextBestAction || "",
    objections,
    objectionsText,
    preferences,
    preferencesText,
    lastUpdatedAt: profile?.lastUpdatedAt || null,
    folderSettings,
  };
}
