// /pages/api/account/features.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User, { getUserByEmail } from "@/models/User";

const CALL_AI_SUMMARY_ENABLED =
  (process.env.CALL_AI_SUMMARY_ENABLED || "").toString() === "1";

const ADMIN_FREE_AI_EMAILS: string[] = (process.env.ADMIN_FREE_AI_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isAdminFree(email?: string | null) {
  return !!email && ADMIN_FREE_AI_EMAILS.includes(email.toLowerCase());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  await dbConnect();
  const user = await getUserByEmail(email);

  // If admin is comped, ensure DB reflects hasAI=true (idempotent).
  if (user && isAdminFree(email) && !user.hasAI) {
    await User.updateOne({ email }, { $set: { hasAI: true } });
    user.hasAI = true as any;
  }

  const aiCalls = CALL_AI_SUMMARY_ENABLED && (Boolean(user?.hasAI) || isAdminFree(email));

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ aiCalls });
}
