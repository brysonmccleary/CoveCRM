import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

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

    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    await User.updateOne(
      { _id: user._id },
      { $set: { subscriptionStatus: "canceled" } },
    );

    return res.status(200).json({
      success: true,
      cancelAt: (subscription as any).cancel_at || null,
    });
  } catch (err: any) {
    console.error("cancel-subscription error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || "Cancellation failed" });
  }
}
