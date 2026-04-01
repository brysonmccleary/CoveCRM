import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "../../../models/FBLeadCampaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();

  const campaigns = await FBLeadCampaign.find({}).lean();
  const recommendations: any[] = [];

  for (const c of campaigns) {
    const name = (c as any).campaignName || "Campaign";
    const score = (c as any).performanceScore;
    const pClass = (c as any).performanceClass;
    const cpl = (c as any).cpl || 0;
    const targetCpl = (c as any).targetCpl || 0;
    const frequency = (c as any).frequency || 0;
    const optOutRate = (c as any).optOutRate || 0;
    const badNumberRate = (c as any).badNumberRate || 0;
    const totalLeads = (c as any).totalLeads || 0;
    const totalSpend = (c as any).totalSpend || 0;

    if (!pClass || score === null || score === undefined) {
      recommendations.push({
        type: "setup",
        campaign: name,
        message: "Campaign has not been scored yet. Sync Meta insights && start tracking CRM outcomes before optimizing."
      });
      continue;
    }

    if (pClass === "SCALE") {
      recommendations.push({
        type: "scale",
        campaign: name,
        message: `Strong performance score (${score}). Consider increasing budget carefully && monitoring lead quality.`
      });
    }

    if (pClass === "DUPLICATE_TEST") {
      recommendations.push({
        type: "test",
        campaign: name,
        message: `Campaign is performing well (${score}) but not at full scale confidence. Duplicate && test new creative or audience variations.`
      });
    }

    if (pClass === "MONITOR") {
      recommendations.push({
        type: "monitor",
        campaign: name,
        message: `Campaign is stable (${score}) but not strong enough to scale yet. Keep monitoring before making major changes.`
      });
    }

    if (pClass === "FIX") {
      recommendations.push({
        type: "fix",
        campaign: name,
        message: `Campaign performance is weak (${score}). Refresh creative, tighten targeting, && review lead quality.`
      });
    }

    if (pClass === "PAUSE") {
      recommendations.push({
        type: "pause",
        campaign: name,
        message: `Campaign is underperforming badly (${score}). Consider pausing && rebuilding the offer, creative, or targeting.`
      });
    }

    if (targetCpl > 0 && cpl > targetCpl) {
      recommendations.push({
        type: "cpl",
        campaign: name,
        message: `CPL is above target ($${cpl.toFixed(2)} vs target $${targetCpl.toFixed(2)}). Test new hooks, audiences, or ad creative.`
      });
    }

    if (frequency > 3) {
      recommendations.push({
        type: "frequency",
        campaign: name,
        message: `Frequency is elevated (${frequency.toFixed(2)}). Creative fatigue is likely, so rotate new ads soon.`
      });
    }

    if (optOutRate > 5) {
      recommendations.push({
        type: "optout",
        campaign: name,
        message: `Opt-out rate is high (${optOutRate.toFixed(2)}%). Messaging may be attracting low-intent leads or setting poor expectations.`
      });
    }

    if (badNumberRate > 15) {
      recommendations.push({
        type: "bad_number",
        campaign: name,
        message: `Bad number rate is high (${badNumberRate.toFixed(2)}%). Targeting or lead source quality likely needs adjustment.`
      });
    }

    if (totalLeads > 0 && totalSpend > 0 && cpl === 0) {
      recommendations.push({
        type: "data_check",
        campaign: name,
        message: "Campaign has spend && leads, but CPL is showing as 0. Verify insight sync && campaign totals."
      });
    }
  }

  return res.status(200).json(recommendations);
}
