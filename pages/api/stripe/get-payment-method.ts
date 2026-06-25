import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const customerId = String((user as any).stripeCustomerId || (user as any).stripeCustomerID || "").trim();
    if (!customerId) return res.status(200).json(null);

    const customer = await stripe.customers.retrieve(customerId);
    const defaultPaymentMethodId =
      typeof (customer as any)?.invoice_settings?.default_payment_method === "string"
        ? (customer as any).invoice_settings.default_payment_method
        : null;

    let paymentMethod = null;
    if (defaultPaymentMethodId) {
      paymentMethod = await stripe.paymentMethods.retrieve(defaultPaymentMethodId);
    } else {
      const methods = await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 1,
      });
      paymentMethod = methods.data[0] || null;
    }

    const card = paymentMethod?.card;
    if (!card) return res.status(200).json(null);

    return res.status(200).json({
      brand: card.brand,
      last4: card.last4,
      expMonth: card.exp_month,
      expYear: card.exp_year,
    });
  } catch (err: any) {
    console.error("get-payment-method error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Failed to load payment method" });
  }
}
