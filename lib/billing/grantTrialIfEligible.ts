import Stripe from "stripe";
import User from "@/models/User";

type GrantResult = {
  ok: boolean;
  granted: boolean;
  reason?: string;
  stripeCardFingerprint?: string | null;
};

async function getCardFingerprint(stripe: Stripe, customerId: string): Promise<string | null> {
  const customer = await stripe.customers.retrieve(customerId);
  const defaultPaymentMethod =
    typeof (customer as any)?.invoice_settings?.default_payment_method === "string"
      ? (customer as any).invoice_settings.default_payment_method
      : null;

  if (defaultPaymentMethod) {
    const paymentMethod = await stripe.paymentMethods.retrieve(defaultPaymentMethod);
    return paymentMethod.card?.fingerprint || null;
  }

  const methods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 1,
  });

  return methods.data[0]?.card?.fingerprint || null;
}

export async function grantTrialIfEligible(user: any, stripe: Stripe): Promise<GrantResult> {
  if (!user?._id) return { ok: false, granted: false, reason: "user_not_found" };
  if ((user as any).role === "admin") return { ok: true, granted: true, reason: "admin_bypass" };
  if ((user as any).trialGranted === true) {
    return {
      ok: true,
      granted: true,
      reason: "already_granted",
      stripeCardFingerprint: (user as any).stripeCardFingerprint || null,
    };
  }

  if ((user as any).emailVerified !== true) {
    await User.updateOne({ _id: user._id }, { $set: { trialBlockedReason: "email_not_verified" } });
    return { ok: false, granted: false, reason: "email_not_verified" };
  }

  const email = String((user as any).email || "").toLowerCase();
  const customerId = String((user as any).stripeCustomerId || "").trim();
  if (!customerId) {
    await User.updateOne({ _id: user._id }, { $set: { trialBlockedReason: "missing_stripe_customer" } });
    return { ok: false, granted: false, reason: "missing_stripe_customer" };
  }

  let fingerprint: string | null = null;
  try {
    fingerprint = await getCardFingerprint(stripe, customerId);
  } catch (err: any) {
    console.error("[grantTrialIfEligible] Stripe payment method lookup failed:", err?.message || err);
    await User.updateOne({ _id: user._id }, { $set: { trialBlockedReason: "stripe_lookup_failed" } });
    return { ok: false, granted: false, reason: "stripe_lookup_failed" };
  }

  if (!fingerprint) {
    await User.updateOne({ _id: user._id }, { $set: { trialBlockedReason: "missing_payment_method" } });
    return { ok: false, granted: false, reason: "missing_payment_method" };
  }

  const emailUsed = await User.findOne({
    _id: { $ne: user._id },
    email,
    trialGranted: true,
  })
    .select({ _id: 1 })
    .lean();

  if (emailUsed) {
    await User.updateOne(
      { _id: user._id },
      { $set: { stripeCardFingerprint: fingerprint, trialBlockedReason: "email_already_used" } }
    );
    return { ok: false, granted: false, reason: "email_already_used", stripeCardFingerprint: fingerprint };
  }

  const cardUsed = await User.findOne({
    _id: { $ne: user._id },
    stripeCardFingerprint: fingerprint,
    trialGranted: true,
  })
    .select({ _id: 1 })
    .lean();

  if (cardUsed) {
    await User.updateOne(
      { _id: user._id },
      { $set: { stripeCardFingerprint: fingerprint, trialBlockedReason: "card_already_used" } }
    );
    return { ok: false, granted: false, reason: "card_already_used", stripeCardFingerprint: fingerprint };
  }

  const trialCreditDollars = Math.max(
    0,
    Number(process.env.TRIAL_USAGE_CREDIT_DOLLARS || "0") || 0
  );

  const update: any = {
    $set: {
      stripeCardFingerprint: fingerprint,
      trialGranted: true,
      trialActivatedAt: new Date(),
      trialEmailUsed: true,
      trialBlockedReason: null,
    },
  };
  if (trialCreditDollars > 0) update.$inc = { usageBalance: trialCreditDollars };

  const result = await User.updateOne({ _id: user._id, trialGranted: { $ne: true } }, update);

  if ((result as any).modifiedCount === 0) {
    const fresh = await User.findById(user._id).select({ trialGranted: 1, stripeCardFingerprint: 1 }).lean();
    return {
      ok: Boolean((fresh as any)?.trialGranted),
      granted: Boolean((fresh as any)?.trialGranted),
      reason: (fresh as any)?.trialGranted ? "already_granted" : "not_granted",
      stripeCardFingerprint: (fresh as any)?.stripeCardFingerprint || fingerprint,
    };
  }

  return { ok: true, granted: true, stripeCardFingerprint: fingerprint };
}
