import { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { email } = req.query;
  if (!email || typeof email !== "string") return res.status(400).end();

  await mongooseConnect();
  const affiliate = await Affiliate.findOne({ email });
  if (!affiliate) return res.status(404).end();

  res.status(200).json(affiliate);
}
