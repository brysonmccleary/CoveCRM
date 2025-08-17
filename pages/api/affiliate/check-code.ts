// /pages/api/affiliate/check-code.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Missing code" });

  await dbConnect();

  const promoCode = code.trim().toUpperCase();

  const existing = await Affiliate.findOne({ promoCode });

  res.status(200).json({ available: !existing });
}
