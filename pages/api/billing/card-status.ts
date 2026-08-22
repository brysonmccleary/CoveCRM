import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

/**
 * Tells the client whether to surface the "add a card" prompt. The decision is
 * made server-side so the banner can never appear for admins, self-billed
 * tenants, or anyone who has already paid or saved a card.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: session.user.email })
      .select({
        role: 1,
        billingMode: 1,
        emailVerified: 1,
        cardOnFile: 1,
        hasEverPaid: 1,
        trialEndsAt: 1,
      })
      .lean();

    if (!user) return res.status(404).json({ error: "User not found" });

    const needsCard =
      (user as any).role !== "admin" &&
      (user as any).billingMode !== "self" &&
      (user as any).emailVerified === true &&
      (user as any).cardOnFile !== true &&
      (user as any).hasEverPaid !== true;

    return res.status(200).json({
      needsCard,
      trialEndsAt: (user as any).trialEndsAt || null,
    });
  } catch {
    return res.status(200).json({ needsCard: false, trialEndsAt: null });
  }
}
