import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { Resend } from "resend"; // ✅ Correct package name

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const isAdmin = session?.user?.email === process.env.ADMIN_EMAIL;
  if (!isAdmin) return res.status(403).json({ message: "Unauthorized" });

  const { promoCode, amount } = req.body;

  if (!promoCode || typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ message: "Missing or invalid fields." });
  }

  try {
    await dbConnect();

    const affiliate = await Affiliate.findOne({
      promoCode: promoCode.toUpperCase(),
    });

    if (!affiliate) {
      return res.status(404).json({ message: "Affiliate not found." });
    }

    if (affiliate.payoutDue < amount) {
      return res
        .status(400)
        .json({ message: "Payout amount exceeds payout due." });
    }

    affiliate.payoutDue -= amount;
    affiliate.totalPayoutsSent += amount;
    affiliate.lastPayoutDate = new Date();
    affiliate.payoutHistory = affiliate.payoutHistory || [];
    affiliate.payoutHistory.push({
      amount,
      date: new Date(),
    });

    await affiliate.save();

    // Send payout email via Resend
    await resend.emails.send({
      from: `"CoveCRM Commissions" <${process.env.EMAIL_COMMISSIONS}>`,
      to: affiliate.email,
      subject: "You’ve been paid! 💸",
      html: `
        <p>Hi ${affiliate.name},</p>
        <p>Your affiliate payout of <strong>$${amount.toFixed(2)}</strong> has just been processed.</p>
        <p>This will appear in your connected Stripe account shortly.</p>
        <br />
        <p>Thanks for being part of CoveCRM!</p>
        <p><strong>— The CoveCRM Team</strong></p>
      `,
    });

    res.status(200).json({ message: "Payout recorded and email sent." });
  } catch (err) {
    console.error("Payout error:", err);
    res.status(500).json({ message: "Internal server error." });
  }
}
