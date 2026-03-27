// lib/leads/generateNudges.ts
// Generates smart follow-up nudges for leads that haven't been contacted recently
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/lib/mongo/leads";
import FollowUpNudge from "@/models/FollowUpNudge";

const STALE_THRESHOLDS = [
  { days: 1, priority: "high" as const, label: "24 hours" },
  { days: 3, priority: "medium" as const, label: "3 days" },
  { days: 7, priority: "low" as const, label: "1 week" },
];

const NUDGE_MESSAGES: Record<string, string[]> = {
  high: [
    "New lead sitting untouched — call within the next few hours for best contact rates.",
    "Hot lead alert: first 24 hours have the highest conversion. Don't let this one go cold.",
  ],
  medium: [
    "This lead hasn't been contacted in 3 days. A quick follow-up call can re-engage them.",
    "3 days with no contact — send a text or call to stay top of mind.",
  ],
  low: [
    "It's been over a week since any activity on this lead. Consider a re-engagement drip.",
    "This lead has gone quiet. A personal text or voicemail drop could bring them back.",
  ],
};

function pickMessage(priority: "high" | "medium" | "low"): string {
  const msgs = NUDGE_MESSAGES[priority];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

export async function generateNudgesForUser(userEmail: string): Promise<number> {
  await mongooseConnect();

  const now = new Date();
  let created = 0;

  for (const threshold of STALE_THRESHOLDS) {
    const cutoff = new Date(now.getTime() - threshold.days * 24 * 60 * 60 * 1000);

    // Find leads with no activity since cutoff, status "New" or "Contacted"
    const staleLeads = await Lead.find({
      userEmail,
      status: { $in: ["New", "Contacted"] },
      updatedAt: { $lt: cutoff },
    })
      .select("_id firstName lastName First\\ Name Last\\ Name")
      .limit(10)
      .lean();

    for (const lead of staleLeads) {
      const leadId = String((lead as any)._id);
      const firstName = (lead as any)["First Name"] || (lead as any).firstName || "";
      const lastName = (lead as any)["Last Name"] || (lead as any).lastName || "";
      const leadName = `${firstName} ${lastName}`.trim() || "Unknown Lead";

      // Don't create duplicate nudges for same lead
      const existing = await FollowUpNudge.findOne({
        userEmail,
        leadId,
        dismissed: false,
      });
      if (existing) continue;

      await FollowUpNudge.create({
        userEmail,
        leadId,
        leadName,
        message: pickMessage(threshold.priority),
        priority: threshold.priority,
      });
      created++;
    }
  }

  return created;
}
