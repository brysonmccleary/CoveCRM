// lib/leads/scoreLead.ts
// Score a newly-arrived lead 0–100 based on source, recency, contact info, time of day, day of week
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/lib/mongo/leads";

export type LeadSource =
  | "facebook_realtime"
  | "google_sheet"
  | "csv_import"
  | "manual"
  | "doi_prospecting";

const SOURCE_BONUS: Record<LeadSource, number> = {
  facebook_realtime: 30,
  doi_prospecting: 25,
  google_sheet: 15,
  manual: 10,
  csv_import: 5,
};

const BEST_CALL_HOURS: Record<number, string> = {
  0: "9:00 AM",
  1: "9:00 AM",
  2: "11:00 AM",
  3: "11:00 AM",
  4: "2:00 PM",
  5: "2:00 PM",
  6: "4:00 PM",
};

export interface ScoreResult {
  score: number;
  bestTimeToCall: string;
  breakdown: string[];
}

export async function scoreLeadOnArrival(
  leadId: string,
  source: LeadSource
): Promise<ScoreResult> {
  await mongooseConnect();
  const lead = await Lead.findById(leadId).lean();
  if (!lead) return { score: 0, bestTimeToCall: "Morning", breakdown: ["Lead not found"] };

  const breakdown: string[] = [];
  let score = 0;

  // Source bonus
  const sourcePts = SOURCE_BONUS[source] ?? 5;
  score += sourcePts;
  breakdown.push(`+${sourcePts} source (${source})`);

  // Contact info completeness
  const hasPhone = !!((lead as any).Phone || (lead as any).normalizedPhone);
  const hasEmail = !!((lead as any).Email || (lead as any).email);
  if (hasPhone) { score += 20; breakdown.push("+20 has phone"); }
  if (hasEmail) { score += 10; breakdown.push("+10 has email"); }

  // Recency: facebook_realtime and doi are always fresh; csv/sheet age by updatedAt
  if (source === "facebook_realtime" || source === "doi_prospecting") {
    score += 15;
    breakdown.push("+15 real-time lead");
  }

  // Time of day bonus (best hours 9–11 AM and 2–5 PM local)
  const now = new Date();
  const hour = now.getHours();
  if ((hour >= 9 && hour <= 11) || (hour >= 14 && hour <= 17)) {
    score += 10;
    breakdown.push("+10 optimal call window");
  }

  // Day of week bonus (Mon–Thu > Fri–Sun)
  const dow = now.getDay(); // 0=Sun
  if (dow >= 1 && dow <= 4) {
    score += 10;
    breakdown.push("+10 weekday");
  } else if (dow === 5) {
    score += 5;
    breakdown.push("+5 Friday");
  }

  // Clamp
  score = Math.min(100, Math.max(0, score));

  // Best time to call: use day of week as rough heuristic
  const bestTimeToCall = BEST_CALL_HOURS[dow] ?? "10:00 AM";

  // Persist back to lead
  await Lead.updateOne(
    { _id: leadId },
    {
      $set: {
        score,
        bestTimeToCall,
        scoredAt: new Date(),
        leadSource: source,
      },
    }
  );

  return { score, bestTimeToCall, breakdown };
}
