import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { stripe } from "@/lib/stripe";
import Affiliate from "@/models/Affiliate";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const affiliate = await Affiliate.findOne({ email: user.email });
    if (!affiliate?.stripeConnectId) {
      return res.status(400).json({ error: "No connected account. Start onboarding first." });
    }

    const login = await stripe.accounts.createLoginLink(affiliate.stripeConnectId);
    return res.status(200).json({ url: login.url });
  } catch (e: any) {
    console.error("connect/dashboard error:", e?.message || e);
    return res.status(500).json({ error: "Failed to create dashboard link" });
  }
}
