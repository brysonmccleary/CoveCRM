import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "../../../models/FBLeadCampaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();

  const campaigns = await FBLeadCampaign.find({}).lean();
  const actions: any[] = [];

  for (const c of campaigns) {
    const name = (c as any).campaignName || "Campaign";
    const pClass = (c as any).performanceClass;
    const score = (c as any).performanceScore || 0;
    const frequency = (c as any).frequency || 0;
    const optOutRate = (c as any).optOutRate || 0;
    const badNumberRate = (c as any).badNumberRate || 0;
    const cpl = (c as any).cpl || 0;
    const targetCpl = (c as any).targetCpl || 0;

    // Primary action based on performance class
    if (pClass === "SCALE") {
      actions.push({
        type: "scale",
        campaign: name,
        action: "Increase budget 20%",
        score
      });
    }

    if (pClass === "DUPLICATE_TEST") {
      actions.push({
        type: "duplicate",
        campaign: name,
        action: "Duplicate ad set and test new creative",
        score
      });
    }

    if (pClass === "FIX") {
      actions.push({
        type: "fix",
        campaign: name,
        action: "Change creative or targeting",
        score
      });
    }

    if (pClass === "PAUSE") {
      actions.push({
        type: "pause",
        campaign: name,
        action: "Pause campaign",
        score
      });
    }

    if (pClass === "MONITOR") {
      actions.push({
        type: "monitor",
        campaign: name,
        action: "Monitor performance",
        score
      });
    }

    // Secondary warnings
    if (frequency > 3) {
      actions.push({
        type: "creative_fatigue",
        campaign: name,
        action: "Frequency high — creative likely fatigued"
      });
    }

    if (optOutRate > 5) {
      actions.push({
        type: "optout_warning",
        campaign: name,
        action: "High opt-out rate — review messaging"
      });
    }

    if (badNumberRate > 15) {
      actions.push({
        type: "targeting_warning",
        campaign: name,
        action: "High bad number rate — review targeting"
      });
    }

    if (targetCpl > 0 && cpl > targetCpl) {
      actions.push({
        type: "cpl_warning",
        campaign: name,
        action: "CPL above target — adjust targeting or creative"
      });
    }
  }

  return res.status(200).json(actions);
}
