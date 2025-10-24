import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const url = new URL(req.headers["x-forwarded-proto"] + "://" + (req.headers.host || "localhost") + req.url);
  const headerToken = req.headers["x-cron-key"] || req.headers["x-cron-key".toLowerCase()];
  const isVercelCron = Boolean(req.headers["x-vercel-cron"]);
  const token = url.searchParams.get("token");
  const secret = process.env.CRON_SECRET || "";

  res.status(200).json({
    path: url.pathname,
    queryTokenPresent: token != null,
    queryTokenLen: token ? token.length : 0,
    headerTokenPresent: Boolean(headerToken),
    headerTokenLen: headerToken ? String(headerToken).length : 0,
    vercelCronHeader: isVercelCron,
    secretLenServer: secret.length,
    note: "This just echoes what the server sees; middleware must allow this route to reach here."
  });
}
