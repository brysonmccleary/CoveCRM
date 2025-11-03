import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

export const config = {
  api: { bodyParser: false },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Ensure Socket.IO is attached at /api/socket/ (with trailing slash)
  // @ts-ignore - Next augments res.socket
  initSocket(res as any);

  // Engine.IO requests include EIO=... and will be handled by socket.io.
  if (!req.url?.includes("EIO=")) {
    res.status(200).end();
  }
}
