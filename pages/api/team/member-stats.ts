// pages/api/team/member-stats.ts
// GET ?memberEmail=xxx — per-agent performance profile + top objections
// Scope: requesting user must be the team owner of that member, or the member themselves.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import TeamMember from "@/models/TeamMember";
import Call from "@/models/Call";
import Booking from "@/models/Booking";
import CallCoachReport from "@/models/CallCoachReport";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const ownerEmail = session.user.email.toLowerCase();
  const targetEmail = String(req.query.memberEmail || "").toLowerCase().trim();
  if (!targetEmail) return res.status(400).json({ error: "memberEmail required" });

  // Scope check: must be the owner themselves, or an active member of the owner's team
  if (targetEmail !== ownerEmail) {
    const member = await TeamMember.findOne({
      ownerEmail,
      memberEmail: targetEmail,
      status: "active",
    }).lean();
    if (!member) return res.status(403).json({ error: "Not a member of your team" });
  }

  const [
    totalDials,
    connectedCalls,
    talkTimeAgg,
    appointmentsBooked,
    aiOverviewCount,
    recentCalls,
    objFromCalls,
    objFromCoach,
  ] = await Promise.all([
    (Call as any).countDocuments({ userEmail: targetEmail }),
    (Call as any).countDocuments({ userEmail: targetEmail, duration: { $gt: 30 } }),
    (Call as any).aggregate([
      { $match: { userEmail: targetEmail, duration: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: "$duration" }, cnt: { $sum: 1 } } },
    ]),
    (Booking as any).countDocuments({ agentEmail: targetEmail }).catch(() => 0),
    (Call as any).countDocuments({ userEmail: targetEmail, aiOverviewReady: true }),
    (Call as any)
      .find({ userEmail: targetEmail })
      .sort({ startedAt: -1 })
      .limit(10)
      .select("startedAt duration direction answeredBy aiOverview callSid")
      .lean(),
    // Aggregate objections stored in Call.aiOverview.objections[]
    (Call as any)
      .aggregate([
        { $match: { userEmail: targetEmail, "aiOverview.objections.0": { $exists: true } } },
        { $unwind: "$aiOverview.objections" },
        {
          $group: {
            _id: { $toLower: { $trim: { input: "$aiOverview.objections" } } },
            count: { $sum: 1 },
            lastHeard: { $max: "$startedAt" },
          },
        },
        { $match: { _id: { $ne: "" } } },
      ])
      .catch(() => []),
    // Aggregate objections stored in CallCoachReport.objectionsEncountered[]
    CallCoachReport.aggregate([
      { $match: { userEmail: targetEmail, "objectionsEncountered.0": { $exists: true } } },
      { $unwind: "$objectionsEncountered" },
      {
        $group: {
          _id: { $toLower: { $trim: { input: "$objectionsEncountered.objection" } } },
          count: { $sum: 1 },
        },
      },
      { $match: { _id: { $ne: "" } } },
    ]).catch(() => []),
  ]);

  const totalTalkSec = (talkTimeAgg as any[])?.[0]?.total || 0;
  const callCount = (talkTimeAgg as any[])?.[0]?.cnt || 0;
  const talkTimeMinutes = Math.round(totalTalkSec / 60);
  const avgCallDurationSec = callCount > 0 ? Math.round(totalTalkSec / callCount) : 0;

  // Merge objection frequencies from both sources
  const objFreq: Record<string, { count: number; lastHeard: Date | null }> = {};
  for (const e of objFromCalls as any[]) {
    if (!e._id) continue;
    objFreq[e._id] = { count: e.count, lastHeard: e.lastHeard || null };
  }
  for (const e of objFromCoach as any[]) {
    if (!e._id) continue;
    if (objFreq[e._id]) {
      objFreq[e._id].count += e.count;
    } else {
      objFreq[e._id] = { count: e.count, lastHeard: null };
    }
  }
  const topObjections = Object.entries(objFreq)
    .map(([text, { count, lastHeard }]) => ({ text, count, lastHeard }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return res.status(200).json({
    memberEmail: targetEmail,
    totalDials,
    connectedCalls,
    talkTimeMinutes,
    avgCallDurationSec,
    appointmentsBooked,
    aiOverviewCount,
    recentCalls,
    topObjections,
  });
}
