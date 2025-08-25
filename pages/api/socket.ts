// /pages/api/socket.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { initSocket } from "@/lib/socket";

export const config = { api: { bodyParser: false } };

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  initSocket(res as any); // idempotent boot on /api/socket
  res.status(200).end("ok");
}
