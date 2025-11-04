// /pages/api/socket/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

export const config = {
  api: {
    bodyParser: false, // keep raw for socket handshake
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Initialize (idempotent)
  initSocket(res as any);
  // Health check for GETs in logs/Network tab
  if (req.method === "GET") {
    res.status(200).json({ ok: true, route: "/api/socket/", ts: Date.now() });
    return;
  }
  // Socket.IO will hijack the underlying socket; still return 200 for non-GET
  res.status(200).end();
}
