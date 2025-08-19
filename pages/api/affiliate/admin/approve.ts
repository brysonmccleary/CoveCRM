import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { sendAffiliateApprovedEmail } from "@/lib/email";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  // Simple shared-secret guard
  const token = req.headers["x-internal-token"];
  if (!token || token !== process.env.INTERNAL_API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { promoCode, email } = req.body as {
    promoCode?: string;
    email?: string;
  };
  if (!promoCode && !email) {
    return res.status(400).json({ error: "Provide promoCode or email" });
  }

  await dbConnect();

  const query = promoCode
    ? { promoCode: String(promoCode).toUpperCase() }
    : { email: String(email).toLowerCase() };
  const affiliate = await Affiliate.findOne(query);
  if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

  // Mark approved
  affiliate.approved = true;
  affiliate.approvedAt = new Date();
  await affiliate.save();

  // Notify affiliate (non-fatal)
  try {
    await sendAffiliateApprovedEmail({
      to: affiliate.email,
      name: affiliate.name,
      promoCode: affiliate.promoCode,
      dashboardUrl: `${process.env.NEXTAUTH_URL || "https://covecrm.com"}/settings/affiliate`,
    });
  } catch {
    console.warn("sendAffiliateApprovedEmail failed");
  }

  return res
    .status(200)
    .json({ ok: true, approved: true, promoCode: affiliate.promoCode });
}
