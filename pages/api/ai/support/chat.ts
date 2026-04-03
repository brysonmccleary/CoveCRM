import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { runHelpAssistant } from "@/lib/ai/support/helpAssistant";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const userEmail = String(session?.user?.email || "").toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  const { message, conversationId, pageContext } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing message" });

  const result = await runHelpAssistant({
    userEmail,
    content: String(message),
    conversationId: conversationId ? String(conversationId) : undefined,
    pageContext: pageContext ? String(pageContext) : undefined,
  });
  return res.status(200).json({ ok: true, ...result });
}
