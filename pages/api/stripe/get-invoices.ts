import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const customerId = String((user as any).stripeCustomerId || (user as any).stripeCustomerID || "").trim();
    if (!customerId) return res.status(200).json([]);

    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 10,
    });

    return res.status(200).json(
      invoices.data
        .filter((invoice) => invoice.status === "paid" || invoice.status === "open")
        .map((invoice) => ({
          date: new Date(invoice.created * 1000).toISOString(),
          amount: Number(((invoice.amount_paid || invoice.amount_due || 0) / 100).toFixed(2)),
          status: invoice.status,
          pdfUrl: invoice.invoice_pdf || null,
        })),
    );
  } catch (err: any) {
    console.error("get-invoices error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Failed to load invoices" });
  }
}
