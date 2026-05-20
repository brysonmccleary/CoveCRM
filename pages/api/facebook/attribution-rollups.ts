import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { buildFacebookAttributionRollups } from "@/lib/analytics/facebookAttributionRollups";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = String(session?.user?.email || "").trim().toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = await buildFacebookAttributionRollups(userEmail);
    return res.status(200).json(payload);
  } catch (err: any) {
    console.error("[facebook/attribution-rollups] error:", err?.message || err);
    return res.status(500).json({ error: "Failed to build attribution rollups" });
  }
}

