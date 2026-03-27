// lib/leads/trackLeadSourceStat.ts
// Increment lead count for the given source in the current month
import LeadSourceStat from "@/models/LeadSourceStat";

export async function trackLeadSourceStat(
  userEmail: string,
  source: string
): Promise<void> {
  const month = new Date().toISOString().slice(0, 7); // "2026-03"
  await LeadSourceStat.findOneAndUpdate(
    { userEmail, source, month },
    { $inc: { leadCount: 1 } },
    { upsert: true }
  );
}

export async function trackLeadContacted(userEmail: string, source: string): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  await LeadSourceStat.findOneAndUpdate(
    { userEmail, source, month },
    { $inc: { contactedCount: 1 } },
    { upsert: true }
  );
}

export async function trackLeadBooked(userEmail: string, source: string): Promise<void> {
  const month = new Date().toISOString().slice(0, 7);
  await LeadSourceStat.findOneAndUpdate(
    { userEmail, source, month },
    { $inc: { bookedCount: 1 } },
    { upsert: true }
  );
}
