import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

// Keep parity with ws upgrades
export const config = {
  api: { bodyParser: false },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Ensure Socket.IO is attached at /api/socket/ (with trailing slash)
  // This route only initializes the server and serves the handshake.
  // No dialer behavior is affected here.
  // @ts-ignore - Next augments res.socket
  initSocket(res as any);
  res.end();
}
