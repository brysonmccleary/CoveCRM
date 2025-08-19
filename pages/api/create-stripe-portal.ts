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
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect(); // Ensure Mongoose is connected
  const user = await getUserByEmail(session.user.email);

  if (!user || !user.stripeCustomerId) {
    return res.status(400).json({ error: "Missing Stripe customer ID" });
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard?tab=settings`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (error: any) {
    console.error("Stripe portal error:", error);
    return res
      .status(500)
      .json({ error: "Failed to create Stripe portal session" });
  }
}
