// pages/api/admin/doi-leads.ts
// Paginated DOI lead pool with search/filter and summary stats. Admin only.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import DOILead from "@/models/DOILead";

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
  const state = req.query.state ? String(req.query.state).toUpperCase() : "";
  const search = req.query.search ? String(req.query.search).trim() : "";

  const now = new Date();

  // Build filter
  const filter: Record<string, any> = {};
  if (state) filter.state = state;
  if (search) {
    filter.$or = [
      { email: { $regex: search, $options: "i" } },
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
    ];
  }

  const [leads, total, totalAll, unsubscribed, onCooldown] = await Promise.all([
    DOILead.find(filter)
      .select("firstName lastName email state licenseType scrapedAt lastAssignedAt cooldownUntil globallyUnsubscribed")
      .sort({ scrapedAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    DOILead.countDocuments(filter),
    DOILead.countDocuments({}),
    DOILead.countDocuments({ globallyUnsubscribed: true }),
    DOILead.countDocuments({ cooldownUntil: { $gt: now } }),
  ]);

  const available = totalAll - unsubscribed - onCooldown;

  return res.status(200).json({
    leads,
    total,
    page,
    pages: Math.ceil(total / PAGE_SIZE),
    stats: {
      total: totalAll,
      available: Math.max(0, available),
      unsubscribed,
      onCooldown,
    },
  });
}
