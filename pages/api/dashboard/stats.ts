// /pages/api/dashboard/stats.ts
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

/** Parse `YYYY-MM-DD` into a UTC midnight Date. */
function parseYMD(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
}

/** Get "today" at 00:00 in the requested timezone, returned as a UTC Date. */
function startOfTodayUTC(tz: string) {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const parts = fmt.formatToParts(now);
    const y = Number(parts.find(p => p.type === "year")?.value);
    const m = Number(parts.find(p => p.type === "month")?.value);
    const d = Number(parts.find(p => p.type === "day")?.value);
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  } catch {
    // Fallback: server UTC midnight
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  }
}

function addDaysUTC(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Range resolver: supports range= today | thisWeek | last7 | last30 OR explicit from/to=YYYY-MM-DD */
function rangeFromQuery(req: NextApiRequest, tz: string): { from: Date; to: Date } {
  const q = req.query;
  const range = String(q.range || "").toLowerCase();
  const fromQ = typeof q.from === "string" ? q.from : "";
  const toQ = typeof q.to === "string" ? q.to : "";
  const todayStart = startOfTodayUTC(tz);

  // Explicit dates take precedence
  if (fromQ && toQ) {
    const from = parseYMD(fromQ);
    const toStart = parseYMD(toQ);
    if (from && toStart) return { from, to: addDaysUTC(toStart, 1) };
  }

  switch (range) {
    case "today":
      return { from: todayStart, to: addDaysUTC(todayStart, 1) };

    case "thisweek": {
      // Week start = Monday (ISO), using tz-based today
      // Determine weekday in tz by making a "local" copy via Intl pieces
      const local = new Date(todayStart); // todayStart is UTC midnight of tz’s date
      // Convert to local components with tz to infer day-of-week (0=Sun..6=Sat)
      const dayOfWeek = new Date(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate()
      ).getUTCDay(); // acceptable approximation for ISO week start needs
      // Shift so Monday is start (Mon=1..Sun=0). If Sunday (0), we want -6 days.
      const shift = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const from = addDaysUTC(todayStart, shift);
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

/** Safe string check for AMD "human" */
function isHumanAMD(v: unknown): boolean {
  try {
    if (typeof v === "string") return /human/i.test(v);
    if (v && typeof v === "object" && "answeredBy" in (v as any)) {
      const s = String((v as any).answeredBy || "");
      return /human/i.test(s);
    }
    return false;
  } catch { return false; }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const userEmail = String(session.user.email).toLowerCase();

  const tz = typeof req.query.tz === "string" && req.query.tz ? req.query.tz : DEFAULT_TZ;
  const connectThresholdRaw = String(req.query.connectThreshold ?? "10").trim();
  const connectThreshold = Number.isFinite(Number(connectThresholdRaw)) ? Math.max(0, Math.floor(Number(connectThresholdRaw))) : 10;

  const { from, to } = rangeFromQuery(req, tz);

  // Consider call within window if any of these timestamps land in-range
  const callTimeOr = [
    { startedAt:   { $gte: from, $lt: to } },
    { completedAt: { $gte: from, $lt: to } },
    { createdAt:   { $gte: from, $lt: to } },
  ];

  try {
    // ---------- KPIs ----------
    // _talkTime = talkTime || duration || 0
    // _connectedByTalk = _talkTime >= connectThreshold
    // _connectedByAMD = amd.answeredBy =~ /human/i
    // _isDial = outbound or unspecified (not inbound)
    const kpiAgg = await (Call as any).aggregate([
      { $match: { userEmail, $or: callTimeOr } },
      {
        $addFields: {
          _talkTime: {
            $cond: [
              { $and: [{ $ne: ["$talkTime", null] }, { $ne: ["$talkTime", undefined] }] },
              "$talkTime",
              { $cond: [{ $and: [{ $ne: ["$duration", null] }, { $ne: ["$duration", undefined] }] }, "$duration", 0] },
            ],
          },
          _connectedByTalk: { $gte: ["$_talkTime", connectThreshold] },
          _connectedByAMD: {
            $cond: [
              {
                $regexMatch: {
                  input: { $toString: "$amd.answeredBy" },
                  regex: /human/i,
                },
              },
              true,
              false,
            ],
          },
          _isDial: {
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
        },
      },
      {
        $group: {
          _id: null,
          dials: { $sum: { $cond: ["$_isDial", 1, 0] } },
          connects: { $sum: { $cond: [{ $or: ["$_connectedByTalk", "$_connectedByAMD"] }, 1, 0] } },
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

    const k = (kpiAgg?.[0] as any) || { dials: 0, connects: 0, totalTalkSec: 0, longestTalkSec: 0, sampleCountForAvg: 0 };
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

    // ---------- Dispositions (from Lead.history) ----------
    const dispAgg = await (Lead as any).aggregate([
      { $match: { userEmail } },
      { $unwind: "$history" },
      { $project: { type: "$history.type", message: "$history.message", timestamp: "$history.timestamp" } },
      { $match: { type: "disposition", timestamp: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: null,
          sold:           { $sum: { $cond: [{ $regexMatch: { input: "$message", regex: /sold/i } }, 1, 0] } },
          booked:         { $sum: { $cond: [{ $regexMatch: { input: "$message", regex: /booked\s*appointment/i } }, 1, 0] } },
          notInterested:  { $sum: { $cond: [{ $regexMatch: { input: "$message", regex: /not\s*interested/i } }, 1, 0] } },
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

    // If you still capture legacy no-answer in CallLog, add it safely
    try {
      const noAns = await (CallLog as any).countDocuments({
        userEmail,
        status: "no_answer",
        timestamp: { $gte: from, $lt: to },
      });
      dispositions.noAnswer = noAns || 0;
    } catch { /* optional */ }

    // ---------- Hourly today (tz-aware) ----------
    const todayFrom = startOfTodayUTC(tz);
    const todayTo = addDaysUTC(todayFrom, 1);

    const hourlyAgg = await (Call as any).aggregate([
      {
        $match: {
          userEmail,
          $or: [
            { startedAt:   { $gte: todayFrom, $lt: todayTo } },
            { completedAt: { $gte: todayFrom, $lt: todayTo } },
            { createdAt:   { $gte: todayFrom, $lt: todayTo } },
          ],
        },
      },
      {
        $addFields: {
          _talkTime: {
            $cond: [
              { $and: [{ $ne: ["$talkTime", null] }, { $ne: ["$talkTime", undefined] }] },
              "$talkTime",
              { $cond: [{ $and: [{ $ne: ["$duration", null] }, { $ne: ["$duration", undefined] }] }, "$duration", 0] },
            ],
          },
          _connectedByTalk: { $gte: ["$_talkTime", connectThreshold] },
          _connectedByAMD: {
            $cond: [
              {
                $regexMatch: {
                  input: { $toString: "$amd.answeredBy" },
                  regex: /human/i,
                },
              },
              true,
              false,
            ],
          },
          _isDial: {
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
          _bucket: {
            $dateToString: {
              format: "%H:00",
              date: { $ifNull: ["$startedAt", { $ifNull: ["$completedAt", "$createdAt"] }] },
              timezone: tz,
            },
          },
        },
      },
      {
        $group: {
          _id: "$_bucket",
          dials:    { $sum: { $cond: ["$_isDial", 1, 0] } },
          connects: { $sum: { $cond: [{ $or: ["$_connectedByTalk", "$_connectedByAMD"] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const hourlyToday: TrendPoint[] = Array.from({ length: 24 }, (_, h) => {
      const label = `${String(h).padStart(2, "0")}:00`;
      const f = hourlyAgg.find((r: any) => r._id === label);
      return { hour: label, label, dials: f?.dials || 0, connects: f?.connects || 0 };
    });

    // ---------- Daily trends (7 & 30 days) ----------
    async function dailyAgg(days: number): Promise<TrendPoint[]> {
      const end = addDaysUTC(todayFrom, 1);
      const start = addDaysUTC(end, -days);

      const rows = await (Call as any).aggregate([
        {
          $match: {
            userEmail,
            $or: [
              { startedAt:   { $gte: start, $lt: end } },
              { completedAt: { $gte: start, $lt: end } },
              { createdAt:   { $gte: start, $lt: end } },
            ],
          },
        },
        {
          $addFields: {
            _talkTime: {
              $cond: [
                { $and: [{ $ne: ["$talkTime", null] }, { $ne: ["$talkTime", undefined] }] },
                "$talkTime",
                { $cond: [{ $and: [{ $ne: ["$duration", null] }, { $ne: ["$duration", undefined] }] }, "$duration", 0] },
              ],
            },
            _connectedByTalk: { $gte: ["$_talkTime", connectThreshold] },
            _connectedByAMD: {
              $cond: [
                {
                  $regexMatch: {
                    input: { $toString: "$amd.answeredBy" },
                    regex: /human/i,
                  },
                },
                true,
                false,
              ],
            },
            _isDial: {
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
            _day: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: { $ifNull: ["$startedAt", { $ifNull: ["$completedAt", "$createdAt"] }] },
                timezone: tz,
              },
            },
          },
        },
        {
          $group: {
            _id: "$_day",
            dials:    { $sum: { $cond: ["$_isDial", 1, 0] } },
            connects: { $sum: { $cond: [{ $or: ["$_connectedByTalk", "$_connectedByAMD"] }, 1, 0] } },
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

    // ---------- Recent activity ----------
    const recentCalls = await (Call as any)
      .find({ userEmail, $or: callTimeOr })
      .sort({ createdAt: -1 })
      .limit(15)
      .lean();

    const recentDispos = await (Lead as any).aggregate([
      { $match: { userEmail } },
      { $unwind: "$history" },
      { $match: { "history.type": "disposition", "history.timestamp": { $gte: from, $lt: to } } },
      { $project: { _id: 0, leadId: "$_id", at: "$history.timestamp", message: "$history.message" } },
      { $sort: { at: -1 } },
      { $limit: 15 },
    ]);

    const recent = [
      ...recentCalls.map((c: any) => ({
        type: "call" as const,
        at: (c.startedAt || c.completedAt || c.createdAt || new Date()).toISOString(),
        callSid: c.callSid,
        leadId: c.leadId ? String(c.leadId) : null,
        direction: c.direction || "outbound",
        durationSec: typeof c.duration === "number" ? c.duration : null,
        talkTime: typeof c.talkTime === "number" ? c.talkTime : (typeof c.duration === "number" ? c.duration : null),
        connected:
          (typeof c.talkTime === "number" ? c.talkTime : (typeof c.duration === "number" ? c.duration : 0)) >= connectThreshold ||
          isHumanAMD((c as any)?.amd),
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
