// /pages/api/socket/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

/**
 * Keep body parsing off so Engine.IO can upgrade cleanly.
 */
export const config = {
  api: { bodyParser: false },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Initialize or reuse the Socket.IO server instance.
  initSocket(res as any);

  // If this is an Engine.IO/WebSocket request, DO NOT write a JSON response.
  // Let Socket.IO/Engine.IO own the connection/upgrade lifecycle.
  const isWsUpgrade = (req.headers.upgrade || "").toLowerCase() === "websocket";
  const isEngineIo = (req.url || "").includes("EIO=");

  if (isWsUpgrade || isEngineIo) {
    // Hand off to the Socket.IO server; just end without a body.
    res.end();
    return;
  }

  // Health check for plain HTTP GETs to /api/socket
  res.status(200).json({ ok: true, route: "/api/socket/", ts: Date.now() });
}
