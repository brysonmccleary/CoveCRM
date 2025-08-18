import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/dbConnect";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-04-10",
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await User.findOne({ email: session.user.email });
  if (!user || !user.stripeCustomerId) {
    return res.status(404).json({ error: "User or Stripe customer not found" });
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 50,
    });

    const formatted = invoices.data.map((invoice) => ({
      id: invoice.id,
      amountPaid: invoice.amount_paid / 100,
      date: new Date(invoice.created * 1000).toISOString(),
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      receiptUrl: invoice.charge ? invoice.charge.receipt_url : null,
      description: invoice.lines.data
        .map((line) => line.description)
        .join(", "),
      status: invoice.status,
    }));

    return res.status(200).json({ invoices: formatted });
  } catch (error) {
    console.error("[INVOICES_FETCH_ERROR]", error);
    return res.status(500).json({ error: "Failed to fetch invoices" });
  }
}
