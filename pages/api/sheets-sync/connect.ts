// /pages/api/sheets-sync/connect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "../sheets/connect";

// Simple alias route so existing UI continues working.
// Keeps behavior identical to /api/sheets/connect
export default async function connectAlias(req: NextApiRequest, res: NextApiResponse) {
  return handler(req, res);
}
