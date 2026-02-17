import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

/**
 * Trial support helper:
 * After a SetupIntent succeeds (trial often has no PaymentIntent),
 * set customer's default payment method (and subscription default) so usage can bill.
 *
 * Scope-locked: does NOT touch billing accrual, invoices, thresholds, or schemas.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const { email, subscriptionId, paymentMethodId } = (req.body || {}) as {
    email?: string;
    subscriptionId?: string | null;
    paymentMethodId?: string;
  };

  const emailLc = (email || "").toLowerCase().trim();
  if (!emailLc || !paymentMethodId) {
    return res.status(400).json({ error: "Missing email or paymentMethodId." });
  }

  try {
    await dbConnect();
    const user = await User.findOne({ email: emailLc });
    const customerId = user?.stripeCustomerId || (user as any)?.stripeCustomerID;

    if (!customerId) {
      return res.status(404).json({ error: "User missing stripeCustomerId." });
    }

    await stripe.customers.update(String(customerId), {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    if (subscriptionId) {
      try {
        await stripe.subscriptions.update(String(subscriptionId), {
          default_payment_method: paymentMethodId,
        });
      } catch {
        // non-blocking
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("set-default-payment-method error:", err);
    return res
      .status(500)
      .json({ error: err?.message || "Failed to set default payment method." });
  }
}
