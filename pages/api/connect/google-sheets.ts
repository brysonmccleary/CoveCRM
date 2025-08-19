// /pages/api/connect/google-sheets.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return res.redirect(302, "/api/google-auth/start?target=sheets");
}
