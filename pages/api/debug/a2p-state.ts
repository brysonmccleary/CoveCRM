// /pages/api/debug/a2p-state.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

/**
 * GET /api/debug/a2p-state?email=...&token=CRON_SECRET
 * - If token matches CRON_SECRET, no session required (for CLI checks).
 * - Otherwise requires a logged-in session (returns only current user's info).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = typeof req.query.token === "string" ? req.query.token : "";
  const usingToken = token && token === process.env.CRON_SECRET;

  const session = await getServerSession(req, res, authOptions);
  const sessionEmail = session?.user?.email?.toLowerCase();

  const queryEmail = String(req.query.email || "").toLowerCase();

  if (!usingToken && !sessionEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const email = usingToken ? (queryEmail || sessionEmail) : sessionEmail;
  if (!email) return res.status(400).json({ error: "Missing email" });

  try {
    await dbConnect();
    const user = await User.findOne({ email }).lean<any>();
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.status(200).json({
      email,
      a2p: user.a2p || null,
      numbersCount: Array.isArray(user.numbers) ? user.numbers.length : 0,
      msFromNumbers: (user.numbers || []).map((n: any) => n.messagingServiceSid).filter(Boolean),
      updatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "lookup failed" });
  }
}
