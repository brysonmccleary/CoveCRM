import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { buildSupportContext } from "@/lib/ai/support/supportContext";
import { ensureSupportKnowledgeSeeded } from "@/lib/ai/support/seedSupportKnowledge";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const userEmail = String(session?.user?.email || "").toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  await ensureSupportKnowledgeSeeded();
  const context = await buildSupportContext(userEmail);
  return res.status(200).json({ ok: true, context });
}
