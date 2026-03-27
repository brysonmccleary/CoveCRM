// lib/facebook/trackCRMOutcome.ts
// Map dispositions to CRM outcomes and upsert CRMOutcome records
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadEntry from "@/models/FBLeadEntry";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import CRMOutcome from "@/models/CRMOutcome";
import { scoreAdPerformance } from "./scoreAdPerformance";

// Revenue estimates by lead type
const REVENUE_BY_LEAD_TYPE: Record<string, number> = {
  final_expense: 800,
  mortgage_protection: 1200,
  iul: 2000,
  veteran: 500,
  trucker: 600,
};

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
    return { sales: 1 }; // revenue added per campaign lead type
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

    // Find the FB lead entry linked to this CRM lead
    const fbEntry = await FBLeadEntry.findOne({ crmLeadId: leadId }).lean();
    if (!fbEntry) return; // not an FB lead — nothing to track

    const campaignId = (fbEntry as any).campaignId;
    if (!campaignId) return;

    const campaign = await FBLeadCampaign.findById(campaignId).lean();
    if (!campaign) return;

    const increment = dispositionToIncrement(disposition);
    if (!increment) return;

    const today = new Date().toISOString().split("T")[0];
    const userId = (campaign as any).userId;
    const userEmail = (campaign as any).userEmail;
    const leadType = (campaign as any).leadType as string;

    // Add revenue for sales
    if (increment.sales) {
      increment.revenue = REVENUE_BY_LEAD_TYPE[leadType] ?? 800;
    }

    // Build $inc object
    const incFields: Record<string, number> = {};
    for (const [k, v] of Object.entries(increment)) {
      incFields[k] = v;
    }

    // Upsert CRMOutcome — one record per (campaignId, userId, date)
    await CRMOutcome.findOneAndUpdate(
      { campaignId, userId, date: today },
      {
        $inc: incFields,
        $setOnInsert: {
          campaignId,
          userId,
          userEmail,
          date: today,
          leadId,
        },
      },
      { upsert: true, new: true }
    );

    // Re-score campaign (async, non-blocking in case it's slow)
    scoreAdPerformance(String(campaignId)).catch((err) => {
      console.warn("[trackCRMOutcome] re-score failed:", err?.message);
    });
  } catch (err: any) {
    console.error("[trackCRMOutcome] error:", err?.message);
    // Non-fatal — never throw from here
  }
}
