import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isAdmin } from "@/lib/featureFlags";
import { extractLeadMemory } from "@/lib/ai/memory/memoryExtractor";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const userEmail = session?.user?.email || "";
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });
  if (!isAdmin(userEmail)) return res.status(403).json({ error: "Forbidden" });

  const { leadId, text, sourceType, sourceEventId } = req.body || {};
  if (!leadId || !text || !sourceType) {
    return res.status(400).json({ error: "Missing leadId, text, or sourceType" });
  }

  const facts = await extractLeadMemory(userEmail, String(leadId), String(text), String(sourceType), sourceEventId);
  return res.status(200).json({ ok: true, facts });
}
