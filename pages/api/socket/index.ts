// /pages/api/socket/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getIO } from "@/lib/socket";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Initialize or reuse the server singleton and confirm the route.
    // @ts-expect-error - we intentionally pass Next's res for initialization
    getIO(res as any);
    res.status(200).json({ ok: true, route: "/api/socket/", ts: Date.now() });
  } catch (e) {
    console.error("Socket init error:", e);
    res.status(500).json({ ok: false, error: "socket_init_failed" });
  }
}

export const config = { api: { bodyParser: false } };
