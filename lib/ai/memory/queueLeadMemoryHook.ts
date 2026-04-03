import mongooseConnect from "@/lib/mongooseConnect";
import { extractLeadMemory } from "@/lib/ai/memory/memoryExtractor";
import { generateLeadMemorySummary } from "@/lib/ai/memory/memorySummary";
import LeadInteractionEvent from "@/models/LeadInteractionEvent";

type LeadMemoryHookArgs = {
  userEmail: string;
  leadId: string;
  type: "sms" | "call" | "note";
  body: string;
  direction?: "inbound" | "outbound" | "system";
  sourceId?: string;
};

export function queueLeadMemoryHook(args: LeadMemoryHookArgs) {
  setTimeout(async () => {
    try {
      const userEmail = String(args.userEmail || "").trim().toLowerCase();
      const leadId = String(args.leadId || "").trim();
      const body = String(args.body || "").trim();

      if (!userEmail || !leadId || !body) return;

      await mongooseConnect();

      const event = await LeadInteractionEvent.create({
        userEmail,
        leadId,
        type: args.type,
        direction: args.direction || "system",
        body,
        sourceId: args.sourceId || "",
      });

      await extractLeadMemory(
        userEmail,
        leadId,
        body,
        args.type,
        String(event._id)
      );

      await generateLeadMemorySummary(userEmail, leadId);
    } catch (err) {
      console.error("Memory error", err);
    }
  }, 0);
}
