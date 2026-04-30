import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "../../../models/FBLeadCampaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  const campaigns = await FBLeadCampaign.find({ userEmail: email }).lean();
  const bestByLeadType = new Map<string, any>();
  const fatiguedByLeadType = new Map<string, any>();
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
    const optimizationAlerts = Array.isArray((c as any).optimizationAlerts)
      ? (c as any).optimizationAlerts.filter((alert: any) => !alert?.dismissed)
      : [];

    for (const alert of optimizationAlerts) {
      recommendations.push({
        type: alert.type || "review",
        campaign: name,
        message: String(alert.message || "Review ad performance."),
      });
    }

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
      const globalWinner = bestByLeadType.get((c as any).leadType);
      recommendations.push({
        type: "fix",
        campaign: name,
        message: globalWinner
          ? `Campaign performance is weak (${score}). Refresh creative toward the globally stronger ${globalWinner.hookType}/${globalWinner.bodyAngle} angle for this lead type.`
          : `Campaign performance is weak (${score}). Refresh creative, tighten targeting, && review lead quality.`
      });
    }

    if (pClass === "PAUSE") {
      const globalWinner = bestByLeadType.get((c as any).leadType);
      recommendations.push({
        type: "pause",
        campaign: name,
        message: globalWinner
          ? `Campaign is underperforming badly (${score}). Consider pausing && rebuilding with a globally stronger ${globalWinner.hookType}/${globalWinner.bodyAngle} pattern.`
          : `Campaign is underperforming badly (${score}). Consider pausing && rebuilding the offer, creative, or targeting.`
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
      const fatiguedPattern = fatiguedByLeadType.get((c as any).leadType);
      recommendations.push({
        type: "frequency",
        campaign: name,
        message: fatiguedPattern
          ? `Frequency is elevated (${frequency.toFixed(2)}). Creative fatigue is likely; avoid overusing the ${fatiguedPattern.hookType}/${fatiguedPattern.bodyAngle} angle and refresh into a new hook.`
          : `Frequency is elevated (${frequency.toFixed(2)}). Creative fatigue is likely, so rotate new ads soon.`
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

    if ((c as any).recommendReplaceAd) {
      recommendations.push({
        type: "replace_ad",
        campaign: name,
        message: "Creative fatigue or rising CPL detected. Replace your primary ad to restore performance."
      });
    }

    if ((c as any).recommendNewAd) {
      const globalWinner = bestByLeadType.get((c as any).leadType);
      recommendations.push({
        type: "new_ad",
        campaign: name,
        message: globalWinner
          ? `Campaign momentum is strong. Duplicate-test a new variation using the globally strong ${globalWinner.hookType}/${globalWinner.bodyAngle} direction.`
          : "Campaign momentum is strong. Launch an additional ad variation to capture more volume."
      });
    }
  }

  return res.status(200).json(recommendations);
}
