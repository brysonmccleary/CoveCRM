import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ connected: false });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });

  const connected = Boolean(user?.googleRefreshToken);
  return res.status(200).json({ connected });
}
