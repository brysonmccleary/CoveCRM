import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";
import { releaseUserPhoneNumbers } from "@/lib/billing/releaseUserPhoneNumbers";

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

    // Mark terminal before remote cleanup so the provisioning cron can never
    // race this request and replace a number we just released.
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          subscriptionStatus: "canceled",
          // A canceled account must never trigger an automatic card charge.
          aiDialerAutoReloadArmed: false,
        },
      },
    );

    // Phone numbers and A2P Campaigns both carry recurring fees. Tear down the
    // complete tenant telephony stack at cancel time, not at period end.
    const phoneCleanup = await releaseUserPhoneNumbers({
      userId: String(user._id),
      reason: "user_cancel",
    });

    return res.status(200).json({
      success: true,
      cancelAt: (subscription as any).cancel_at || null,
      releasedNumbers: phoneCleanup.releasedNumbers.length,
      phoneSubscriptionsCanceled: phoneCleanup.canceledPhoneSubscriptions.length,
      a2pCampaignsDeleted: phoneCleanup.deletedA2PCampaigns.length,
      messagingServicesDeleted: phoneCleanup.deletedMessagingServices.length,
      twilioSubaccountClosed: Boolean(phoneCleanup.closedSubaccount),
      cleanupComplete: phoneCleanup.complete,
      cleanupFailures: phoneCleanup.failures,
    });
  } catch (err: any) {
    console.error("cancel-subscription error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || "Cancellation failed" });
  }
}
