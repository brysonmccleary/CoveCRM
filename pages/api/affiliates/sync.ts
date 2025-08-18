import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import User from "@/models/User"; // If you're using user linkage
import { stripe } from "@/lib/stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-04-10",
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session || session.user.role !== "admin") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await mongooseConnect();

    // Step 1: Get all affiliates from DB
    const affiliates = await Affiliate.find({});

    // Step 2: Get all subscriptions from Stripe (can paginate later)
    const subscriptions = await stripe.subscriptions.list({
      limit: 100,
    });

    // Step 3: Track affiliate redemptions
    for (const sub of subscriptions.data) {
      const customer = await stripe.customers.retrieve(sub.customer as string);

      if (
        typeof customer !== "string" &&
        customer.discount &&
        customer.discount.coupon &&
        customer.discount.coupon.name
      ) {
        const usedCode = customer.discount.coupon.name.toUpperCase();

        const affiliate = affiliates.find((a) => a.promoCode === usedCode);
        if (!affiliate) continue;

        // Check if this redemption already counted (via metadata or history system later if needed)
        // For now, assume it's a new valid redemption:
        affiliate.totalRedemptions += 1;
        affiliate.totalRevenueGenerated += 150;
        affiliate.payoutDue += affiliate.flatPayoutAmount;

        await affiliate.save();
      }
    }

    return res.status(200).json({ success: true, updated: affiliates.length });
  } catch (error) {
    console.error("Affiliate sync error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
