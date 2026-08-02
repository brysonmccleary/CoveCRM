import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";
import { isPhoneNumberSubscription } from "@/lib/billing/stripePlanClassification";

/**
 * Phone numbers are billed as their own Stripe subscriptions.  End each one
 * no later than its already-paid period when the CRM plan is cancelled, so an
 * add-on with a different renewal date can never bill again after cancellation.
 */
async function schedulePhoneSubscriptionsToEnd(customerId: string) {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
    expand: ["data.items.data.price"],
  });

  const phoneSubscriptions = subscriptions.data.filter(
    (subscription) =>
      isPhoneNumberSubscription(subscription) &&
      ["active", "trialing", "past_due", "incomplete"].includes(subscription.status) &&
      !subscription.cancel_at_period_end,
  );

  await Promise.all(
    phoneSubscriptions.map((subscription) =>
      stripe.subscriptions.update(subscription.id, {
        // This is intentionally the phone subscription's own period end rather
        // than the CRM plan's. It prevents another phone renewal even when the
        // two subscriptions have different billing anchors.
        cancel_at_period_end: true,
      }),
    ),
  );

  return phoneSubscriptions.map((subscription) => subscription.id);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    if ((user as any).role === "admin") {
      return res.status(403).json({ success: false, error: "Admin subscriptions cannot be canceled here" });
    }

    const subscriptionId = String((user as any).stripeSubscriptionId || "").trim();
    if (!subscriptionId) {
      return res.status(400).json({ success: false, error: "No subscription found" });
    }

    assertStripeWritesEnabled();
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    // Phone-number billing is separate from the CRM subscription. Leaving it
    // active here was the reason cancelled customers continued to be charged.
    const phoneSubscriptionIds = await schedulePhoneSubscriptionsToEnd(
      String((user as any).stripeCustomerId),
    );

    await User.updateOne(
      { _id: user._id },
      { $set: { subscriptionStatus: "canceled" } },
    );

    return res.status(200).json({
      success: true,
      cancelAt: (subscription as any).cancel_at || null,
      phoneSubscriptionsScheduledToCancel: phoneSubscriptionIds.length,
    });
  } catch (err: any) {
    console.error("cancel-subscription error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || "Cancellation failed" });
  }
}
