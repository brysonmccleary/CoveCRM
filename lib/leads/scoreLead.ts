// lib/leads/scoreLead.ts
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/lib/mongo/leads";
import Call from "@/models/Call";
import Message from "@/models/Message";

export type LeadSource =
  | "facebook_realtime"
  | "google_sheet"
  | "csv_import"
  | "manual"
  | "doi_prospecting";

const SOURCE_BONUS: Record<LeadSource, number> = {
  facebook_realtime: 22,
  doi_prospecting: 18,
  google_sheet: 6,
  manual: 10,
  csv_import: 0,
};

export interface ScoreResult {
  score: number;
  bestTimeToCall: string;
  breakdown: string[];
  realTimeEligible: boolean;
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function normalizeSource(source: LeadSource, lead: any): string {
  return String(
    source ||
      lead?.leadSource ||
      lead?.source ||
      ""
  )
    .trim()
    .toLowerCase();
}

function isRealTimeEligible(source: LeadSource, lead: any): boolean {
  const src = normalizeSource(source, lead);

  if (source === "facebook_realtime") return true;
  if (source === "manual") return true;
  if (source === "doi_prospecting") return true;

  if (lead?.metaLeadgenId) return true;
  if (src === "facebook_webhook") return true;
  if (src === "facebook") return true;
  if (src === "manual-lead") return true;
  if (src === "manual") return true;
  if (src === "inbound_sms") return true;

  if (
    src === "csv" ||
    src === "csv_import" ||
    src === "folder-bulk" ||
    src === "sheet-bulk" ||
    src === "google-sheets" ||
    src === "google_sheet"
  ) {
    return false;
  }

  return false;
}

function getLeadTypeBonus(leadTypeRaw: any): { pts: number; label: string } {
  const t = String(leadTypeRaw || "").toLowerCase().trim();
  if (!t) return { pts: 0, label: "unknown lead type" };
  if (t.includes("mortgage")) return { pts: 8, label: "mortgage protection lead type" };
  if (t.includes("iul")) return { pts: 7, label: "IUL lead type" };
  if (t.includes("veteran")) return { pts: 6, label: "veteran lead type" };
  if (t.includes("final")) return { pts: 5, label: "final expense lead type" };
  return { pts: 3, label: "other lead type" };
}

function getFreshnessPoints(createdAt: any): { pts: number; label: string } {
  const created = createdAt ? new Date(createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return { pts: 0, label: "unknown freshness" };

  const ageMin = (Date.now() - created.getTime()) / 60000;

  if (ageMin <= 15) return { pts: 25, label: "fresh lead < 15m" };
  if (ageMin <= 60) return { pts: 18, label: "fresh lead < 1h" };
  if (ageMin <= 240) return { pts: 10, label: "fresh lead < 4h" };
  if (ageMin <= 1440) return { pts: 5, label: "fresh lead < 24h" };
  return { pts: 0, label: "not fresh" };
}

function bucketHour(h: number): "Morning" | "Midday" | "Afternoon" | "Evening" {
  if (h < 11) return "Morning";
  if (h < 14) return "Midday";
  if (h < 18) return "Afternoon";
  return "Evening";
}

function bestTimeLabelFromBucket(bucket: "Morning" | "Midday" | "Afternoon" | "Evening"): string {
  if (bucket === "Morning") return "9:00 AM – 11:00 AM";
  if (bucket === "Midday") return "11:00 AM – 1:00 PM";
  if (bucket === "Afternoon") return "2:00 PM – 5:00 PM";
  return "5:00 PM – 7:00 PM";
}

function fallbackBestTime(lead: any): string {
  const ageNum = Number(String(lead?.Age || "").replace(/[^\d]/g, ""));
  const leadType = String(lead?.leadType || "").toLowerCase();

  if (!Number.isNaN(ageNum) && ageNum >= 60) return "10:00 AM – 1:00 PM";
  if (leadType.includes("mortgage") || leadType.includes("iul")) return "4:00 PM – 6:00 PM";
  return "11:00 AM – 1:00 PM";
}

export async function scoreLeadOnArrival(
  leadId: string,
  source: LeadSource
): Promise<ScoreResult> {
  await mongooseConnect();

  const lead = await Lead.findById(leadId).lean<any>();
  if (!lead) {
    return {
      score: 0,
      bestTimeToCall: "11:00 AM – 1:00 PM",
      breakdown: ["Lead not found"],
      realTimeEligible: false,
    };
  }

  const breakdown: string[] = [];
  let score = 0;

  const userEmail = String(lead.userEmail || "").toLowerCase();
  const realTimeEligible = isRealTimeEligible(source, lead);

  // --------------------------------------------------
  // 1) Source quality
  // --------------------------------------------------
  const sourcePts = SOURCE_BONUS[source] ?? 0;
  score += sourcePts;
  breakdown.push(`+${sourcePts} source quality (${source})`);

  if (realTimeEligible) {
    breakdown.push(`+0 realtime eligible`);
  } else {
    breakdown.push(`+0 non-realtime / imported-style lead`);
  }

  // --------------------------------------------------
  // 2) Freshness (only for realtime leads)
  // --------------------------------------------------
  if (realTimeEligible) {
    const freshness = getFreshnessPoints(lead.createdAt);
    score += freshness.pts;
    breakdown.push(`+${freshness.pts} ${freshness.label}`);
  } else {
    breakdown.push(`+0 freshness skipped for bulk/imported lead`);
  }

  // --------------------------------------------------
  // 3) Profile completeness
  // --------------------------------------------------
  const hasPhone = !!(lead?.Phone || lead?.phone || lead?.normalizedPhone);
  const hasEmail = !!(lead?.Email || lead?.email);
  const hasAge = !!String(lead?.Age || "").trim();
  const hasState = !!String(lead?.State || "").trim();
  const hasNotes = !!String(lead?.Notes || "").trim();
  const hasBeneficiary = !!String(lead?.Beneficiary || "").trim();
  const hasCoverage = !!String(lead?.["Coverage Amount"] || "").trim();

  if (hasPhone) { score += 18; breakdown.push(`+18 has phone`); }
  if (hasEmail) { score += 8; breakdown.push(`+8 has email`); }
  if (hasAge) { score += 5; breakdown.push(`+5 has age`); }
  if (hasState) { score += 4; breakdown.push(`+4 has state`); }
  if (hasNotes) { score += 2; breakdown.push(`+2 has notes`); }
  if (hasBeneficiary) { score += 3; breakdown.push(`+3 has beneficiary`); }
  if (hasCoverage) { score += 4; breakdown.push(`+4 has coverage amount`); }

  const leadTypeBonus = getLeadTypeBonus(lead?.leadType);
  score += leadTypeBonus.pts;
  breakdown.push(`+${leadTypeBonus.pts} ${leadTypeBonus.label}`);

  // --------------------------------------------------
  // 4) Historical SMS engagement
  // --------------------------------------------------
  const messages = await Message.find({
    userEmail,
    leadId: lead._id,
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean<any[]>();

  const inboundMsgs = messages.filter((m) => m.direction === "inbound");
  const outboundMsgs = messages.filter((m) => m.direction === "outbound" || m.direction === "ai");

  if (inboundMsgs.length > 0) {
    score += 15;
    breakdown.push(`+15 inbound SMS replies (${inboundMsgs.length})`);
  }

  if (outboundMsgs.length >= 1 && inboundMsgs.length === 0) {
    score -= 4;
    breakdown.push(`-4 outbound attempts with no SMS reply yet`);
  }

  if (outboundMsgs.length >= 3 && inboundMsgs.length === 0) {
    score -= 4;
    breakdown.push(`-4 repeated SMS attempts with no reply`);
  }

  // --------------------------------------------------
  // 5) Historical call engagement
  // --------------------------------------------------
  const calls = await Call.find({
    userEmail,
    $or: [{ leadId: lead._id }, { leadId: String(lead._id) }],
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean<any[]>();

  let connectedHumanCalls = 0;
  let noAnswerCalls = 0;
  let voicemailCalls = 0;

  for (const c of calls) {
    const answeredBy = String(c?.answeredBy || "").toLowerCase();
    const talkTime = Number(c?.talkTime || 0);
    const duration = Number(c?.duration || 0);
    const isHuman = answeredBy === "human" || talkTime >= 20 || duration >= 45;
    const isVM = c?.isVoicemail === true || (answeredBy && answeredBy !== "human");

    if (isHuman) connectedHumanCalls += 1;
    else if (isVM) voicemailCalls += 1;
    else noAnswerCalls += 1;
  }

  if (connectedHumanCalls > 0) {
    const pts = Math.min(18, connectedHumanCalls * 8);
    score += pts;
    breakdown.push(`+${pts} connected human calls (${connectedHumanCalls})`);
  }

  if (voicemailCalls > 0) {
    const pts = Math.min(8, voicemailCalls * 2);
    score -= pts;
    breakdown.push(`-${pts} voicemail / machine outcomes (${voicemailCalls})`);
  }

  if (noAnswerCalls >= 2) {
    const pts = Math.min(10, noAnswerCalls * 2);
    score -= pts;
    breakdown.push(`-${pts} repeated no-answer calls (${noAnswerCalls})`);
  }

  // --------------------------------------------------
  // 6) Best time to call
  // --------------------------------------------------
  const timeSignals: Date[] = [];

  for (const m of inboundMsgs) {
    if (m?.createdAt) {
      const d = new Date(m.createdAt);
      if (!Number.isNaN(d.getTime())) timeSignals.push(d);
    }
  }

  for (const c of calls) {
    const answeredBy = String(c?.answeredBy || "").toLowerCase();
    const talkTime = Number(c?.talkTime || 0);
    const duration = Number(c?.duration || 0);
    const isHuman = answeredBy === "human" || talkTime >= 20 || duration >= 45;
    const when = c?.startedAt || c?.completedAt || c?.createdAt;
    if (isHuman && when) {
      const d = new Date(when);
      if (!Number.isNaN(d.getTime())) timeSignals.push(d);
    }
  }

  let bestTimeToCall = fallbackBestTime(lead);

  if (timeSignals.length >= 2) {
    const buckets: Record<"Morning" | "Midday" | "Afternoon" | "Evening", number> = {
      Morning: 0,
      Midday: 0,
      Afternoon: 0,
      Evening: 0,
    };

    for (const d of timeSignals) {
      buckets[bucketHour(d.getHours())] += 1;
    }

    const bestBucket = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0]?.[0] as
      | "Morning"
      | "Midday"
      | "Afternoon"
      | "Evening"
      | undefined;

    if (bestBucket) {
      bestTimeToCall = bestTimeLabelFromBucket(bestBucket);
      breakdown.push(`best time derived from actual engagement (${bestBucket.toLowerCase()})`);
    }
  } else {
    breakdown.push(`best time using fallback heuristic`);
  }

  score = clamp(Math.round(score));

  await Lead.updateOne(
    { _id: leadId },
    {
      $set: {
        score,
        bestTimeToCall,
        scoreBreakdown: breakdown,
        scoreVersion: "v2",
        realTimeEligible,
        scoreUpdatedAt: new Date(),
        scoredAt: new Date(),
        leadSource: source,
      },
    }
  );

  return {
    score,
    bestTimeToCall,
    breakdown,
    realTimeEligible,
  };
}