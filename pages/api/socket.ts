import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (res.socket?.server?.io) {
    // ✅ Already initialized
    res.end();
    return;
  }

  console.log("✅ Initializing Socket.io server...");
  initSocket(res as any);
  res.end();
}
