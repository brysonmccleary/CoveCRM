// pages/api/settings/compensation.ts
// GET — return defaultCompPercentage
// POST — update defaultCompPercentage
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const VALID_COMP_PERCENTAGES = [80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase() || "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  if (req.method === "GET") {
    const user = await User.findOne({ email }).select("defaultCompPercentage").lean() as any;
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.status(200).json({ defaultCompPercentage: user.defaultCompPercentage ?? 100 });
  }

  if (req.method === "POST") {
    const comp = Number(req.body?.defaultCompPercentage);
    if (!VALID_COMP_PERCENTAGES.includes(comp)) {
      return res.status(400).json({ error: `Comp % must be one of: ${VALID_COMP_PERCENTAGES.join(", ")}` });
    }
    await User.updateOne({ email }, { $set: { defaultCompPercentage: comp } });
    return res.status(200).json({ ok: true, defaultCompPercentage: comp });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
