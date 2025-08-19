import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import AffiliatePayout from "@/models/AffiliatePayout";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { email } = req.query;
  if (!email || typeof email !== "string") return res.status(400).end();

  await mongooseConnect();

  const affiliate = await (
    await import("@/models/Affiliate")
  ).default.findOne({ email });
  if (!affiliate) return res.status(404).end();

  const payouts = await AffiliatePayout.find({
    affiliateId: affiliate._id,
  }).sort({ createdAt: -1 });

  res.status(200).json(payouts);
}
