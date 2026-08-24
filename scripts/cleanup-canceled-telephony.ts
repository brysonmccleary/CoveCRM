import { config as loadEnv } from "dotenv";

loadEnv({ path: process.env.ENV_FILE || ".env.local" });
loadEnv({ path: ".env" });

const INTERNAL_EMAILS = new Set([
  "support@covecrm.com",
  "admin@covecrm.com",
  "bryson.mccleary1@gmail.com",
]);

async function main() {
  const [
    { default: dbConnect },
    { stripe },
    { findActiveCrmPlanSubscription, isPhoneNumberSubscription },
    { releaseUserPhoneNumbers },
    { default: User },
  ] = await Promise.all([
    import("@/lib/mongooseConnect"),
    import("@/lib/stripe"),
    import("@/lib/billing/stripePlanClassification"),
    import("@/lib/billing/releaseUserPhoneNumbers"),
    import("@/models/User"),
  ]);

  await dbConnect();
  const apply = process.env.APPLY === "1";
  const forcedEmails = new Set(
    String(process.env.FORCE_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

  for (const email of forcedEmails) {
    if (INTERNAL_EMAILS.has(email)) throw new Error(`Refusing to force-clean protected ${email}`);
  }

  const users = await User.find({
    $or: [
      { "numbers.0": { $exists: true } },
      { email: { $in: [...forcedEmails] } },
    ],
  })
    .select("_id email role isOwner numbers a2p twilio stripeCustomerId stripeSubscriptionId subscriptionStatus")
    .lean<any[]>();

  const plan: Array<{
    user: any;
    email: string;
    forced: boolean;
    crmSubscriptionIds: string[];
    phoneSubscriptionIds: string[];
  }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];

  // Build the entire immutable plan first. A Stripe read failure aborts the
  // whole run before any destructive operation can occur.
  for (const user of users) {
    const email = String(user.email || "").trim().toLowerCase();
    const forced = forcedEmails.has(email);
    if (!email || INTERNAL_EMAILS.has(email) || user.role === "admin" || user.isOwner === true) {
      skipped.push({ email, reason: "protected_internal_account" });
      continue;
    }

    let subscriptions: any[] = [];
    if (user.stripeCustomerId) {
      const response = await stripe.subscriptions.list({
        customer: String(user.stripeCustomerId),
        status: "all",
        limit: 100,
        expand: ["data.items.data.price"],
      });
      subscriptions = response.data;
    }
    const activeCrm = findActiveCrmPlanSubscription(subscriptions);
    if (activeCrm && !forced) {
      skipped.push({ email, reason: `active_crm:${activeCrm.id}` });
      continue;
    }
    const crmSubscriptionIds = subscriptions
      .filter((subscription) => {
        if (!forced || isPhoneNumberSubscription(subscription)) return false;
        return ["active", "trialing", "past_due", "incomplete"].includes(subscription.status);
      })
      .map((subscription) => subscription.id);
    const phoneSubscriptionIds = subscriptions
      .filter(
        (subscription) =>
          isPhoneNumberSubscription(subscription) &&
          ["active", "trialing", "past_due", "incomplete"].includes(subscription.status),
      )
      .map((subscription) => subscription.id);

    plan.push({ user, email, forced, crmSubscriptionIds, phoneSubscriptionIds });
  }

  console.log(JSON.stringify({ apply, targets: plan.map((item) => ({
    email: item.email,
    forced: item.forced,
    numbers: (item.user.numbers || []).map((number: any) => number.phoneNumber || number.sid),
    crmSubscriptionIds: item.crmSubscriptionIds,
    phoneSubscriptionIds: item.phoneSubscriptionIds,
    accountSid: item.user.twilio?.accountSid || null,
  })), skipped }, null, 2));

  if (!apply) return;

  const results: any[] = [];
  for (const target of plan) {
    if (target.forced) {
      for (const subscriptionId of target.crmSubscriptionIds) {
        await stripe.subscriptions.cancel(subscriptionId);
      }
      await User.updateOne(
        { _id: target.user._id },
        { $set: { subscriptionStatus: "canceled", cardOnFile: false } },
      );
    }

    let cleanup: any = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      cleanup = await releaseUserPhoneNumbers({
        userId: String(target.user._id),
        reason: target.forced ? "forced_dispute_cleanup" : "production_canceled_account_backfill",
        closeSubaccount: false,
        deleteMessagingServices: false,
      });
      if (cleanup.complete) break;
      console.warn(JSON.stringify({ email: target.email, attempt, failures: cleanup.failures }));
    }
    results.push({ email: target.email, cleanup });
  }

  console.log(JSON.stringify({ results }, null, 2));
  const incomplete = results.filter((item) => !item.cleanup?.complete);
  if (incomplete.length) throw new Error(`${incomplete.length} telephony cleanups remain incomplete`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
