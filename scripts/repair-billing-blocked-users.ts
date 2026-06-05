/**
 * scripts/repair-billing-blocked-users.ts
 *
 * Repairs users who have emailVerified=true but trialGranted=false — meaning they
 * never completed the card setup step, OR got hasEverPaid=true from a $0 trial invoice
 * before a card was attached (the root cause for Tony Garcia / Steven Hilborn).
 *
 * Query: all recent (post-enforcement), non-admin, emailVerified users where
 *        trialGranted !== true — regardless of hasEverPaid.
 *
 * Per user, checks Stripe for a stored payment method:
 *   No card  → hasEverPaid=false, trialGranted=false, subscriptionStatus="pending",
 *               billingBlocked=true, billingBlockedReason="missing_payment_method",
 *               callingBlocked=true
 *   Has card → trialGranted=true, subscriptionStatus="active",
 *               billingBlocked=false, billingBlockedReason=null, callingBlocked=false
 *
 * Dry-run:  DRY_RUN=1 npm run repair:billing:dry
 * Write:    npm run repair:billing
 */

import { config } from "dotenv";
config();

import Stripe from "stripe";
import mongoose from "mongoose";

const ENFORCEMENT_STARTED_AT = new Date(
  process.env.ACCOUNT_ACTIVATION_ENFORCEMENT_STARTED_AT || "2026-04-10T00:00:00.000Z"
);

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ MONGODB_URI not set");
    process.exit(1);
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error("❌ STRIPE_SECRET_KEY not set");
    process.exit(1);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" as any });

  await mongoose.connect(mongoUri);
  console.log("✅ Connected to MongoDB");
  if (DRY_RUN) console.log("🔍 DRY RUN — no writes will be made\n");

  const db = mongoose.connection.db!;
  const usersCol = db.collection("users");

  // Audit recent non-admin emailVerified users where trialGranted !== true,
  // excluding users already fully repaired by a previous run.
  const candidates = await usersCol
    .find({
      emailVerified: true,
      trialGranted: { $ne: true },
      role: { $ne: "admin" },
      createdAt: { $gte: ENFORCEMENT_STARTED_AT },
      $nor: [
        {
          billingBlocked: true,
          billingBlockedReason: "missing_payment_method",
          subscriptionStatus: "pending",
          callingBlocked: true,
          hasEverPaid: false,
        },
      ],
    })
    .toArray();

  console.log(`Found ${candidates.length} users to audit\n`);

  const results = { hasCard: 0, noCard: 0, noStripeId: 0, errors: 0 };
  const poisoned: string[] = []; // users with hasEverPaid=true but no card (Tony/Steven pattern)

  for (const user of candidates) {
    const email = String(user.email || "").toLowerCase();
    const customerId = String(user.stripeCustomerId || user.stripeCustomerID || "").trim();
    const hadHasEverPaid = user.hasEverPaid === true;

    process.stdout.write(`  ${email}${hadHasEverPaid ? " [hasEverPaid=true ⚠️]" : ""} ... `);

    if (!customerId) {
      console.log("⚠️  no Stripe customer ID — skipping");
      results.noStripeId++;
      continue;
    }

    try {
      // Check both the default payment method on the customer AND listed card methods.
      let hasCard = false;
      let last4 = "????";

      const customer = await stripe.customers.retrieve(customerId) as any;
      const defaultPm = customer?.invoice_settings?.default_payment_method;

      if (defaultPm && typeof defaultPm === "string") {
        hasCard = true;
        try {
          const pm = await stripe.paymentMethods.retrieve(defaultPm);
          last4 = pm.card?.last4 || "????";
        } catch { /* last4 stays ???? */ }
      }

      if (!hasCard) {
        const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
        if (list.data.length > 0) {
          hasCard = true;
          last4 = list.data[0].card?.last4 || "????";
        }
      }

      if (hasCard) {
        console.log(`✅ card on file (*${last4}) — granting trial`);
        results.hasCard++;

        if (!DRY_RUN) {
          await usersCol.updateOne(
            { _id: user._id },
            {
              $set: {
                trialGranted: true,
                trialActivatedAt: new Date(),
                subscriptionStatus: "active",
                billingBlocked: false,
                billingBlockedReason: null,
                callingBlocked: false,
              },
            }
          );
        }
      } else {
        if (hadHasEverPaid) {
          poisoned.push(email);
          console.log("❌ no card — blocking (hasEverPaid was poisoned by $0 invoice)");
        } else {
          console.log("❌ no card — blocking");
        }
        results.noCard++;

        if (!DRY_RUN) {
          await usersCol.updateOne(
            { _id: user._id },
            {
              $set: {
                hasEverPaid: false,
                trialGranted: false,
                subscriptionStatus: "pending",
                billingBlocked: true,
                billingBlockedReason: "missing_payment_method",
                callingBlocked: true,
              },
            }
          );
        }
      }
    } catch (err: any) {
      console.log(`⛔ Stripe error: ${err?.message || err}`);
      results.errors++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`  Had card (trial granted):          ${results.hasCard}`);
  console.log(`  No card (blocked):                 ${results.noCard}`);
  console.log(`  No Stripe ID (skipped):            ${results.noStripeId}`);
  console.log(`  Errors:                            ${results.errors}`);
  if (poisoned.length > 0) {
    console.log(`\n  ⚠️  Poisoned hasEverPaid users (${poisoned.length}):`);
    poisoned.forEach((e) => console.log(`    - ${e}`));
  }
  if (DRY_RUN) console.log("\n  (DRY RUN — no changes written)");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
