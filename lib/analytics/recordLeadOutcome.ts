import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import LeadOutcomeEvent from "@/models/LeadOutcomeEvent";
import { trackOutcomeFromDisposition } from "@/lib/facebook/trackCRMOutcome";
import { Types } from "mongoose";

type RecordLeadOutcomeArgs = {
  leadId: string;
  userEmail: string;
  rawDisposition: string;
  source: string;
  folderId?: string | Types.ObjectId | null;
  occurredAt?: Date;
  metadata?: Record<string, any>;
  updateLegacyCounters?: boolean;
};

type RecordLeadOutcomeResult = {
  created: boolean;
  eventKey: string;
  normalizedDisposition: string;
  outcomeType: string;
};

function normalizeDisposition(input: string): { normalizedDisposition: string; outcomeType: string } {
  const compact = String(input || "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

  if (["sold", "sale", "closed", "closed sale"].includes(compact)) {
    return { normalizedDisposition: "sold", outcomeType: "sale" };
  }
  if (["booked", "booked appointment", "appointment booked", "scheduled"].includes(compact)) {
    return { normalizedDisposition: "booked_appointment", outcomeType: "appointment_booked" };
  }
  if (["showed", "appointment showed", "sat", "show"].includes(compact)) {
    return { normalizedDisposition: "appointment_showed", outcomeType: "appointment_showed" };
  }
  if (["not interested", "no interest", "not interested anymore"].includes(compact)) {
    return { normalizedDisposition: "not_interested", outcomeType: "not_interested" };
  }
  if (["bad number", "wrong number", "disconnected"].includes(compact)) {
    return { normalizedDisposition: "bad_number", outcomeType: "bad_number" };
  }
  if (["no show", "noshow"].includes(compact)) {
    return { normalizedDisposition: "no_show", outcomeType: "no_show" };
  }
  if (["opt out", "optout", "do not contact", "do not call", "dnc", "stop"].includes(compact)) {
    return { normalizedDisposition: "opt_out", outcomeType: "opt_out" };
  }
  if (["transfer success", "transferred", "live transfer"].includes(compact)) {
    return { normalizedDisposition: "transfer_success", outcomeType: "transfer_success" };
  }
  if (["call connected", "connected"].includes(compact)) {
    return { normalizedDisposition: "call_connected", outcomeType: "call_connected" };
  }
  if (compact) {
    return {
      normalizedDisposition: compact.replace(/\s+/g, "_"),
      outcomeType: compact.replace(/\s+/g, "_"),
    };
  }
  return { normalizedDisposition: "unknown", outcomeType: "unknown" };
}

function toEventKey(args: {
  leadId: string;
  normalizedDisposition: string;
  metadata?: Record<string, any>;
}) {
  const leadId = String(args.leadId || "").trim();
  const disposition = String(args.normalizedDisposition || "").trim().toLowerCase();
  const metadata = args.metadata || {};

  if (disposition === "booked_appointment") {
    const bookingId = cleanIdentity(metadata.bookingId);
    if (bookingId) return [leadId, disposition, "booking", bookingId].join(":");

    const eventId = cleanIdentity(metadata.eventId);
    if (eventId) return [leadId, disposition, "event", eventId].join(":");

    const appointmentBucket = appointmentTimeBucket(metadata.appointmentTime);
    if (appointmentBucket) return [leadId, disposition, "appointment", appointmentBucket].join(":");

    return [leadId, disposition].join(":");
  }

  if (disposition === "no_show") {
    const bookingId = cleanIdentity(metadata.bookingId);
    return bookingId
      ? [leadId, disposition, "booking", bookingId].join(":")
      : [leadId, disposition].join(":");
  }

  return [leadId, disposition].join(":");
}

function cleanIdentity(value: unknown): string {
  const str = String(value || "").trim();
  if (!str || str === "null" || str === "undefined") return "";
  return str.replace(/\s+/g, "_").toLowerCase();
}

function appointmentTimeBucket(value: unknown): string {
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  date.setSeconds(0, 0);
  return date.toISOString();
}

function asObjectId(value: string | Types.ObjectId | null | undefined) {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

export async function recordLeadOutcome(args: RecordLeadOutcomeArgs): Promise<RecordLeadOutcomeResult> {
  await mongooseConnect();

  const userEmail = String(args.userEmail || "").trim().toLowerCase();
  const leadId = String(args.leadId || "").trim();
  const source = String(args.source || "unknown").trim().toLowerCase();
  const rawDisposition = String(args.rawDisposition || "").trim();
  const { normalizedDisposition, outcomeType } = normalizeDisposition(rawDisposition);
  const metadata = args.metadata || {};
  const eventKey = toEventKey({ leadId, normalizedDisposition, metadata });

  const lead = await Lead.findOne({ _id: leadId, userEmail }).lean() as any;
  if (!lead) {
    throw new Error("Lead not found for outcome event.");
  }

  try {
    await LeadOutcomeEvent.create({
      eventKey,
      userEmail,
      leadId: new Types.ObjectId(leadId),
      folderId: asObjectId(args.folderId || lead.folderId),
      campaignId: lead.campaignId || lead.sourceCampaignId || lead.facebookCampaignId || null,
      metaCampaignId: String(lead.metaCampaignId || ""),
      metaAdsetId: String(lead.metaAdsetId || ""),
      metaAdId: String(lead.metaAdId || ""),
      metaCreativeId: String(lead.metaCreativeId || lead.creativeId || ""),
      visualVariantIndex: Number.isFinite(Number(lead.visualVariantIndex)) ? Number(lead.visualVariantIndex) : null,
      creativeArchetype: String(lead.creativeArchetype || ""),
      variationType: String(lead.variationType || ""),
      sourceType: String(lead.sourceType || ""),
      outcomeType,
      normalizedDisposition,
      rawDisposition,
      source,
      occurredAt: args.occurredAt || new Date(),
      metadata,
    });

    console.log("[LEAD_OUTCOME_EVENT_CREATED]", {
      eventKey,
      leadId,
      userEmail,
      outcomeType,
      source,
    });

    if (args.updateLegacyCounters !== false) {
      await trackOutcomeFromDisposition(leadId, rawDisposition);
    }

    return { created: true, eventKey, normalizedDisposition, outcomeType };
  } catch (err: any) {
    if (err?.code === 11000) {
      console.log("[LEAD_OUTCOME_EVENT_DUPLICATE_SKIPPED]", {
        eventKey,
        leadId,
        userEmail,
        outcomeType,
        source,
      });
      return { created: false, eventKey, normalizedDisposition, outcomeType };
    }
    throw err;
  }
}
