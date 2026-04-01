import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "../../../models/FBLeadCampaign";
import AdMetricsDaily from "../../../models/AdMetricsDaily";
import CRMOutcome from "../../../models/CRMOutcome";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";

function zeroStats(res: NextApiResponse) {
  return res.status(200).json({
    spend: 0,
    leads: 0,
    booked: 0,
    sold: 0,
    revenue: 0,
    cpl: 0,
    roas: 0,
    costPerSale: 0,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();

  let userId: string | null = null;

  try {
    const session = await getServerSession(req, res, authOptions);
    if (typeof session?.user?.id === "string" && session.user.id.trim()) {
      userId = session.user.id;
    }
  } catch (e) {}

  if (typeof req.query.userId === "string" && req.query.userId.trim()) {
    userId = req.query.userId;
  }

  if (!userId) {
    return zeroStats(res);
  }

  const campaigns = await FBLeadCampaign.find({ userId }).lean();
  const campaignIds = campaigns.map((c: any) => c.metaCampaignId).filter(Boolean);

  if (!campaignIds.length) {
    return zeroStats(res);
  }

  const metrics = await AdMetricsDaily.find({
    metaCampaignId: { $in: campaignIds },
  }).lean();

  const outcomes = await CRMOutcome.find({
    metaCampaignId: { $in: campaignIds },
  }).lean();

  let spend = 0;
  let leads = 0;
  let booked = 0;
  let sold = 0;
  let revenue = 0;

  for (const m of metrics as any[]) {
    spend += Number(m?.spend || 0);
    leads += Number(m?.leads || 0);
  }

  for (const o of outcomes as any[]) {
    booked += Number(o?.booked || 0);
    sold += Number(o?.sold || 0);
    revenue += Number(o?.revenue || 0);
  }

  const cpl = leads > 0 ? spend / leads : 0;
  const roas = spend > 0 ? revenue / spend : 0;
  const costPerSale = sold > 0 ? spend / sold : 0;

  return res.status(200).json({
    spend,
    leads,
    booked,
    sold,
    revenue,
    cpl,
    roas,
    costPerSale,
  });
}
