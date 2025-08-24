import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3000";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    // Ensure the user has a Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: (user as any)?._id?.toString?.() || "" },
      });
      user.stripeCustomerId = customer.id;
      await user.save();
      customerId = customer.id;
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId!,
      return_url: `${BASE_URL}/dashboard?tab=settings`,
    });

    return res.status(200).json({ url: portal.url });
  } catch (err: any) {
    console.error("❌ create-portal error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create portal session" });
  }
}
