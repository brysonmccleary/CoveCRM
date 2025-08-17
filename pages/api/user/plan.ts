// /pages/api/user/plan.ts
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });

  if (!user) return res.status(404).json({ error: "User not found" });

  return res.status(200).json({
    plan: user.plan,
    hasAI: user.hasAI,
  });
}
