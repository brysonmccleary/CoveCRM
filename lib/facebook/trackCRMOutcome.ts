// lib/facebook/trackCRMOutcome.ts
// Map dispositions to CRM outcomes and upsert CRMOutcome records
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadEntry from "@/models/FBLeadEntry";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import CRMOutcome from "@/models/CRMOutcome";
import AdMetricsDaily from "@/models/AdMetricsDaily";
import Lead from "@/models/Lead";
import { scoreAdPerformance } from "./scoreAdPerformance";
import { enqueueMetaLifecycleEventSafely, MetaLifecycleEventName } from "@/lib/meta/capi";

// Disposition → outcome field mapping
function dispositionToIncrement(disposition: string): Record<string, number> | null {
  const d = disposition.toLowerCase().trim();

  if (d === "booked appointment" || d === "booked" || d === "appointment booked") {
    return { appointmentsBooked: 1 };
  }
  if (d === "showed" || d === "appointment showed" || d === "sat") {
    return { appointmentsShowed: 1 };
  }
  if (d === "sold" || d === "sale") {
    return { sales: 1 };
  }
  if (d === "not interested" || d === "no interest" || d === "not_interested") {
    return { notInterested: 1 };
  }
  if (d === "bad number" || d === "wrong number" || d === "disconnected") {
    return { badNumbers: 1 };
  }
  if (d === "opt out" || d === "optout" || d === "do not contact" || d === "dnc") {
    return { optOuts: 1 };
  }

  return null;
}

export function dispositionToMetaLifecycleEvent(disposition: string): MetaLifecycleEventName | null {
  const d = disposition.toLowerCase().trim().replace(/_/g, " ");
  if (["contacted", "contact made", "reached"].includes(d)) return "Contacted";
  if (["qualified", "interested", "lead qualified"].includes(d)) return "Qualified";
  if (["booked appointment", "booked", "appointment booked", "scheduled"].includes(d)) return "AppointmentBooked";
  if (["showed", "appointment showed", "sat"].includes(d)) return "AppointmentShowed";
  if (["sold", "sale"].includes(d)) return "Sale";
  if (["policy issued", "issued", "placed"].includes(d)) return "PolicyIssued";
  return null;
}

/**
 * Called after a lead disposition is set.
 * Finds whether this lead came from an FB campaign, then updates CRMOutcome.
 */
export async function trackOutcomeFromDisposition(
  leadId: string,
  disposition: string
): Promise<void> {
  try {
    await mongooseConnect();

    const isSaleDisposition = ["sold", "sale"].includes(disposition.toLowerCase().trim());

    const ownedLead = await Lead.findById(leadId)
      .select("userEmail revenuePending Email email Phone metaLeadEventId metaAdId metaCreativeId metaVariantId metaCreativeFamily metaFbc metaFbp metaCampaignId")
      .lean();
    const userEmail = String((ownedLead as any)?.userEmail || "").toLowerCase();
    if (!ownedLead || !userEmail) {
      console.warn("[trackCRMOutcome] lead owner missing — outcome not tracked", { leadId, disposition });
      return;
    }

    // Find the FB lead entry linked to this CRM lead
    const fbEntry = await FBLeadEntry.findOne({ crmLeadId: leadId, userEmail }).lean();
    if (!fbEntry) {
      // Normal and expected for the vast majority of dispositions (most leads aren't FB-sourced),
      // so stay quiet in general — but a "Sold" disposition with no FBLeadEntry at all means this
      // sale can never be attributed to any campaign. Log it loudly so it's findable, without
      // throwing or surfacing anything to the agent who just recorded a real sale.
      if (isSaleDisposition) {
        console.warn("[trackCRMOutcome] ATTRIBUTION LOSS: sale recorded but lead has no FBLeadEntry — cannot attribute to any campaign", { leadId, disposition });
      }
      return;
    }

    const campaignId = (fbEntry as any).campaignId;
    if (!campaignId) {
      console.warn("[trackCRMOutcome] ATTRIBUTION LOSS: FBLeadEntry has no campaignId — outcome not tracked", { leadId, disposition, fbLeadEntryId: String((fbEntry as any)._id) });
      return;
    }

    const campaign = await FBLeadCampaign.findOne({ _id: campaignId, userEmail }).lean();
    if (!campaign) {
      console.warn("[trackCRMOutcome] ATTRIBUTION LOSS: campaign no longer exists — outcome not tracked", { leadId, disposition, campaignId: String(campaignId) });
      return;
    }

    const increment = dispositionToIncrement(disposition);
    const lifecycleEvent = dispositionToMetaLifecycleEvent(disposition);
    if (!increment && !lifecycleEvent) return;

    // A "Sold" disposition with revenuePending=true (premium not entered yet — see
    // disposition-lead.ts's enforcement) must not count as a sale until a real premium lands.
    // record-sale.ts calls this function directly once the premium is recorded, at which point
    // revenuePending will already be false and this check passes through normally.
    if (increment?.sales) {
      if ((ownedLead as any)?.revenuePending) {
        console.info("[trackCRMOutcome] Sale deferred — premium pending", { leadId, campaignId: String(campaignId) });
        return;
      }
    }

    const today = new Date().toISOString().split("T")[0];
    const userId = (campaign as any).userId;
    const leadEventId = String((fbEntry as any).leadEventId || (ownedLead as any).metaLeadEventId || "");
    const metaAdId = String((fbEntry as any).metaAdId || (ownedLead as any).metaAdId || "");
    const metaCreativeId = String((fbEntry as any).metaCreativeId || (ownedLead as any).metaCreativeId || "");
    const variantId = String((fbEntry as any).variantId || (ownedLead as any).metaVariantId || "");
    const creativeFamily = String((fbEntry as any).creativeFamily || (ownedLead as any).metaCreativeFamily || "");

    // NOTE: no revenue estimate is added here. The flat per-lead-type guess that used to live here
    // was never real money — real revenue is agent-entered via the Sale modal
    // (annualPremium/grossCommissionRevenue on Lead) and aggregated into
    // FBLeadCampaign.totalGrossRevenue by scoreAdPerformance.ts. That's the only number ROAS
    // should ever be computed from.

    // Build $inc object
    const incFields: Record<string, number> = {};
    for (const [k, v] of Object.entries(increment || {})) {
      incFields[k] = v;
    }

    // Upsert CRMOutcome — one record per (campaignId, userId, date)
    if (increment) await CRMOutcome.findOneAndUpdate(
      { campaignId, userId, userEmail, date: today, metaAdId, creativeFamily },
      {
        $inc: incFields,
        $setOnInsert: {
          campaignId,
          userId,
          userEmail,
          date: today,
          leadId,
          leadEventId,
          metaAdId,
          metaCreativeId,
          variantId,
          creativeFamily,
        },
      },
      { upsert: true, new: true }
    );

    // Also upsert AdMetricsDaily so it becomes the full-funnel daily source of truth
    if (increment) await AdMetricsDaily.findOneAndUpdate(
      { campaignId, userEmail, date: today },
      {
        $inc: incFields,
        $setOnInsert: {
          campaignId,
          userId,
          userEmail,
          date: today,
        },
      },
      { upsert: true, new: true }
    );

    // Re-score campaign (async, non-blocking in case it's slow)
    if (increment) {
      scoreAdPerformance(String(campaignId)).catch((err) => {
        console.warn("[trackCRMOutcome] re-score failed:", err?.message);
      });
    }
    if (lifecycleEvent && leadEventId) {
      await enqueueMetaLifecycleEventSafely({
        userEmail,
        leadId,
        leadEventId,
        eventName: lifecycleEvent,
        email: String((ownedLead as any).email || (ownedLead as any).Email || ""),
        phone: String((ownedLead as any).Phone || ""),
        fbc: String((ownedLead as any).metaFbc || ""),
        fbp: String((ownedLead as any).metaFbp || ""),
        metaCampaignId: String((ownedLead as any).metaCampaignId || (campaign as any).metaCampaignId || ""),
        metaAdId,
        metaCreativeId,
        creativeFamily,
      }, undefined, (err) => console.warn("[trackCRMOutcome] CAPI queue failed (non-blocking):", err?.message));
    }
  } catch (err: any) {
    console.error("[trackCRMOutcome] error:", err?.message);
    // Non-fatal — never throw from here
  }
}
