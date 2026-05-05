// pages/api/admin/doi-agents.ts
// Admin-only endpoint to inspect DOI agents and rejection reasons.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import DOIAgent from "@/models/DOIAgent";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";
const PAGE_SIZE = 50;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email || session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await mongooseConnect();

  const page = Math.max(1, Number(req.query.page) || 1);
  const stage = req.query.stage ? String(req.query.stage) : "";
  const status = req.query.status ? String(req.query.status) : "";
  const reason = req.query.reason ? String(req.query.reason) : "";
  const reviewNeeded = req.query.reviewNeeded === "true";
  const search = req.query.search ? String(req.query.search).trim() : "";
  const view = req.query.view ? String(req.query.view) : "";
  const threshold = Number(req.query.threshold) || 60;

  const filter: Record<string, any> = {};
  if (stage) filter.pipelineStage = stage;
  if (status) filter.enrichmentStatus = status;
  if (reason) filter.rejectionReasons = reason;
  if (reviewNeeded) filter.reviewNeeded = true;

  switch (view) {
    case "without-domain":
      filter.agencyDomain = "";
      break;
    case "low-identity":
      filter.identityScore = { $lt: threshold };
      break;
    case "ready-email":
      filter.agencyDomain = { $ne: "" };
      filter.enrichmentStatus = { $ne: "enriched" };
      filter.reviewNeeded = { $ne: true };
      break;
    case "promoted":
      filter.enrichmentStatus = "enriched";
      break;
    case "rejections":
      filter.rejectionReasons = { $exists: true, $ne: [] };
      break;
    default:
      break;
  }
  if (search) {
    filter.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { licenseNumber: { $regex: search, $options: "i" } },
      { agencyDomain: { $regex: search, $options: "i" } },
    ];
  }

  const [agents, total, failedCount, reviewCount, withoutDomain, lowIdentity, readyEmail, promotedCount, rejectionCount] =
    await Promise.all([
      DOIAgent.find(filter)
        .select(
          "firstName lastName state city agencyName agencyDomain domainTrustLevel enrichmentStatus pipelineStage attempts stuckReason lastCheckedAt lastRejectionReason rejectionReasons reviewNeeded updatedAt notes identityScore identityConfidence searchResultCount"
        )
        .sort({ updatedAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      DOIAgent.countDocuments(filter),
      DOIAgent.countDocuments({ enrichmentStatus: "failed" }),
      DOIAgent.countDocuments({ reviewNeeded: true }),
      DOIAgent.countDocuments({ agencyDomain: "" }),
      DOIAgent.countDocuments({ identityScore: { $lt: threshold } }),
      DOIAgent.countDocuments({
        agencyDomain: { $ne: "" },
        enrichmentStatus: { $ne: "enriched" },
        reviewNeeded: { $ne: true },
      }),
      DOIAgent.countDocuments({ enrichmentStatus: "enriched" }),
      DOIAgent.countDocuments({ rejectionReasons: { $exists: true, $ne: [] } }),
    ]);

  return res.status(200).json({
    agents,
    total,
    page,
    pages: Math.ceil(total / PAGE_SIZE),
    stats: {
      failed: failedCount,
      reviewNeeded: reviewCount,
      withoutDomain,
      lowIdentity,
      readyForEmail: readyEmail,
      promoted: promotedCount,
      rejectionBuckets: rejectionCount,
    },
    view,
  });
}
