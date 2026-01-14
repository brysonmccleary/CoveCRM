// pages/api/dashboard/stats.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import CallLog from "@/models/CallLog";
import Lead from "@/models/Lead";

type KPI = {
  dials: number;
  connects: number;
  totalTalkSec: number;
  avgTalkSec: number;
  longestTalkSec: number;
  contactRate: number;
};
type TrendPoint = { date?: string; hour?: string; label: string; dials: number; connects: number };

const DEFAULT_TZ = "America/Phoenix";
const CONNECT_THRESHOLD_DEFAULT = 2; // seconds

function parseYMD(s: string) {
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}
function startOfTodayUTC(tz: string) {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  } catch {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  }
}
function addDaysUTC(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function rangeFromQuery(req: NextApiRequest, tz: string): { from: Date; to: Date } {
  const q = req.query;
  const range = String(q.range || "").toLowerCase();
  const fromQ = typeof q.from === "string" ? q.from : "";
  const toQ = typeof q.to === "string" ? q.to : "";
  const todayStart = startOfTodayUTC(tz);

  if (fromQ && toQ) {
    const from = parseYMD(fromQ);
    const toStart = parseYMD(toQ);
    if (from && toStart) return { from, to: addDaysUTC(toStart, 1) };
  }

  switch (range) {
    case "today":
      return { from: todayStart, to: addDaysUTC(todayStart, 1) };
    case "thisweek": {
      const from = addDaysUTC(todayStart, -new Date().getUTCDay() + 1);
      return { from, to: addDaysUTC(from, 7) };
    }
    case "last30": {
      const to = addDaysUTC(todayStart, 1);
      return { from: addDaysUTC(to, -30), to };
    }
    case "last7":
    default: {
      const to = addDaysUTC(todayStart, 1);
      return { from: addDaysUTC(to, -7), to };
    }
  }
}

/** Case-insensitive match on userEmail + time window */
function baseMatchCI(userEmailLower: string, timeOr: any[]) {
  return {
    $and: [
      { $or: timeOr },
      { $expr: { $eq: [{ $toLower: "$userEmail" }, userEmailLower] } },
    ],
  };
}

/**
 * Option A connect rules:
 * - connect = talkTime >= threshold
 * - AND NOT voicemail (Call.isVoicemail !== true)
 * - AND if answeredBy exists: must be "human"
 *
 * IMPORTANT FIX:
 * - If talkTime/duration/durationSec are missing or wrong (common in conference legs),
 *   compute duration from timestamps and use the max() as talk time source.
 */
function addDerivedFields(connectThreshold: number) {
  return [
    // timestamps for duration fallback
    {
      $addFields: {
        _tsStart: { $ifNull: ["$startedAt", "$createdAt"] },
        _tsEnd: { $ifNull: ["$completedAt", { $ifNull: ["$endedAt", "$createdAt"] }] },
      },
    },
    {
      $addFields: {
        _durFromTs: {
          $cond: [
            {
              $and: [
                { $ne: ["$_tsStart", null] },
                { $ne: ["$_tsStart", undefined] },
                { $ne: ["$_tsEnd", null] },
                { $ne: ["$_tsEnd", undefined] },
              ],
            },
            {
              $dateDiff: {
                startDate: "$_tsStart",
                endDate: "$_tsEnd",
                unit: "second",
              },
            },
            0,
          ],
        },
      },
    },

    // your original talk source
    {
      $addFields: {
        _talkSrcRaw: {
          $cond: [
            { $and: [{ $ne: ["$talkTime", null] }, { $ne: ["$talkTime", undefined] }] },
            "$talkTime",
            {
              $cond: [
                { $and: [{ $ne: ["$duration", null] }, { $ne: ["$duration", undefined] }] },
                "$duration",
                {
                  $cond: [
                    { $and: [{ $ne: ["$durationSec", null] }, { $ne: ["$durationSec", undefined] }] },
                    "$durationSec",
                    0,
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    { $addFields: { _talkRawNum: { $toDouble: "$_talkSrcRaw" } } },

    // ✅ use max(raw, timestamp-derived)
    { $addFields: { _talkTimeNum: { $max: ["$_talkRawNum", { $toDouble: "$_durFromTs" }] } } },

    {
      $addFields: {
        _connectedByTalk: { $gte: ["$_talkTimeNum", connectThreshold] },
        _isVoicemailFlag: { $ifNull: ["$isVoicemail", false] },
        _answeredByLower: { $toLower: { $ifNull: ["$answeredBy", ""] } },

        _isDialFlag: {
          $or: [
            { $eq: ["$direction", "outbound"] },
            {
              $and: [
                { $or: [{ $eq: ["$direction", null] }, { $eq: ["$direction", undefined] }, { $eq: ["$direction", ""] }] },
                { $ne: ["$direction", "inbound"] },
              ],
            },
          ],
        },

        _ts: {
          $ifNull: [
            "$startedAt",
            { $ifNull: ["$completedAt", { $ifNull: ["$endedAt", "$createdAt"] }] },
          ],
        },
      },
    },
    {
      $addFields: {
        _connectedHuman: {
          $and: [
            "$_connectedByTalk",
            { $ne: ["$_isVoicemailFlag", true] },
            {
              $or: [
                { $eq: ["$_answeredByLower", ""] },
                { $eq: ["$_answeredByLower", "human"] },
              ],
            },
          ],
        },
      },
    },
  ] as any[];
}

/** Deduplicate by callSid first, then compute per-call metrics */
function dedupeByCallSid() {
  return [
    {
      $group: {
        _id: "$callSid",
        isDial: { $max: { $cond: ["$_isDialFlag", 1, 0] } },
        connected: { $max: { $cond: ["$_connectedHuman", 1, 0] } },
        talkTime: { $max: "$_talkTimeNum" },
        ts: { $max: "$_ts" },
      },
    },
    { $project: { _id: 0, isDial: 1, connected: 1, talkTime: 1, ts: 1 } },
  ] as any[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await dbConnect();

  const session = (await getServerSession(req, res, authOptions as any)) as
    | { user?: { email?: string | null } }
    | null;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const userEmail = String(session.user.email).toLowerCase();

  const tz = typeof req.query.tz === "string" && req.query.tz ? req.query.tz : DEFAULT_TZ;
  const connectThreshold = Math.max(
    0,
    parseInt(String(req.query.connectThreshold || CONNECT_THRESHOLD_DEFAULT), 10) || CONNECT_THRESHOLD_DEFAULT
  );

  const { from, to } = rangeFromQuery(req, tz);

  const callTimeOr = [
    { startedAt: { $gte: from, $lt: to } },
    { completedAt: { $gte: from, $lt: to } },
    { endedAt: { $gte: from, $lt: to } },
    { createdAt: { $gte: from, $lt: to } },
  ];

  const debugMode = String(req.query.debug || "") === "1";

  try {
    const kpiAgg = await (Call as any).aggregate([
      { $match: baseMatchCI(userEmail, callTimeOr) },
      ...addDerivedFields(connectThreshold),
      ...dedupeByCallSid(),
      {
        $group: {
          _id: null,
          dials: { $sum: "$isDial" },
          connects: { $sum: "$connected" },
          totalTalkSec: { $sum: "$talkTime" },
          longestTalkSec: { $max: "$talkTime" },
          sampleCountForAvg: { $sum: { $cond: [{ $gt: ["$talkTime", 0] }, 1, 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          dials: 1,
          connects: 1,
          totalTalkSec: { $ifNull: ["$totalTalkSec", 0] },
          longestTalkSec: { $ifNull: ["$longestTalkSec", 0] },
          sampleCountForAvg: 1,
        },
      },
    ]);

    const k = (kpiAgg?.[0] as any) || {
      dials: 0,
      connects: 0,
      totalTalkSec: 0,
      longestTalkSec: 0,
      sampleCountForAvg: 0,
    };
    const avgTalkSec = k.sampleCountForAvg > 0 ? Math.round(k.totalTalkSec / k.sampleCountForAvg) : 0;
    const contactRate = k.dials > 0 ? k.connects / k.dials : 0;

    const kpis: KPI = {
      dials: k.dials || 0,
      connects: k.connects || 0,
      totalTalkSec: k.totalTalkSec || 0,
      avgTalkSec,
      longestTalkSec: k.longestTalkSec || 0,
      contactRate,
    };

    const dispAgg = await (Lead as any).aggregate([
      { $match: { userEmail } },
      { $unwind: "$history" },
      {
        $project: {
          type: "$history.type",
          message: "$history.message",
          timestamp: "$history.timestamp",
        },
      },
      { $match: { type: "disposition", timestamp: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: null,
          sold: { $sum: { $cond: [{ $regexMatch: { input: "$message", regex: /sold/i } }, 1, 0] } },
          booked: { $sum: { $cond: [{ $regexMatch: { input: "$message", regex: /booked\s*appointment/i } }, 1, 0] } },
          notInterested: { $sum: { $cond: [{ $regexMatch: { input: "$message", regex: /not\s*interested/i } }, 1, 0] } },
        },
      },
      { $project: { _id: 0, sold: 1, booked: 1, notInterested: 1 } },
    ]);

    const dispositions = {
      sold: dispAgg?.[0]?.sold || 0,
      booked: dispAgg?.[0]?.booked || 0,
      notInterested: dispAgg?.[0]?.notInterested || 0,
      noAnswer: 0,
    };

    try {
      const noAns = await (CallLog as any).countDocuments({
        userEmail,
        status: "no_answer",
        timestamp: { $gte: from, $lt: to },
      });
      dispositions.noAnswer = noAns || 0;
    } catch {}

    const todayFrom = startOfTodayUTC(tz);
    const todayTo = addDaysUTC(todayFrom, 1);

    const hourlyAgg = await (Call as any).aggregate([
      {
        $match: baseMatchCI(userEmail, [
          { startedAt: { $gte: todayFrom, $lt: todayTo } },
          { completedAt: { $gte: todayFrom, $lt: todayTo } },
          { endedAt: { $gte: todayFrom, $lt: todayTo } },
          { createdAt: { $gte: todayFrom, $lt: todayTo } },
        ]),
      },
      ...addDerivedFields(connectThreshold),
      ...dedupeByCallSid(),
      {
        $addFields: {
          _bucket: { $dateToString: { format: "%H:00", date: "$ts", timezone: tz } },
        },
      },
      { $group: { _id: "$_bucket", dials: { $sum: "$isDial" }, connects: { $sum: "$connected" } } },
      { $sort: { _id: 1 } },
    ]);

    const hourlyToday: TrendPoint[] = Array.from({ length: 24 }, (_, h) => {
      const label = `${String(h).padStart(2, "0")}:00`;
      const f = hourlyAgg.find((r: any) => r._id === label);
      return { hour: label, label, dials: f?.dials || 0, connects: f?.connects || 0 };
    });

    async function dailyAgg(days: number): Promise<TrendPoint[]> {
      const end = addDaysUTC(todayFrom, 1);
      const start = addDaysUTC(end, -days);
      const rows = await (Call as any).aggregate([
        {
          $match: baseMatchCI(userEmail, [
            { startedAt: { $gte: start, $lt: end } },
            { completedAt: { $gte: start, $lt: end } },
            { endedAt: { $gte: start, $lt: end } },
            { createdAt: { $gte: start, $lt: end } },
          ]),
        },
        ...addDerivedFields(connectThreshold),
        ...dedupeByCallSid(),
        {
          $addFields: {
            _day: { $dateToString: { format: "%Y-%m-%d", date: "$ts", timezone: tz } },
          },
        },
        { $group: { _id: "$_day", dials: { $sum: "$isDial" }, connects: { $sum: "$connected" } } },
        { $sort: { _id: 1 } },
      ]);

      const filled: TrendPoint[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = addDaysUTC(end, -i - 1);
        const key = d.toISOString().slice(0, 10);
        const found = rows.find((r: any) => r._id === key);
        const label = d.toLocaleDateString("default", { month: "short", day: "numeric" });
        filled.push({ date: key, label, dials: found?.dials || 0, connects: found?.connects || 0 });
      }
      return filled;
    }

    const [daily7, daily30] = await Promise.all([dailyAgg(7), dailyAgg(30)]);

    const recentRows = await (Call as any).aggregate([
      { $match: baseMatchCI(userEmail, callTimeOr) },
      ...addDerivedFields(connectThreshold),
      ...dedupeByCallSid(),
      { $sort: { ts: -1 } },
      { $limit: 20 },
    ]);

    const recentDispos = await (Lead as any).aggregate([
      { $match: { userEmail } },
      { $unwind: "$history" },
      { $match: { "history.type": "disposition", "history.timestamp": { $gte: from, $lt: to } } },
      { $project: { _id: 0, leadId: "$_id", at: "$history.timestamp", message: "$history.message" } },
      { $sort: { at: -1 } },
      { $limit: 15 },
    ]);

    const recent = [
      ...recentRows.map((c: any) => ({
        type: "call" as const,
        at: new Date(c.ts || new Date()).toISOString(),
        callSid: undefined,
        leadId: null,
        direction: undefined,
        durationSec: c.talkTime ?? null,
        talkTime: c.talkTime ?? null,
        connected: !!c.connected,
        recordingUrl: null,
      })),
      ...recentDispos.map((d: any) => ({
        type: "disposition" as const,
        at: new Date(d.at).toISOString(),
        leadId: String(d.leadId),
        disposition: d.message || "",
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 20);

    let debug: any = undefined;
    if (debugMode) {
      const sample = await (Call as any).find({ userEmail }).sort({ completedAt: -1 }).limit(10).lean();
      debug = {
        connectThreshold,
        tz,
        window: { from: from.toISOString(), to: to.toISOString() },
        sampleLast10: sample.map((c: any) => ({
          callSid: c.callSid,
          startedAt: c.startedAt,
          completedAt: c.completedAt,
          endedAt: c.endedAt,
          duration: c.duration,
          durationSec: c.durationSec,
          talkTime: c.talkTime,
          isVoicemail: c.isVoicemail,
          answeredBy: c.answeredBy,
          direction: c.direction,
        })),
      };
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      range: { from: from.toISOString(), to: to.toISOString(), timezone: tz },
      kpis,
      dispositions,
      trends: { hourlyToday, daily7, daily30 },
      recent,
      ...(debugMode ? { debug } : {}),
    });
  } catch (err: any) {
    console.error("[DASHBOARD_STATS_ERROR]", err?.message || err);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
}
