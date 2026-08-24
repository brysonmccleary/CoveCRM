import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import { stripe } from "@/lib/stripe";
import { findActiveCrmPlanSubscription } from "@/lib/billing/stripePlanClassification";
import { releaseUserPhoneNumbers } from "@/lib/billing/releaseUserPhoneNumbers";
import User from "@/models/User";

export const config = { maxDuration: 300 };

const INTERNAL_EMAILS = new Set([
  "support@covecrm.com",
  "admin@covecrm.com",
  "bryson.mccleary1@gmail.com",
]);

function authorized(req: NextApiRequest) {
  const secret = String(process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET || "").trim();
  if (!secret) return false;
  const bearer = String(req.headers.authorization || "");
  const headerSecret = String(req.headers["x-cron-key"] || req.headers["x-cron-secret"] || "");
  return bearer === `Bearer ${secret}` || headerSecret === secret;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!authorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  await dbConnect();
  const candidates = await User.find({
    $or: [
      { "numbers.0": { $exists: true } },
      { "a2p.campaignSid": { $type: "string", $ne: "" } },
      { "a2p.messagingServiceSid": { $type: "string", $ne: "" } },
    ],
    role: { $ne: "admin" },
    isOwner: { $ne: true },
  })
    .select("_id email stripeCustomerId subscriptionStatus")
    .limit(50)
    .lean<any[]>();

  const cleaned: string[] = [];
  const skippedActive: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];

  for (const user of candidates) {
    const email = String(user.email || "").trim().toLowerCase();
    if (!email || INTERNAL_EMAILS.has(email)) continue;

    try {
      // Stripe is authoritative for payment. Local entitlement flags can remain
      // stale after a missed webhook and must not keep paid Twilio resources alive.
      if (user.stripeCustomerId) {
        const subscriptions = await stripe.subscriptions.list({
          customer: String(user.stripeCustomerId),
          status: "all",
          limit: 100,
          expand: ["data.items.data.price"],
        });
        if (findActiveCrmPlanSubscription(subscriptions.data)) {
          skippedActive.push(email);
          continue;
        }
      }

      const result = await releaseUserPhoneNumbers({
        userId: String(user._id),
        reason: "daily_canceled_account_reconciliation",
        closeSubaccount: false,
      });
      if (!result.complete) {
        failed.push({ email, error: JSON.stringify(result.failures).slice(0, 1000) });
      } else {
        cleaned.push(email);
      }
    } catch (error: any) {
      failed.push({ email, error: String(error?.message || error).slice(0, 1000) });
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(failed.length ? 207 : 200).json({
    ok: failed.length === 0,
    candidates: candidates.length,
    cleaned,
    skippedActive,
    failed,
  });
}
