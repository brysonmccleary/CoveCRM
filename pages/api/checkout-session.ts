import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { email, price } = req.body as {
    email?: string;
    price?: number | string;
  };

  if (!email || price == null) {
    return res.status(400).json({ message: "Missing required parameters" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(Number(price) * 100), // to cents
            product_data: {
              name: "Cove CRM Monthly Subscription",
              description: "Full access to Cove CRM with affiliate system",
            },
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: `${req.headers.origin}/success?email=${encodeURIComponent(
        email,
      )}`,
      cancel_url: `${req.headers.origin}/billing?email=${encodeURIComponent(
        email,
      )}&price=${price}`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe Checkout Error:", err);
    return res.status(500).json({ message: "Stripe checkout failed" });
  }
}
