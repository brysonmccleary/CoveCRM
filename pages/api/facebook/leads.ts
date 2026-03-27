// pages/api/facebook/leads.ts
// GET — paginated list of FBLeadEntry records for the authenticated user
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadEntry from "@/models/FBLeadEntry";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = { userEmail: session.user.email.toLowerCase() };
  if (req.query.campaignId) filter.campaignId = req.query.campaignId;
  if (req.query.importedToCrm !== undefined) {
    filter.importedToCrm = req.query.importedToCrm === "true";
  }

  const [leads, total] = await Promise.all([
    FBLeadEntry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    FBLeadEntry.countDocuments(filter),
  ]);

  return res.status(200).json({ leads, total, page, pages: Math.ceil(total / limit) });
}
