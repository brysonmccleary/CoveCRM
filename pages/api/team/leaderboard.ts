// pages/api/team/leaderboard.ts
// GET — return leaderboard stats for all team members
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import TeamMember from "@/models/TeamMember";
import Lead from "@/lib/mongo/leads";
import CallLog from "@/models/CallLog";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const ownerEmail = session.user.email.toLowerCase();

  const members = await TeamMember.find({ ownerEmail, status: "active" }).lean();
  const emails = [ownerEmail, ...members.map((m: any) => m.memberEmail)];

  const thisMonth = new Date();
  thisMonth.setDate(1);
  thisMonth.setHours(0, 0, 0, 0);

  const board = await Promise.all(
    emails.map(async (email) => {
      const [newLeads, bookedLeads, calls] = await Promise.all([
        Lead.countDocuments({ userEmail: email, createdAt: { $gte: thisMonth } }),
        Lead.countDocuments({ userEmail: email, status: "Booked Appointment", updatedAt: { $gte: thisMonth } }),
        (CallLog as any).countDocuments?.({ userEmail: email, createdAt: { $gte: thisMonth } }) ?? 0,
      ]);

      const member = members.find((m: any) => m.memberEmail === email);
      return {
        email,
        name: (member as any)?.memberName || (email === ownerEmail ? "You" : email),
        newLeads,
        bookedLeads,
        calls,
        isOwner: email === ownerEmail,
      };
    })
  );

  // Sort by booked desc, then new leads
  board.sort((a, b) => b.bookedLeads - a.bookedLeads || b.newLeads - a.newLeads);

  return res.status(200).json({ board, month: thisMonth.toISOString().slice(0, 7) });
}
