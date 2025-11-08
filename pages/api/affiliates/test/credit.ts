import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import type { IAffiliate } from "@/models/Affiliate";
import AffiliatePayout from "@/models/AffiliatePayout";

const envBool = (n: string, d = false) => {
  const v = process.env[n];
  if (v == null) return d;
  return v === "1" || v.toLowerCase() === "true";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Admin-only: require CRON_SECRET via header or ?token=
  const secret = process.env.CRON_SECRET || "";
  const authz = req.headers.authorization || "";
  const token = (req.query.token as string) || "";
  const ok = (!!secret && authz === `Bearer ${secret}`) || (!!secret && token === secret);
  if (!ok) return res.status(401).json({ error: "Unauthorized" });

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const code = String(req.query.code || req.body?.code || "").trim().toUpperCase();
  const email = String(req.query.email || req.body?.email || "").trim().toLowerCase() || null;
  const amountUSD = Number(req.query.amount || req.body?.amount || "") ||
    Number(process.env.AFFILIATE_DEFAULT_PAYOUT || 25);

  if (!code) return res.status(400).json({ error: "Missing ?code=" });

  try {
    await dbConnect();

    const aff = (await Affiliate.findOne({ promoCode: code })) as IAffiliate | null;
    if (!aff) return res.status(404).json({ error: `Affiliate not found for code ${code}` });

    // Credit once-per-request (idempotency based on a simple uid if provided)
    // For testing, we allow multiple credits; production idempotency is in webhook logic.
    const newDue = Math.round((Number(aff.payoutDue || 0) + amountUSD) * 100) / 100;

    (aff as any).payoutHistory = (aff as any).payoutHistory || [];
    (aff as any).payoutHistory.push({
      amount: amountUSD,
      userEmail: email || "",
      date: new Date(),
      invoiceId: null,
      subscriptionId: null,
      customerId: null,
      note: `test-credit for ${code}`,
    });

    aff.payoutDue = newDue;
    await aff.save();

    return res.status(200).json({
      ok: true,
      promoCode: code,
      credited: amountUSD,
      payoutDue: aff.payoutDue,
      totalPayoutsSent: aff.totalPayoutsSent,
    });
  } catch (e: any) {
    console.error("test/credit error:", e?.message || e);
    return res.status(500).json({ error: "Test credit failed" });
  }
}
