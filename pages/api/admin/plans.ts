// pages/api/admin/plans.ts
// All ProspectingPlan records with optional status filter. Admin only.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import ProspectingPlan from "@/models/ProspectingPlan";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email || session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await mongooseConnect();

  const filter: Record<string, any> = {};
  if (req.query.status) filter.status = String(req.query.status);

  const plans = await ProspectingPlan.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  return res.status(200).json({ plans });
}
