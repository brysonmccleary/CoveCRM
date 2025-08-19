import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: session.user.email });

    if (!user || !user.numbers?.length) {
      return res.status(200).json({ numbers: [] });
    }

    const enrichedNumbers = await Promise.all(
      user.numbers.map(async (num: any) => {
        let status = "unknown";
        let nextBillingDate: string | null = null;

        if (num.subscriptionId) {
          try {
            const subResp = await stripe.subscriptions.retrieve(num.subscriptionId);
            const sub = subResp as unknown as Stripe.Subscription;
            status = sub.status;
            nextBillingDate = sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null;
          } catch (err) {
            console.warn(`❗ Failed to fetch Stripe subscription for ${num.phoneNumber}`, err);
          }
        }

        return {
          sid: num.sid,
          phoneNumber: num.phoneNumber,
          subscriptionStatus: status,
          nextBillingDate,
          usage: num.usage || {
            callsMade: 0,
            callsReceived: 0,
            textsSent: 0,
            textsReceived: 0,
            cost: 0,
          },
        };
      }),
    );

    return res.status(200).json({ numbers: enrichedNumbers });
  } catch (err) {
    console.error("❌ Failed to fetch numbers:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}
