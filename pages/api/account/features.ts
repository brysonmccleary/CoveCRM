import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";

const CALL_AI_SUMMARY_ENABLED = (process.env.CALL_AI_SUMMARY_ENABLED || "").toString() === "1";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  await dbConnect();
  const user = await getUserByEmail(email);

  const aiCalls = Boolean(user?.hasAI) && CALL_AI_SUMMARY_ENABLED;

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ aiCalls });
}
