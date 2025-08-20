// /pages/api/debug/set-billing-mode.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const OWNER_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const email = session.user.email.toLowerCase();

  // Only allow a user to set their own mode, and only to "self" if they are the owner
  const { billingMode } = (req.body || {}) as { billingMode?: "platform" | "self" };
  if (!billingMode) return res.status(400).json({ error: "Missing billingMode" });
  if (billingMode === "self" && email !== OWNER_EMAIL) {
    return res.status(403).json({ error: "Not allowed to set self billing" });
  }

  try {
    await dbConnect();
    await User.updateOne({ email }, { $set: { billingMode } });
    res.status(200).json({ ok: true, email, billingMode });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "set-billing-mode failed" });
  }
}
