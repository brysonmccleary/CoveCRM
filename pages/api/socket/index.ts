// /pages/api/socket/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

/**
 * For pages/api routes, keep config simple and DO NOT use `as const` or `runtime` here.
 * We only need bodyParser disabled so Engine.IO can upgrade cleanly.
 */
export const config = {
  api: { bodyParser: false },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Initialize or reuse the Socket.IO server instance.
  initSocket(res as any);
  // Health OK. Engine.IO endpoints are served behind this path automatically.
  res.status(200).json({ ok: true, route: "/api/socket/", ts: Date.now() });
}
