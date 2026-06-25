import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayoutLedger from "@/models/AffiliatePayoutLedger";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userId = (session?.user as any)?.id;
  if (!session?.user?.email || !userId) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  const affiliate = await Affiliate.findOne({ userId }).select({ _id: 1 }).lean();
  if (!affiliate) return res.status(404).json({ error: "Affiliate record not found" });

  const rows = await AffiliatePayoutLedger.find({ affiliateId: (affiliate as any)._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return res.status(200).json(
    rows.map((row: any) => ({
      month: row.month,
      amount: row.amount,
      status: row.status,
      paidAt: row.paidAt || null,
      stripeTransferId: row.stripeTransferId || null,
    })),
  );
}
