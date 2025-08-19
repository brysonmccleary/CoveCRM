import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";
import type Stripe from "stripe";

function isActiveProduct(
  p: Stripe.Product | Stripe.DeletedProduct | string,
): p is Stripe.Product {
  return typeof p !== "string" && (p as Stripe.DeletedProduct).deleted !== true;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(
    req,
    res,
    authOptions as any,
  )) as Session | null;

  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await getUserByEmail(email);
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

    const totalAmount = items.reduce((acc, item) => {
      const cents = item.price.unit_amount ?? 0;
      return acc + cents;
    }, 0);

    const amount = (totalAmount / 100).toFixed(2);
    const interval = items[0]?.price.recurring?.interval || null;

    const hasAIUpgrade = items.some((item) => {
      const prod = item.price.product;
      return isActiveProduct(prod) && prod.name === "AI Upgrade";
    });

    return res.status(200).json({ amount, interval, hasAIUpgrade });
  } catch (error: any) {
    console.error("Error fetching subscription:", error);
    return res.status(500).json({ error: "Failed to fetch subscription" });
  }
}
