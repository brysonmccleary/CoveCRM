// lib/facebook/applyAutoMode.ts
// Auto Mode engine — evaluate campaigns and create action nudges
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FollowUpNudge from "@/models/FollowUpNudge";

const ACTION_MESSAGES: Record<string, (name: string, score: number) => string> = {
  PAUSE: (name, score) =>
    `AUTO MODE: Campaign "${name}" scored ${score}/100 — recommend PAUSING. CPL is too high and outcomes are low. Cut spend before further losses.`,
  FIX: (name, score) =>
    `AUTO MODE: Campaign "${name}" scored ${score}/100 — needs FIX. Review targeting, creative, and landing page. Consider new hook and offer.`,
  SCALE: (name, score) =>
    `AUTO MODE: Campaign "${name}" scored ${score}/100 — ready to SCALE. Increase daily budget 20-30% while performance holds.`,
  DUPLICATE_TEST: (name, score) =>
    `AUTO MODE: Campaign "${name}" scored ${score}/100 — DUPLICATE AND TEST. Clone this campaign with a new creative angle to find winning variation.`,
};

const PRIORITY_MAP: Record<string, "high" | "medium" | "low"> = {
  PAUSE: "high",
  FIX: "high",
  SCALE: "medium",
  DUPLICATE_TEST: "medium",
  MONITOR: "low",
};

/**
 * Evaluate all auto-mode campaigns for a user.
 * Creates FollowUpNudge records for campaigns needing action.
 * Does NOT call Meta API — flag-only system.
 */
export async function applyAutoMode(userId: string, userEmail: string): Promise<void> {
  await mongooseConnect();

  const campaigns = await FBLeadCampaign.find({
    userId,
    autoModeOn: true,
    status: { $in: ["active", "paused"] },
  }).lean();

  for (const c of campaigns) {
    const score = (c as any).performanceScore;
    const pClass = (c as any).performanceClass;
    const name = (c as any).campaignName;

    if (!pClass || !score || pClass === "MONITOR") continue;

    const messageFn = ACTION_MESSAGES[pClass];
    if (!messageFn) continue;

    const message = messageFn(name, score);
    const priority = PRIORITY_MAP[pClass] ?? "medium";

    // Avoid duplicate nudges — check if one exists in last 24h for this campaign+action
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = await FollowUpNudge.findOne({
      userEmail,
      campaignId: c._id,
      dismissed: false,
      generatedAt: { $gte: oneDayAgo },
    }).lean();

    if (existing) continue;

    await FollowUpNudge.create({
      userEmail,
      campaignId: c._id,
      leadName: name,
      message,
      priority,
      dismissed: false,
      generatedAt: new Date(),
    });
  }
}
