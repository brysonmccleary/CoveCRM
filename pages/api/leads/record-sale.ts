// pages/api/leads/record-sale.ts
// POST — records AP + Comp% on a lead, computes commission revenue, then calls disposition-lead
// to move the lead to the Sold folder. Called by SaleModal on all Sold entry points.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

const VALID_COMP_PERCENTAGES = [80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145];
const ADVANCE_PERCENTAGE = 0.75;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase() || "";
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  const { leadId, annualPremium, compPercentage } = req.body as {
    leadId?: string;
    annualPremium?: number;
    compPercentage?: number;
  };

  if (!leadId) return res.status(400).json({ error: "leadId is required" });

  const ap = Number(annualPremium);
  if (!ap || ap <= 0 || !Number.isFinite(ap)) {
    return res.status(400).json({ error: "Annual Premium must be a positive number" });
  }

  const comp = Number(compPercentage);
  if (!VALID_COMP_PERCENTAGES.includes(comp)) {
    return res.status(400).json({ error: `Comp % must be one of: ${VALID_COMP_PERCENTAGES.join(", ")}` });
  }

  await mongooseConnect();

  const lead = await Lead.findOne({ _id: leadId, userEmail }).select("_id").lean();
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const grossCommissionRevenue = Math.round(ap * (comp / 100) * 100) / 100;
  const advanceRevenue = Math.round(grossCommissionRevenue * ADVANCE_PERCENTAGE * 100) / 100;
  const holdbackRevenue = Math.round((grossCommissionRevenue - advanceRevenue) * 100) / 100;

  await Lead.updateOne(
    { _id: leadId, userEmail },
    {
      $set: {
        annualPremium: ap,
        compPercentage: comp,
        advancePercentage: ADVANCE_PERCENTAGE,
        grossCommissionRevenue,
        advanceRevenue,
        holdbackRevenue,
      },
    }
  );

  return res.status(200).json({
    ok: true,
    annualPremium: ap,
    compPercentage: comp,
    advancePercentage: ADVANCE_PERCENTAGE,
    grossCommissionRevenue,
    advanceRevenue,
    holdbackRevenue,
  });
}
