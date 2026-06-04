import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import { runMetaUsageWarmup } from "@/lib/meta/metaHealth";

const CRON_SECRET = String(process.env.CRON_SECRET || "").trim();

function authorizedCron(req: NextApiRequest) {
  if (!CRON_SECRET) return false;
  const header = String(req.headers["x-cron-key"] || req.headers["authorization"] || "");
  const token = header.replace(/^Bearer\s+/i, "");
  const query = String(req.query.key || "");
  return token === CRON_SECRET || query === CRON_SECRET;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!authorizedCron(req)) {
    const session = await getServerSession(req, res, authOptions);
    if (!isExperimentalAdminEmail(session?.user?.email)) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const result = await runMetaUsageWarmup();
  return res.status(200).json({
    ok: true,
    mode: "read_only",
    writes: 0,
    spend: 0,
    ...result,
  });
}
