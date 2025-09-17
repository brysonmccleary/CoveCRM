import type { NextApiRequest, NextApiResponse } from "next";
export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("X-Import-Trace", "v2-proof");
  res.status(200).json({
    ok: true,
    route: "/api/import-leads-v2",
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0,12),
    region: process.env.VERCEL_REGION || "local",
    note: "If you can see this in prod, the request is hitting this route (not the old one).",
  });
}
