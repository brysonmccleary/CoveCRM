import mongooseConnect from "@/lib/mongooseConnect";
import { extractLeadMemory } from "@/lib/ai/memory/memoryExtractor";
import { generateLeadMemorySummary } from "@/lib/ai/memory/memorySummary";
import LeadInteractionEvent from "@/models/LeadInteractionEvent";
import LeadMemoryProfile from "@/models/LeadMemoryProfile";

type LeadMemoryHookArgs = {
  userEmail: string;
  leadId: string;
  type: "sms" | "call" | "note";
  body: string;
  direction?: "inbound" | "outbound" | "system";
  sourceId?: string;
};

const MEMORY_DEBOUNCE_MS = 10 * 60 * 1000;
const LOW_SIGNAL_SMS = new Set([
  "k",
  "ok",
  "okay",
  "yes",
  "y",
  "yep",
  "no",
  "nope",
  "thanks",
  "thank you",
  "thx",
  "got it",
  "sounds good",
  "done",
]);

function normalizeBody(body: string) {
  return String(body || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasMeaningfulSignal(body: string) {
  return /[?]/.test(body) || /\b\d{1,2}(:\d{2})?\s?(am|pm)?\b/i.test(body) || /\b(today|tomorrow|tonight|after|before|later|call|text|price|coverage|policy|spouse|wife|husband|appointment|book|schedule|callback)\b/i.test(body);
}

function isLowSignalSms(body: string) {
  const normalized = normalizeBody(body);
  return normalized.length > 0 && normalized.length <= 16 && LOW_SIGNAL_SMS.has(normalized);
}

function isHighValueEvent(args: LeadMemoryHookArgs, body: string) {
  if (args.type === "call") return true;
  if (args.type === "note") {
    return body.length >= 24 || /\b(appointment|booked|scheduled|callback|follow up|objection|coverage|budget|spouse)\b/i.test(body);
  }
  if (args.direction === "inbound") {
    return body.length >= 40 || hasMeaningfulSignal(body);
  }
  return body.length >= 80 || hasMeaningfulSignal(body);
}

function logMemoryHook(event: string, details: Record<string, unknown>) {
  console.info("[lead-memory]", { event, ...details });
}

function logOpenAIUsage(details: {
  source: string;
  userEmail?: string | null;
  leadId?: string | null;
  model: string;
  durationMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
}) {
  console.info("[openai-usage]", {
    source: details.source,
    userEmail: details.userEmail || null,
    leadId: details.leadId || null,
    model: details.model,
    durationMs: details.durationMs,
    promptTokens: details.promptTokens ?? null,
    completionTokens: details.completionTokens ?? null,
    costUsd: details.costUsd ?? null,
  });
}

export function queueLeadMemoryHook(args: LeadMemoryHookArgs) {
  setTimeout(async () => {
    try {
      const userEmail = String(args.userEmail || "").trim().toLowerCase();
      const leadId = String(args.leadId || "").trim();
      const body = String(args.body || "").trim();
      const direction = args.direction || "system";

      if (!userEmail || !leadId || !body) return;

      await mongooseConnect();

      const now = Date.now();
      const normalizedBody = normalizeBody(body);
      const highValue = isHighValueEvent(args, body);
      const recentThreshold = new Date(now - MEMORY_DEBOUNCE_MS);
      const [recentEvent, memoryProfile] = await Promise.all([
        LeadInteractionEvent.findOne({
          userEmail,
          leadId,
          createdAt: { $gte: recentThreshold },
        })
          .sort({ createdAt: -1 })
          .lean(),
        LeadMemoryProfile.findOne({ userEmail, leadId })
          .select({ lastUpdatedAt: 1 })
          .lean(),
      ]);

      const event = await LeadInteractionEvent.create({
        userEmail,
        leadId,
        type: args.type,
        direction,
        body,
        sourceId: args.sourceId || "",
      });

      const recentBody = normalizeBody(String(recentEvent?.body || ""));
      const recentlyUpdated =
        !!memoryProfile?.lastUpdatedAt &&
        new Date(memoryProfile.lastUpdatedAt).getTime() >= now - MEMORY_DEBOUNCE_MS;
      const isDuplicateRecentEvent =
        !!recentEvent &&
        recentBody.length > 0 &&
        recentBody === normalizedBody &&
        String(recentEvent.type || "") === args.type &&
        String(recentEvent.direction || "system") === direction;

      if (args.type === "sms" && isLowSignalSms(body)) {
        logMemoryHook("skip", {
          reason: "low_signal_sms",
          userEmail,
          leadId,
          direction,
          type: args.type,
          eventId: String(event._id),
        });
        return;
      }

      if (isDuplicateRecentEvent) {
        logMemoryHook("skip", {
          reason: "duplicate_recent_event",
          userEmail,
          leadId,
          direction,
          type: args.type,
          eventId: String(event._id),
        });
        return;
      }

      if (!highValue && (recentlyUpdated || !!recentEvent)) {
        logMemoryHook("skip", {
          reason: recentlyUpdated ? "recent_memory_update" : "debounced_recent_event",
          userEmail,
          leadId,
          direction,
          type: args.type,
          eventId: String(event._id),
        });
        return;
      }

      logMemoryHook("execute", {
        userEmail,
        leadId,
        direction,
        type: args.type,
        eventId: String(event._id),
        highValue,
      });

      const extractStartedAt = Date.now();
      await extractLeadMemory(
        userEmail,
        leadId,
        body,
        args.type,
        String(event._id)
      );
      logOpenAIUsage({
        source: "lib/ai/memory/queueLeadMemoryHook:extractLeadMemory",
        userEmail,
        leadId,
        model: "gpt-5-mini",
        durationMs: Date.now() - extractStartedAt,
      });

      const summaryStartedAt = Date.now();
      await generateLeadMemorySummary(userEmail, leadId);
      logOpenAIUsage({
        source: "lib/ai/memory/queueLeadMemoryHook:generateLeadMemorySummary",
        userEmail,
        leadId,
        model: "gpt-5-mini",
        durationMs: Date.now() - summaryStartedAt,
      });
    } catch (err) {
      console.error("Memory error", err);
    }
  }, 0);
}
