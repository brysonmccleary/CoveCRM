// /pages/api/socket/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

export const config = { api: { bodyParser: false } };

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  initSocket(res as any);

  const isWsUpgrade = (req.headers.upgrade || "").toLowerCase() === "websocket";
  const isEngineIo = (req.url || "").includes("EIO=");

  if (isWsUpgrade || isEngineIo) { res.end(); return; }

  res.status(200).json({ ok: true, route: "/api/socket", ts: Date.now() });
}
