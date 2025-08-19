import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/mongooseConnect";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
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

    const formatted = await Promise.all(
      invoices.data.map(async (invoice: Stripe.Invoice) => {
        // Resolve a receipt URL if possible. Stripe's Invoice typings vary across versions,
        // so we probe defensively and cast to any where needed.
        let receiptUrl: string | null = null;
        const invAny = invoice as any;

        if (typeof invAny?.charge === "string") {
          try {
            const charge = await stripe.charges.retrieve(invAny.charge);
            receiptUrl = (charge as any)?.receipt_url || null;
          } catch {
            receiptUrl = null;
          }
        } else if (invAny?.charge?.receipt_url) {
          receiptUrl = invAny.charge.receipt_url || null;
        }

        const descriptions = invoice.lines.data
          .map((line: Stripe.InvoiceLineItem) => line.description)
          .filter(Boolean)
          .join(", ");

        return {
          id: invoice.id,
          amountPaid: (invoice.amount_paid || 0) / 100,
          date: new Date((invoice.created || 0) * 1000).toISOString(),
          hostedInvoiceUrl: invoice.hosted_invoice_url,
          receiptUrl,
          description: descriptions,
          status: invoice.status,
        };
      }),
    );

    return res.status(200).json({ invoices: formatted });
  } catch (error) {
    console.error("[INVOICES_FETCH_ERROR]", error);
    return res.status(500).json({ error: "Failed to fetch invoices" });
  }
}
