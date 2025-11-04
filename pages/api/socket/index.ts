import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

// Keep bodyParser off for long-polling requests
export const config = {
  api: { bodyParser: false },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Initialize (idempotent). This attaches io to the underlying server.
  initSocket(res as any);
  // Return a tiny OK so /api/socket/ is a valid GET for health checks.
  if (req.method === "GET") {
    return res.status(200).json({ ok: true });
  }
  return res.status(200).end();
}
