import type { NextApiRequest, NextApiResponse } from "next";
import { authenticateCompanion } from "@/lib/recruiting/companion/auth";
import { JOB_LEASE_MS } from "@/lib/recruiting/companion/security";
import RecruitingDiscoveryJob from "@/models/RecruitingDiscoveryJob";
import RecruitingPlatformSession from "@/models/RecruitingPlatformSession";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const companion = await authenticateCompanion(req);
  if (!companion) return res.status(401).json({ error: "Invalid companion token." });
  if (companion.paused) return res.status(200).json({ job: null, state: "paused" });
  const loggedOutPlatforms = await RecruitingPlatformSession.find({ companionId: companion._id, status: "logged_out" }).distinct("platform");
  const availablePlatforms = companion.allowedPlatforms.filter((platform) => !loggedOutPlatforms.includes(platform));
  const now = new Date();
  const job = await RecruitingDiscoveryJob.findOneAndUpdate(
    {
      companionId: companion._id,
      platform: { $in: availablePlatforms },
      availableAt: { $lte: now },
      $or: [{ status: "queued" }, { status: "claimed", leaseExpiresAt: { $lt: now } }],
    },
    {
      $set: { status: "claimed", claimedAt: now, leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS) },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { availableAt: 1 } },
  ).lean() as any;
  if (!job) return res.status(200).json({ job: null, state: "idle" });
  return res.status(200).json({
    state: "claimed",
    job: {
      id: job._id,
      platform: job.platform,
      searchQuery: job.searchQuery,
      maxCandidates: job.maxCandidatesPerScan,
      leaseExpiresAt: job.leaseExpiresAt,
    },
  });
}
