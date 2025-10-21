import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import DripEnrollment from "@/models/DripEnrollment";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const email = String(session?.user?.email || "").toLowerCase();
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const leadId = String(req.query.leadId || "");
  if (!leadId) return res.status(400).json({ error: "Missing leadId" });

  await mongooseConnect();

  // fetch active/paused enrollments for this tenant + lead
  const enrollments = await DripEnrollment.find({
    userEmail: email,
    leadId,
    status: { $in: ["active", "paused"] },
  })
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  // optional: try to resolve campaign names if your model exists
  let nameMap: Record<string, string> = {};
  try {
    const DripCampaign = (await import("@/models/DripCampaign")).default as any;
    const ids = Array.from(new Set(enrollments.map((e) => String(e.campaignId))));
    if (ids.length) {
      const camps = await DripCampaign.find({ _id: { $in: ids } }, { name: 1 }).lean();
      nameMap = Object.fromEntries(camps.map((c: any) => [String(c._id), c.name || "Campaign"]));
    }
  } catch {
    // if DripCampaign model not present, just return IDs
  }

  const items = enrollments.map((e: any) => ({
    _id: String(e._id),
    campaignId: String(e.campaignId),
    campaignName: nameMap[String(e.campaignId)] || String(e.campaignId),
    status: e.status,
    nextSendAt: e.nextSendAt || null,
    startedAt: e.startedAt || null,
  }));

  res.status(200).json({ success: true, items });
}
