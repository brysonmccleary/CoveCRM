// pages/api/team/leaderboard.ts
// GET — leaderboard stats per team member with date range support
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import TeamMember from "@/models/TeamMember";
import Call from "@/models/Call";
import Message from "@/models/Message";
import Booking from "@/models/Booking";
import Lead from "@/lib/mongo/leads";

function getRangeStart(range: string): Date {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (range === "7days") {
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  // 30days default
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  start.setHours(0, 0, 0, 0);
  return start;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const ownerEmail = session.user.email.toLowerCase();

  const range = String(req.query.range || "30days");
  const since = getRangeStart(range);

  const members = await TeamMember.find({ ownerEmail, status: "active" }).lean();
  const memberEmails = members.map((m: any) => m.memberEmail);
  const emails = [ownerEmail, ...memberEmails];

  const board = await Promise.all(
    emails.map(async (email) => {
      const [
        allCalls,
        connectCalls,
        smsCount,
        leadsAdded,
        appointmentsBooked,
        talkTimeAgg,
      ] = await Promise.all([
        // Total dials in range
        (Call as any).countDocuments({ userEmail: email, startedAt: { $gte: since } }),
        // Connects = calls with duration > 30 seconds
        (Call as any).countDocuments({ userEmail: email, startedAt: { $gte: since }, duration: { $gt: 30 } }),
        // Outbound SMS sent
        (Message as any).countDocuments({ userEmail: email, direction: "outbound", createdAt: { $gte: since } }).catch(() => 0),
        // Leads added
        (Lead as any).countDocuments({ userEmail: email, createdAt: { $gte: since } }),
        // Bookings (appointments booked)
        (Booking as any).countDocuments({ agentEmail: email, createdAt: { $gte: since } }).catch(() => 0),
        // Total talk time (sum of duration)
        (Call as any).aggregate([
          { $match: { userEmail: email, startedAt: { $gte: since }, duration: { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: "$duration" } } },
        ]).catch(() => []),
      ]);

      const totalTalkSec = talkTimeAgg?.[0]?.total || 0;
      const talkTimeMinutes = Math.round(totalTalkSec / 60);
      const connectRate = allCalls > 0 ? Math.round((connectCalls / allCalls) * 100) : 0;

      const member = members.find((m: any) => m.memberEmail === email);
      const name = (member as any)?.memberName || (email === ownerEmail ? "You" : email);

      return {
        email,
        name,
        isOwner: email === ownerEmail,
        calls: allCalls,
        connects: connectCalls,
        connectRate,
        talkTimeMinutes,
        smsCount,
        leadsAdded,
        appointmentsBooked,
      };
    })
  );

  // Sort by calls desc
  board.sort((a, b) => b.calls - a.calls || b.appointmentsBooked - a.appointmentsBooked);

  // Add rank
  const ranked = board.map((entry, i) => ({ ...entry, rank: i + 1 }));

  return res.status(200).json({ board: ranked, range, since: since.toISOString() });
}
