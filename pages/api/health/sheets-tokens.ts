// /pages/api/health/sheets-tokens.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const gs = (user as any).googleSheets || {};
  return res.status(200).json({
    ok: true,
    googleEmail: gs.googleEmail || null,
    hasAccessToken: !!gs.accessToken,
    hasRefreshToken: !!gs.refreshToken,
    expiryDate: gs.expiryDate || null,
  });
}
