// pages/api/admin/send-payout.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayout from "@/models/AffiliatePayout";
import { stripe } from "@/lib/stripe";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type Resp =
  | { ok: true; transferId: string; amount: number }
  | { ok: false; message: string };

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN || "";
const MIN_PAYOUT = Number(process.env.AFFILIATE_MIN_PAYOUT_USD || 50);

/**
 * Automated-safe affiliate payout endpoint.
 *
 * Auth (either):
 *  - Logged-in admin (user.email === ADMIN_EMAIL)
 *  - Authorization: Bearer INTERNAL_API_TOKEN
 *
 * Body JSON:
 *  - promoCode?: string   (case-insensitive)
 *  - affiliateId?: string
 *  - amount?: number      (USD)  -> if omitted, pays FULL payoutDue
 *  - idempotencyKey?: string     -> recommended for external schedulers
 *  - sendEmail?: boolean         -> default true
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Resp>,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  // --- Auth: admin session OR bearer token ---
  const session = (await getServerSession(
    req,
    res,
    authOptions as any,
  )) as Session | null;

  const isAdminSession =
    !!session?.user &&
    typeof session.user.email === "string" &&
    session.user.email.toLowerCase() === ADMIN_EMAIL;

  const bearer =
    req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const isTokenAuth = Boolean(INTERNAL_TOKEN) && bearer === INTERNAL_TOKEN;

  if (!isAdminSession && !isTokenAuth) {
    return res.status(403).json({ ok: false, message: "Unauthorized" });
  }

  const { promoCode, affiliateId, amount, idempotencyKey, sendEmail = true } = (req.body ||
    {}) as {
    promoCode?: string;
    affiliateId?: string;
    amount?: number | string;
    idempotencyKey?: string;
    sendEmail?: boolean;
  };

  try {
    await dbConnect();

    // Lookup affiliate by ID or promo code
    const affiliate =
      (affiliateId && (await Affiliate.findById(affiliateId))) ||
      (promoCode &&
        (await Affiliate.findOne({
          promoCode: { $regex: `^${String(promoCode).trim()}$`, $options: "i" },
        })));

    if (!affiliate) {
      return res
        .status(404)
        .json({ ok: false, message: "Affiliate not found" });
    }

    // Verified Connect account required
    if (!affiliate.stripeConnectId) {
      return res
        .status(400)
        .json({ ok: false, message: "Affiliate has no Stripe Connect account" });
    }
    const status = String(affiliate.connectedAccountStatus || "pending");
    if (status !== "verified") {
      return res
        .status(400)
        .json({ ok: false, message: `Affiliate account not verified (status: ${status})` });
    }

    // Determine amount: full payoutDue if not provided
    const payoutDue = Number(affiliate.payoutDue ?? 0);
    const amt =
      amount != null ? Math.max(0, Number(amount)) : payoutDue;

    if (!amt) {
      return res.status(400).json({ ok: false, message: "No payable balance." });
    }
    if (amt < MIN_PAYOUT) {
      return res.status(400).json({
        ok: false,
        message: `Amount must be at least $${MIN_PAYOUT.toFixed(2)}`,
      });
    }
    if (payoutDue < amt) {
      return res
        .status(400)
        .json({ ok: false, message: "Payout amount exceeds payout due." });
    }

    // Idempotency: provided key or synthesize per affiliate+amount+day
    const day = new Date().toISOString().slice(0, 10);
    const idemKey =
      idempotencyKey ||
      `send:${affiliate._id.toString()}:${amt.toFixed(2)}:${day}`;

    const existing = await AffiliatePayout.findOne({
      idempotencyKey: idemKey,
    }).lean();
    if (existing?.stripeTransferId) {
      return res.status(200).json({
        ok: true,
        transferId: existing.stripeTransferId,
        amount: Number(existing.amount || amt),
      });
    }

    // Create Stripe transfer (Connect)
    const transfer = await stripe.transfers.create(
      {
        amount: Math.round(amt * 100),
        currency: "usd",
        destination: affiliate.stripeConnectId!,
        description: `Affiliate payout (${affiliate.promoCode})`,
      },
      { idempotencyKey: idemKey },
    );

    // Log payout row
    await AffiliatePayout.create({
      affiliateId: affiliate._id.toString(),
      affiliateEmail: affiliate.email,
      amount: amt,
      currency: "usd",
      stripeTransferId: transfer.id,
      status: "sent",
      idempotencyKey: idemKey,
    });

    // Update affiliate totals
    affiliate.totalPayoutsSent = Number(affiliate.totalPayoutsSent || 0) + amt;
    affiliate.payoutDue = Math.max(0, payoutDue - amt);
    affiliate.lastPayoutDate = new Date();
    affiliate.payoutHistory = affiliate.payoutHistory || [];
    affiliate.payoutHistory.push({
      amount: amt,
      userEmail: "", // bulk payout not tied to a single referral
      date: new Date(),
      note: "automated payout",
    } as any);
    await affiliate.save();

    // Email receipt (optional)
    if (sendEmail && process.env.RESEND_API_KEY && process.env.EMAIL_COMMISSIONS) {
      try {
        await resend.emails.send({
          from: `"CoveCRM Commissions" <${process.env.EMAIL_COMMISSIONS}>`,
          to: affiliate.email,
          subject: "You’ve been paid! 💸",
          html: `
            <p>Hi ${affiliate.name || "there"},</p>
            <p>Your affiliate payout of <strong>$${amt.toFixed(
              2,
            )}</strong> has been sent to your connected Stripe account.</p>
            <p>Transfer ID: <code>${transfer.id}</code></p>
            <br />
            <p>Thanks for being part of CoveCRM!</p>
            <p><strong>— The CoveCRM Team</strong></p>
          `,
        });
      } catch (e) {
        console.warn("Resend email failed:", (e as any)?.message || e);
      }
    }

    return res
      .status(200)
      .json({ ok: true, transferId: transfer.id, amount: amt });
  } catch (err: any) {
    console.error("send-payout error:", err?.message || err);
    return res
      .status(500)
      .json({ ok: false, message: err?.message || "Server error" });
  }
}
