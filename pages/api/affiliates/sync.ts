import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email || (session.user as any).role !== "admin") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await mongooseConnect();

    const subs = await stripe.subscriptions.list({ limit: 100 });
    const affiliates = await Affiliate.find({}).lean();

    let matched = 0;
    const matches: Array<{
      subscriptionId: string;
      customerId: string;
      promoCode: string;
      affiliateId: string;
    }> = [];

    for (const sub of subs.data) {
      const customerId =
        typeof sub.customer === "string"
          ? sub.customer
          : (sub.customer as Stripe.Customer).id;

      const custResp = await stripe.customers.retrieve(customerId);
      if ((custResp as Stripe.DeletedCustomer).deleted) continue;
      const customer = custResp as Stripe.Customer;

      let usedCodeUpper: string | undefined;
      const discount = customer.discount;
      if (discount?.coupon) {
        const coupon =
          typeof discount.coupon === "string"
            ? await stripe.coupons.retrieve(discount.coupon)
            : (discount.coupon as Stripe.Coupon);
        if (coupon?.name) usedCodeUpper = coupon.name.toUpperCase();
      }

      if (!usedCodeUpper) continue;
      const affiliate = affiliates.find((a) => a.promoCode === usedCodeUpper);
      if (!affiliate) continue;

      matched++;
      matches.push({
        subscriptionId: sub.id,
        customerId,
        promoCode: usedCodeUpper,
        affiliateId: String(affiliate._id),
      });
    }

    return res.status(200).json({
      success: true,
      readOnly: true,
      matched,
      matches,
      message:
        "Read-only affiliate sync: payable credits are created only by verified Stripe payment webhooks.",
    });
  } catch (error) {
    console.error("Affiliate sync error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
