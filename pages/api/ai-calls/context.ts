// pages/api/ai-calls/context.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buildAICallContext, AICallContext } from "@/lib/ai/aiCallContext";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY;

type ResponseBody =
  | { ok: true; context: AICallContext }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const key =
      (req.query.key as string) ||
      (req.headers["x-ai-dialer-key"] as string) ||
      "";

    if (!AI_DIALER_CRON_KEY || key !== AI_DIALER_CRON_KEY) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { sessionId, leadId } = req.query as {
      sessionId?: string;
      leadId?: string;
    };

    if (!sessionId || !leadId) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing sessionId or leadId" });
    }

    const context = await buildAICallContext(sessionId, leadId);

    return res.status(200).json({ ok: true, context });
  } catch (err: any) {
    console.error("[AI-CALLS][CONTEXT] Error:", err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Internal server error" });
  }
}
