
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import dbConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "../../../models/FBLeadCampaign";
import AdMetricsDaily from "../../../models/AdMetricsDaily";
import CRMOutcome from "../../../models/CRMOutcome";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  const campaigns = await FBLeadCampaign.find({ userEmail: email }).lean();

  const results = [];

  for (const c of campaigns) {
    const metrics = await AdMetricsDaily.find({
      campaignId: c._id,
      userEmail: email,
      metaCampaignId: c.metaCampaignId,
    }).lean();

    const outcomes = await CRMOutcome.find({
      campaignId: c._id,
      userEmail: email,
      metaCampaignId: c.metaCampaignId,
    }).lean();

    let spend = 0;
    let leads = 0;
    let booked = 0;
    let sold = 0;
    let revenue = 0;

    for (const m of metrics) {
      spend += m.spend || 0;
      leads += m.leads || 0;
    }

    for (const o of outcomes) {
      booked += o.appointmentsBooked || 0;
      sold += o.sales || 0;
      revenue += o.revenue || 0;
    }

    results.push({
      campaign: c.campaignName,
      spend,
      leads,
      booked,
      sold,
      revenue,
      cpl: leads ? spend / leads : 0,
      roas: spend ? revenue / spend : 0
    });
  }

  return res.status(200).json(results);
}
