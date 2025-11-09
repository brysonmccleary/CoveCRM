// /pages/api/affiliate/stats.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";

const U = (s?: string | null) => (s || "").trim().toUpperCase();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return res.status(405).end("Method Not Allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  // Current user
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Find affiliate record (prefer userId, then email, then stored referralCode)
  let affiliate =
    (await Affiliate.findOne({ userId: String(user._id) })) ||
    (await Affiliate.findOne({ email: user.email })) ||
    (user.referralCode
      ? await Affiliate.findOne({ promoCode: U(user.referralCode) })
      : null);

  // If no affiliate yet → tell UI to show the application form
  if (!affiliate) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      code: null,
      signups: 0,
      referrals: [],
      totalCommission: 0,
      payoutDue: 0,
      totalPayoutsSent: 0,
      payoutHistory: [],
      stripeConnectId: null,
      onboardingCompleted: false,
      connectedAccountStatus: "pending",
      approved: false,
    });
  }

  // Ensure user's referralCode mirrors the affiliate's (normalized)
  if (U(user.referralCode) !== U(affiliate.promoCode)) {
    user.referralCode = affiliate.promoCode;
    await user.save().catch(() => {});
  }

  // Optionally refresh the Connect status live from Stripe (and persist)
  let onboardingCompleted = !!affiliate.onboardingCompleted;
  let connectedAccountStatus = affiliate.connectedAccountStatus || "pending";

  if (affiliate.stripeConnectId) {
    try {
      const acct = await stripe.accounts.retrieve(affiliate.stripeConnectId);

      // Derive UI status
      const freshComplete =
        !!acct.details_submitted &&
        !!acct.charges_enabled &&
        !!acct.payouts_enabled;

      let uiStatus: "pending" | "incomplete" | "restricted" | "verified" = "pending";
      if (acct.requirements?.currently_due?.length) uiStatus = "incomplete";
      if (acct.requirements?.disabled_reason) uiStatus = "restricted";
      if (freshComplete) uiStatus = "verified";

      onboardingCompleted = freshComplete;
      connectedAccountStatus = uiStatus;

      // Persist if changed
      if (
        affiliate.onboardingCompleted !== onboardingCompleted ||
        affiliate.connectedAccountStatus !== connectedAccountStatus
      ) {
        affiliate.onboardingCompleted = onboardingCompleted;
        affiliate.connectedAccountStatus = connectedAccountStatus;
        await affiliate.save();
      }
    } catch {
      // Best effort; ignore if Stripe call fails
    }
  }

  // Referrals list: prefer Affiliate.referrals (populated by webhook on first invoice),
  // fallback to Users referred by this code for legacy scenarios.
  let referrals =
    Array.isArray(affiliate.referrals) && affiliate.referrals.length
      ? affiliate.referrals
          .slice()
          .sort((a: any, b: any) => +new Date(b.joinedAt || b.date || 0) - +new Date(a.joinedAt || a.date || 0))
          .slice(0, 20)
          .map((r: any) => ({
            name: r.name || "Unnamed",
            email: r.email,
            joinedAt: r.joinedAt || r.date || new Date(),
          }))
      : [];

  if (referrals.length === 0) {
    // Fallback for older signups that don't exist in Affiliate.referrals
    const referredUsers = await User.find({
      $or: [
        { referredBy: U(affiliate.promoCode) },
        { referredByCode: U(affiliate.promoCode) },
      ],
    })
      .select("name email createdAt")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    referrals = referredUsers.map((r) => ({
      name: r.name || "Unnamed",
      email: r.email,
      joinedAt: r.createdAt || new Date(),
    }));
  }

  // Counts / totals (source of truth = Affiliate doc)
  const signups =
    typeof affiliate.totalReferrals === "number"
      ? affiliate.totalReferrals
      : referrals.length;

  const payoutDue = Number(affiliate.payoutDue || 0);
  const totalPayoutsSent = Number(affiliate.totalPayoutsSent || 0);
  const totalCommission = Number((payoutDue + totalPayoutsSent).toFixed(2));

  // Response
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    code: affiliate.promoCode, // “Your Referral Code”
    signups,
    referrals,
    totalCommission,
    payoutDue,
    totalPayoutsSent,
    payoutHistory: affiliate.payoutHistory || [],
    stripeConnectId: affiliate.stripeConnectId || null,
    onboardingCompleted,
    connectedAccountStatus,
    approved: !!affiliate.approved,
    approvedAt: affiliate.approvedAt || null,
  });
}
