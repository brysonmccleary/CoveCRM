import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDeepSeekEnvDiagnostics } from "@/lib/ai/providers/deepseekProvider";
import { getKimiEnvDiagnostics } from "@/lib/ai/providers/kimiProvider";
import { getOpenAIEnvDiagnostics } from "@/lib/ai/providers/openaiProvider";
import { isAdminAiDevBypassAllowed } from "@/lib/admin-ai/devAuth";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (!isAdminAiDevBypassAllowed(req)) {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    const userEmail = String(session?.user?.email || "").toLowerCase();
    if (!userEmail) return res.status(401).json({ error: "Unauthorized" });
    if (userEmail !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
  }

  return res.status(200).json({
    ok: true,
    openai: getOpenAIEnvDiagnostics(),
    kimi: getKimiEnvDiagnostics(),
    deepseek: getDeepSeekEnvDiagnostics(),
  });
}
