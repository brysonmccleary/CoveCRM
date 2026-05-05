// pages/api/admin/doi-domain-stats.ts
// Admin endpoint exposing domain-level email pattern intelligence.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import DomainEmailPattern from "@/models/DomainEmailPattern";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email || session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await mongooseConnect();

  const docs = await DomainEmailPattern.find({})
    .sort({ domain: 1 })
    .lean();

  type SummaryEntry = {
    domain: string;
    bestPattern: string;
    catchAll: boolean;
    totalSuccess: number;
    totalFailure: number;
    bestRate: number;
  };

  const summaryMap = new Map<string, SummaryEntry>();

  docs.forEach((doc) => {
    if (!doc.domain) return;
    const total = doc.successCount + doc.failureCount;
    const rate = total ? doc.successCount / total : 0;
    const key = doc.domain;
    const existing =
      summaryMap.get(key) ||
      ({
        domain: key,
        bestPattern: "",
        bestRate: -1,
        catchAll: false,
        totalSuccess: 0,
        totalFailure: 0,
      } as SummaryEntry);

    existing.totalSuccess += doc.successCount;
    existing.totalFailure += doc.failureCount;
    if (doc.catchAll) existing.catchAll = true;
    if (rate > existing.bestRate) {
      existing.bestRate = rate;
      existing.bestPattern = doc.pattern;
    }
    summaryMap.set(key, existing);
  });

  const domains = Array.from(summaryMap.values()).map((entry) => ({
    domain: entry.domain,
    bestPattern: entry.bestPattern,
    successRate: Math.round(Math.max(entry.bestRate, 0) * 100) / 100,
    catchAll: entry.catchAll,
    totalSuccess: entry.totalSuccess,
    totalFailure: entry.totalFailure,
  }));

  const catchAllDomains = domains.filter((d) => d.catchAll).map((d) => d.domain);
  const avoidDomains = domains
    .filter((d) => d.totalFailure > d.totalSuccess && d.totalSuccess + d.totalFailure >= 3)
    .map((d) => d.domain);

  return res.status(200).json({
    domains,
    catchAllDomains,
    avoidDomains,
  });
}
