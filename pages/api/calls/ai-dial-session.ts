// pages/api/calls/ai-dial-session.ts
// POST — Start an AI dial session through the voice server
//
// Core logic lives in lib/ai/dialSession/startAiDialSession.ts so it can be
// reused by the assistant's start_dial_session tool without an internal
// self-HTTP call. This handler is now a thin auth + response wrapper.

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { startAiDialSession } from "@/lib/ai/dialSession/startAiDialSession";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const { leadIds, scriptKey } = req.body as {
    leadIds?: string[];
    scriptKey?: string;
  };

  const result = await startAiDialSession({ email, leadIds: leadIds || [], scriptKey });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(200).json({
    ok: true,
    sessionId: result.sessionId,
    totalLeads: result.totalLeads,
    message: result.message,
  });
}
