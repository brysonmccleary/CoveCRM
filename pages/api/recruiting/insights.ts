import type { NextApiRequest, NextApiResponse } from "next";
import { DateTime } from "luxon";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { RECRUITING_PUBLIC_MESSAGES } from "@/lib/recruiting/public-errors";
import RecruitingCloudAccount from "@/models/RecruitingCloudAccount";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";
import RecruitingProspect from "@/models/RecruitingProspect";
import RecruitingGrowthSnapshot from "@/models/RecruitingGrowthSnapshot";

const ACTIONS = ["like_post", "like_story", "follow", "connect", "dm"] as const;
const SAFETY_SKIP_CODES = ["already_following", "follows_you", "prior_conversation"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  res.setHeader("Cache-Control", "private, no-store");
  try {
    await mongooseConnect();
    const range = ["today", "7d", "30d", "all"].includes(String(req.query.range)) ? String(req.query.range) : "30d";
    const platform = ["instagram", "linkedin"].includes(String(req.query.platform)) ? String(req.query.platform) : "all";
    const account = await RecruitingCloudAccount.findOne({ ownerEmail: admin.email, status: { $ne: "canceled" } }).select("timeZone").lean();
    const zone = String(account?.timeZone || "America/Phoenix");
    const now = DateTime.now().setZone(zone);
    const start = range === "today" ? now.startOf("day")
      : range === "7d" ? now.startOf("day").minus({ days: 6 })
      : range === "30d" ? now.startOf("day").minus({ days: 29 })
      : DateTime.fromMillis(0, { zone });
    const baseMatch: Record<string, unknown> = {
      ownerEmail: admin.email,
      completedAt: { $gte: start.toUTC().toJSDate() },
      ...(platform === "all" ? {} : { platform }),
    };
    const [successfulGroups, dailyGroups, skippedGroups, replies, growthSnapshots] = await Promise.all([
      RecruitingCompanionJob.aggregate([
        { $match: { ...baseMatch, status: "succeeded" } },
        { $group: { _id: { platform: "$platform", actionType: "$actionType" }, count: { $sum: 1 } } },
      ]),
      RecruitingCompanionJob.aggregate([
        { $match: { ...baseMatch, status: "succeeded" } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$completedAt", timezone: zone } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      RecruitingCompanionJob.aggregate([
        { $match: { ...baseMatch, status: "skipped", failureCode: { $in: SAFETY_SKIP_CODES } } },
        { $group: { _id: "$failureCode", count: { $sum: 1 } } },
      ]),
      RecruitingProspect.countDocuments({
        ownerEmail: admin.email,
        status: "responded",
        updatedAt: { $gte: start.toUTC().toJSDate() },
        ...(platform === "all" ? {} : { platform }),
      }),
      RecruitingGrowthSnapshot.find({ ownerEmail: admin.email, capturedAt: { $gte: start.toUTC().toJSDate() }, ...(platform === "all" ? {} : { platform }) }).sort({ capturedAt: 1 }).lean(),
    ]);
    const count = (actionType: typeof ACTIONS[number], selectedPlatform?: string) => successfulGroups
      .filter((row) => row._id.actionType === actionType && (!selectedPlatform || row._id.platform === selectedPlatform))
      .reduce((sum, row) => sum + row.count, 0);
    const totalFor = (selectedPlatform?: string) => ACTIONS.reduce((sum, action) => sum + count(action, selectedPlatform), 0);
    const dmsSent = count("dm");
    const safetySkips = skippedGroups.reduce((sum, row) => sum + row.count, 0);
    const growthFor = (selectedPlatform: "instagram" | "linkedin") => {
      const values = growthSnapshots.filter((snapshot) => snapshot.platform === selectedPlatform);
      const field = selectedPlatform === "instagram" ? "followerCount" : "connectionCount";
      const usable = values.filter((snapshot) => typeof snapshot[field] === "number");
      if (!usable.length) return null;
      const starting = Number(usable[0][field]);
      const current = Number(usable[usable.length - 1][field]);
      return { starting, current, netGrowth: current - starting };
    };
    const instagramGrowth = growthFor("instagram");
    const linkedinGrowth = growthFor("linkedin");
    return res.status(200).json({
      range,
      platform,
      timeZone: zone,
      totals: {
        targetedInteractions: totalFor(),
        postLikes: count("like_post"),
        storyLikes: count("like_story"),
        follows: count("follow"),
        connections: count("connect"),
        dmsSent,
        replies,
        responseRate: dmsSent ? Number(((replies / dmsSent) * 100).toFixed(1)) : 0,
        safetySkips,
      },
      platforms: {
        instagram: { targetedInteractions: totalFor("instagram"), dmsSent: count("dm", "instagram") },
        linkedin: { targetedInteractions: totalFor("linkedin"), dmsSent: count("dm", "linkedin") },
      },
      daily: dailyGroups.map((row) => ({ date: row._id, targetedInteractions: row.count })),
      growth: {
        instagram: instagramGrowth,
        linkedin: linkedinGrowth,
        note: instagramGrowth || linkedinGrowth ? "Growth is shown separately because not every new follower or connection can be attributed directly to CoveCRM." : "Follower and connection growth begins after the first connected-account baseline is captured.",
      },
    });
  } catch {
    return res.status(503).json({ code: "CAMPAIGN_LOAD_FAILED", error: RECRUITING_PUBLIC_MESSAGES.CAMPAIGN_LOAD_FAILED });
  }
}
