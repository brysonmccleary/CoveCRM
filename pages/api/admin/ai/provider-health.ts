import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getDeepSeekProviderHealth } from "@/lib/ai/providers/deepseekProvider";
import { getKimiProviderHealth } from "@/lib/ai/providers/kimiProvider";
import { callOpenAIChatProvider, getOpenAIProviderHealth } from "@/lib/ai/providers/openaiProvider";
import { isSupportAiRouterEnabled } from "@/lib/ai/support/supportAiRouter";
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

  const body: any = {
    ok: true,
    providers: {
      openai: getOpenAIProviderHealth(),
      kimi: getKimiProviderHealth(),
      deepseek: getDeepSeekProviderHealth(),
    },
    routerEnabled: isSupportAiRouterEnabled(),
  };

  if (String(req.query.test || "").toLowerCase() === "openai") {
    const result = await callOpenAIChatProvider({
      messages: [
        { role: "system", content: "You are a connectivity test. Reply with ok only." },
        { role: "user", content: "respond ok" },
      ],
      temperature: 0,
      maxTokens: 8,
    });
    body.tests = {
      openai: {
        ok: result.ok,
        status: result.status || null,
        model: result.model || null,
        errorCode: result.errorCode || null,
        error: result.ok ? null : result.error || "provider_error",
      },
    };
  }

  return res.status(200).json(body);
}
