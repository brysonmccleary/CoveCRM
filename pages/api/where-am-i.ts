import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("X-Proof", "where-am-i");
  res.status(200).json({
    ok: true,
    file: "/pages/api/where-am-i.ts",
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 12),
    region: process.env.VERCEL_REGION || "local",
    project: process.env.VERCEL_PROJECT_PRODUCTION_URL || "(unknown)",
    time: new Date().toISOString(),
  });
}
