// pages/api/settings/ai-settings.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AISettings from "@/models/AISettings";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  if (req.method === "GET") {
    const settings = await AISettings.findOne({ userEmail: email }).lean();
    return res.status(200).json({ settings: settings || {} });
  }

  if (req.method === "POST") {
    const user = await User.findOne({ email }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    const allowed = [
      "aiTextingEnabled",
      "aiNewLeadCallEnabled",
      "aiDialSessionEnabled",
      "aiCallOverviewEnabled",
      "aiCallCoachingEnabled",
      "liveTransferEnabled",
      "liveTransferPhone",
      "newLeadCallDelayMinutes",
      "businessHoursOnly",
      "businessHoursStart",
      "businessHoursEnd",
      "businessHoursTimezone",
    ];

    const update: Record<string, any> = {};
    for (const key of allowed) {
      if (key in req.body) update[key] = req.body[key];
    }

    const settings = await AISettings.findOneAndUpdate(
      { userEmail: email },
      {
        $set: update,
        $setOnInsert: { userId: (user as any)._id, userEmail: email },
      },
      { upsert: true, new: true }
    ).lean();

    return res.status(200).json({ ok: true, settings });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
