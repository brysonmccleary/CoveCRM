// pages/api/email/campaigns/[id].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import EmailCampaign from "@/models/EmailCampaign";

const ALLOWED_UPDATE_FIELDS = [
  "name",
  "fromName",
  "fromEmail",
  "replyTo",
  "dailyLimit",
  "steps",
  "isActive",
] as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();
  const { id } = req.query;

  await mongooseConnect();

  if (req.method === "GET") {
    const campaign = await EmailCampaign.findOne({ _id: id, userEmail }).lean();
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    return res.status(200).json(campaign);
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    const update: Record<string, any> = {};
    for (const key of ALLOWED_UPDATE_FIELDS) {
      if (req.body?.[key] !== undefined) update[key] = req.body[key];
    }

    const updated = await EmailCampaign.findOneAndUpdate(
      { _id: id, userEmail },
      { $set: update },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: "Campaign not found" });
    return res.status(200).json(updated);
  }

  if (req.method === "DELETE") {
    const deleted = await EmailCampaign.findOneAndDelete({
      _id: id,
      userEmail,
    }).lean();
    if (!deleted) return res.status(404).json({ error: "Campaign not found" });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
