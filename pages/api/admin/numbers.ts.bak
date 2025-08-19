// pages/api/admin/numbers.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  try {
    await dbConnect();
    const users = await User.find();

    const results = await Promise.all(
      users.flatMap((user) =>
        user.numbers?.map(async (num) => {
          let status = "unknown";
          let nextBillingDate = null;

          if (num.subscriptionId) {
            try {
              const sub = await stripe.subscriptions.retrieve(num.subscriptionId);
              status = sub.status;
              nextBillingDate = sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : null;
            } catch (err) {
              console.warn(`⚠️ Stripe sub fetch failed for ${num.subscriptionId}`);
            }
          }

          return {
            userEmail: user.email.toLowerCase(),
            phoneNumber: num.phoneNumber,
            status,
            nextBillingDate,
            usage: num.usage || {
              callsMade: 0,
              callsReceived: 0,
              textsSent: 0,
              textsReceived: 0,
              cost: 0,
            },
          };
        }) || []
      )
    );

    // Sort alphabetically by user email
    results.sort((a, b) => a.userEmail.localeCompare(b.userEmail));

    res.status(200).json({ numbers: results });
  } catch (err) {
    console.error("❌ Admin numbers error:", err);
    res.status(500).end("Server error");
  }
}
