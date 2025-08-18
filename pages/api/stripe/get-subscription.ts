import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect();
  const user = await getUserByEmail(session.user.email);
  if (!user || !user.stripeCustomerId) {
    return res.status(400).json({ error: "Missing Stripe customer ID" });
  }

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "active",
      expand: ["data.items.data.price.product"],
    });

    const activeSubscription = subscriptions.data[0];
    if (!activeSubscription) {
      return res.status(404).json({ error: "No active subscription found" });
    }

    const items = activeSubscription.items.data;

    const totalAmount = items.reduce(
      (acc, item) => acc + item.price.unit_amount!,
      0,
    );
    const amount = (totalAmount / 100).toFixed(2);
    const interval = items[0].price.recurring?.interval;

    const hasAIUpgrade = items.some(
      (item) =>
        item.price.product &&
        typeof item.price.product !== "string" &&
        item.price.product.name === "AI Upgrade",
    );

    return res.status(200).json({ amount, interval, hasAIUpgrade });
  } catch (error: any) {
    console.error("Error fetching subscription:", error);
    return res.status(500).json({ error: "Failed to fetch subscription" });
  }
}
