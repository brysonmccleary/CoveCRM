import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";
import { stripe } from "@/lib/stripe";

// ✅ Real Stripe Price ID for AI Upgrade ($50/month)
const AI_PRICE_ID = "price_1RoAK4DF9aEsjVyJeoR3w3RL";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.email) return res.status(401).end();

  await dbConnect();
  const user = await getUserByEmail(session.user.email);
  if (!user?.stripeCustomerId) return res.status(400).end();

  const { enable } = req.body;

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "active",
      expand: ["data.items"],
    });

    const subscription = subscriptions.data[0];
    if (!subscription) return res.status(404).end();

    const currentItems = subscription.items.data;
    const aiItem = currentItems.find((item) => item.price.id === AI_PRICE_ID);

    let updatedSub;
    if (enable && !aiItem) {
      updatedSub = await stripe.subscriptions.update(subscription.id, {
        items: [
          ...currentItems.map((item) => ({ id: item.id })),
          { price: AI_PRICE_ID },
        ],
      });
    } else if (!enable && aiItem) {
      updatedSub = await stripe.subscriptions.update(subscription.id, {
        items: [
          ...currentItems
            .filter((item) => item.price.id !== AI_PRICE_ID)
            .map((item) => ({ id: item.id })),
        ],
      });
    }

    user.hasAIUpgrade = enable;
    await user.save();

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Failed to toggle AI upgrade:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
