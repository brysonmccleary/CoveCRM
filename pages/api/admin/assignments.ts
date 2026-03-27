// pages/api/admin/assignments.ts
// Paginated LeadAssignment records with filters. Admin only.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import LeadAssignment from "@/models/LeadAssignment";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";
const PAGE_SIZE = 50;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email || session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await mongooseConnect();

  const page = Math.max(1, Number(req.query.page) || 1);
  const userEmail = req.query.userEmail ? String(req.query.userEmail).trim().toLowerCase() : "";
  const status = req.query.status ? String(req.query.status).trim() : "";

  const filter: Record<string, any> = {};
  if (userEmail) filter.userEmail = { $regex: userEmail, $options: "i" };
  if (status) filter.status = status;

  const [assignments, total] = await Promise.all([
    LeadAssignment.find(filter)
      .populate("doiLeadId", "firstName lastName email state")
      .sort({ assignedAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    LeadAssignment.countDocuments(filter),
  ]);

  return res.status(200).json({
    assignments,
    total,
    page,
    pages: Math.ceil(total / PAGE_SIZE),
  });
}
