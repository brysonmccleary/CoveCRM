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

/** Case-insensitive userEmail match you can reuse in all pipelines */
function userEmailMatchCI(userEmailLower: string, timeOr: any[]) {
  return {
    $and: [
      { $or: timeOr },
      {
        $expr: {
          $eq: [{ $toLower: "$userEmail" }, userEmailLower],
        },
      },
    ],
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await dbConnect();

  const session = (await getServerSession(req, res, authOptions as any)) as
    | { user?: { email?: string | null } }
    | null;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const userEmail = String(session.user.email).toLowerCase();

  const tz =
    typeof req.query.tz === "string" && req.query.tz ? req.query.tz : DEFAULT_TZ;
  const connectThreshold =
    Math.max(
      0,
      parseInt(String(req.query.connectThreshold || CONNECT_THRESHOLD_DEFAULT), 10) ||
        CONNECT_THRESHOLD_DEFAULT,
    );

  const { from, to } = rangeFromQuery(req, tz);

  // Consider a record “in range” if any of these timestamps are in range
  const callTimeOr = [
    { startedAt: { $gte: from, $lt: to } },
    { completedAt: { $gte: from, $lt: to } },
    { createdAt: { $gte: from, $lt: to } },
  ];

  // ---------- Shared stage used in all 3 aggs so the rules stay identical ----------
  const addDerivedFieldsStage = [
    {
      $addFields: {
        // talkTime fallback -> duration -> 0
        _talkTime: {
          $cond: [
            { $and: [{ $ne: ["$talkTime", null] }, { $ne: ["$talkTime", undefined] }] },
            "$talkTime",
            {
              $cond: [
                { $and: [{ $ne: ["$duration", null] }, { $ne: ["$duration", undefined] }] },
                "$duration",
                0,
              ],
            },
          ],
        },
        // Any missing/empty direction defaults to outbound for counting dials
        _isDial: { $ne: ["$direction", "inbound"] },

        // AMD normalization: “human” if present (case-insensitive)
        _amdHuman: {
          $regexMatch: {
            input: { $ifNull: [{ $toString: "$amd.answeredBy" }, ""] },
            regex: /human/i,
          },
        },

        // Single source of truth for connect: talk time OR AMD says human
        _connected: {
          $or: [{ $gte: ["$_talkTime", connectThreshold] }, "$_amdHuman"],
        },
      },
    },
  ] as any[];

  try {
    // ---------- KPIs ----------
    const kpiAgg = await (Call as any).aggregate([
      { $match: userEmailMatchCI(userEmail, callTimeOr) },
      ...addDerivedFieldsStage,
      {
        $group: {
          _id: null,
          dials: { $sum: { $cond: ["$_isDial", 1, 0] } },
          connects: { $sum: { $cond: ["$_connected", 1, 0] } },
          totalTalkSec: { $sum: "$_talkTime" },
          longestTalkSec: { $max: "$_talkTime" },
          sampleCountForAvg: { $sum: { $cond: [{ $gt: ["$_talkTime", 0] }, 1, 0] } },
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
    const avgTalkSec =
      k.sampleCountForAvg > 0 ? Math.round(k.totalTalkSec / k.sampleCountForAvg) : 0;
    const contactRate = k.dials > 0 ? k.connects / k.dials : 0;

    const kpis: KPI = {
      dials: k.dials || 0,
      connects: k.connects || 0,
      totalTalkSec: k.totalTalkSec || 0,
      avgTalkSec,
      longestTalkSec: k.longestTalkSec || 0,
      contactRate,
    };

    // ---------- Dispositions ----------
    const dispAgg = await (Lead as any).aggregate([
      { $match: { userEmail } }, // Lead docs already stored lower-case by your code; keep as-is
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
          sold: {
            $sum: { $cond: [{ $regexMatch: { input: "$message", regex: /sold/i } }, 1, 0] },
          },
          booked: {
            $sum: {
              $cond: [{ $regexMatch: { input: "$message", regex: /booked\s*appointment/i } }, 1, 0],
            },
          },
          notInterested: {
            $sum: {
              $cond: [{ $regexMatch: { input: "$message", regex: /not\s*interested/i } }, 1, 0],
            },
          },
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

    // ---------- Hourly (today) ----------
    const todayFrom = startOfTodayUTC(tz);
    const todayTo = addDaysUTC(todayFrom, 1);
    const hourlyAgg = await (Call as any).aggregate([
      {
        $match: userEmailMatchCI(userEmail, [
          { startedAt: { $gte: todayFrom, $lt: todayTo } },
          { completedAt: { $gte: todayFrom, $lt: todayTo } },
          { createdAt: { $gte: todayFrom, $lt: todayTo } },
        ]),
      },
      ...addDerivedFieldsStage,
      {
        $addFields: {
          _bucket: {
            $dateToString: {
              format: "%H:00",
              date: {
                $ifNull: ["$startedAt", { $ifNull: ["$completedAt", "$createdAt"] }],
              },
              timezone: tz,
            },
          },
        },
      },
      {
        $group: {
          _id: "$_bucket",
          dials: { $sum: { $cond: ["$_isDial", 1, 0] } },
          connects: { $sum: { $cond: ["$_connected", 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const hourlyToday: TrendPoint[] = Array.from({ length: 24 }, (_, h) => {
      const label = `${String(h).padStart(2, "0")}:00`;
      const f = hourlyAgg.find((r: any) => r._id === label);
      return { hour: label, label, dials: f?.dials || 0, connects: f?.connects || 0 };
    });

    // ---------- Daily (7 & 30) ----------
    async function dailyAgg(days: number): Promise<TrendPoint[]> {
      const end = addDaysUTC(todayFrom, 1);
      const start = addDaysUTC(end, -days);
      const rows = await (Call as any).aggregate([
        {
          $match: userEmailMatchCI(userEmail, [
            { startedAt: { $gte: start, $lt: end } },
            { completedAt: { $gte: start, $lt: end } },
            { createdAt: { $gte: start, $lt: end } },
          ]),
        },
        ...addDerivedFieldsStage,
        {
          $addFields: {
            _day: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: {
                  $ifNull: ["$startedAt", { $ifNull: ["$completedAt", "$createdAt"] }],
                },
                timezone: tz,
              },
            },
          },
        },
        {
          $group: {
            _id: "$_day",
            dials: { $sum: { $cond: ["$_isDial", 1, 0] } },
            connects: { $sum: { $cond: ["$_connected", 1, 0] } },
          },
        },
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

    // ---------- Recent ----------
    // Use aggregate here as well so the same case-insensitive match applies
    const recentRows = await (Call as any).aggregate([
      { $match: userEmailMatchCI(userEmail, callTimeOr) },
      { $sort: { createdAt: -1 } },
      { $limit: 15 },
    ]);

    const recentDispos = await (Lead as any).aggregate([
      { $match: { userEmail } },
      { $unwind: "$history" },
      {
        $match: {
          "history.type": "disposition",
          "history.timestamp": { $gte: from, $lt: to },
        },
      },
      {
        $project: {
          _id: 0,
          leadId: "$_id",
          at: "$history.timestamp",
          message: "$history.message",
        },
      },
      { $sort: { at: -1 } },
      { $limit: 15 },
    ]);

    const recent = [
      ...recentRows.map((c: any) => ({
        type: "call" as const,
        at: (c.startedAt || c.completedAt || c.createdAt || new Date()).toISOString(),
        callSid: c.callSid,
        leadId: c.leadId ? String(c.leadId) : null,
        direction: c.direction || "outbound",
        durationSec: typeof c.duration === "number" ? c.duration : null,
        talkTime:
          typeof c.talkTime === "number"
            ? c.talkTime
            : typeof c.duration === "number"
            ? c.duration
            : null,
        connected:
          (typeof c.talkTime === "number" ? c.talkTime : (typeof c.duration === "number" ? c.duration : 0)) >=
            connectThreshold ||
          (typeof (c as any)?.amd?.answeredBy === "string" &&
            /human/i.test((c as any).amd.answeredBy)),
        recordingUrl: c.recordingUrl || null,
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

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      range: { from: from.toISOString(), to: to.toISOString(), timezone: tz },
      kpis,
      dispositions,
      trends: { hourlyToday, daily7, daily30 },
      recent,
    });
  } catch (err: any) {
    console.error("[DASHBOARD_STATS_ERROR]", err?.message || err);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
}
