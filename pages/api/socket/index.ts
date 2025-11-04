// /pages/api/socket/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

/** Force Node runtime and disable body parsing so Engine.IO can upgrade cleanly on Vercel. */
export const config = {
  api: { bodyParser: false },
  runtime: "nodejs",
} as const;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Initialize or reuse the Socket.IO server instance.
  initSocket(res as any);
  // Health OK. Engine.IO endpoints are served behind this path automatically.
  res.status(200).json({ ok: true, route: "/api/socket/", ts: Date.now() });
}
