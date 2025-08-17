import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-04-10",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const { email, price } = req.body;

  if (!email || !price) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(Number(price) * 100), // Convert to cents
            product_data: {
              name: "CRM Cove Monthly Subscription",
              description: "Full access to CRM Cove with affiliate system",
            },
            recurring: {
              interval: "month",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${req.headers.origin}/success?email=${encodeURIComponent(email)}`,
      cancel_url: `${req.headers.origin}/billing?email=${encodeURIComponent(email)}&price=${price}`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err: any) {
    console.error("Stripe Checkout Error:", err);
    return res.status(500).json({ message: "Stripe checkout failed" });
  }
}
