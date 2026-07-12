import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "../../../models/FBLeadCampaign";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";

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
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
    if (typeof session?.user?.id === "string" && session.user.id.trim()) {
      userId = session.user.id;
    }
  } catch (e) {}

  if (!userId) {
    return zeroStats(res);
  }

  // NOTE: this previously queried AdMetricsDaily/CRMOutcome by `metaCampaignId` — a field that
  // doesn't exist on either model (both are keyed by `campaignId`, the FBLeadCampaign ObjectId),
  // so those queries always matched zero documents. It also summed CRMOutcome.revenue, a flat
  // per-lead-type ESTIMATE (see REVENUE_BY_LEAD_TYPE in trackCRMOutcome.ts), not real commission
  // revenue. FBLeadCampaign already carries correctly-aggregated lifetime totals (totalSpend/
  // totalLeads, from syncAdInsights.ts) and real agent-entered revenue (totalGrossRevenue, from
  // scoreAdPerformance.ts) — summing directly from the campaign documents is both correct and
  // matches the ROAS calculation already used on the facebook-leads dashboard.
  const campaigns = await FBLeadCampaign.find({ userId }).lean();
  if (!campaigns.length) {
    return zeroStats(res);
  }

  let spend = 0;
  let leads = 0;
  let booked = 0;
  let sold = 0;
  let revenue = 0;

  for (const c of campaigns as any[]) {
    spend += Number(c?.totalSpend || 0);
    leads += Number(c?.totalLeads || 0);
    booked += Number(c?.appointments || 0);
    sold += Number(c?.sales || 0);
    revenue += Number(c?.totalGrossRevenue || 0);
  }

  const cpl = leads > 0 ? spend / leads : 0;
  const roas = spend > 0 && revenue > 0 ? revenue / spend : 0;
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
