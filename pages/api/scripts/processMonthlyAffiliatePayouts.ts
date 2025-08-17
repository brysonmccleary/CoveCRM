import Stripe from "stripe";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export default async function processAffiliatePayouts() {
  await dbConnect();

  const affiliates = await Affiliate.find({
    stripeConnectId: { $exists: true },
    payoutDue: { $gt: 0 },
    onboardingCompleted: true,
  });

  for (const affiliate of affiliates) {
    const amountInCents = Math.round(affiliate.payoutDue * 100);

    try {
      await stripe.transfers.create({
        amount: amountInCents,
        currency: "usd",
        destination: affiliate.stripeConnectId,
        description: `Monthly payout for ${affiliate.promoCode}`,
      });

      affiliate.totalPayoutsSent += affiliate.payoutDue;
      affiliate.payoutDue = 0;
      affiliate.lastPayoutDate = new Date();
      await affiliate.save();

      console.log(`✅ Paid out $${amountInCents / 100} to ${affiliate.email}`);
    } catch (err) {
      console.error(`❌ Failed to pay ${affiliate.email}:`, err);
    }
  }
}
