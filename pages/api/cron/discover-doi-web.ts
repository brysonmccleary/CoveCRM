// pages/api/cron/discover-doi-web.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import { discoverAgentWebPresence } from "@/scripts/discover-agent-web-presence";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  try {
    const summary = await discoverAgentWebPresence();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/discover-doi-web] Fatal error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Discovery failed" });
  }
}
