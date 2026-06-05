/**
 * scripts/repair-billing-blocked-users.ts
 *
 * One-time repair: finds users who passed through the broken billing gate
 * (emailVerified=true, trialGranted=false, hasEverPaid=false, non-admin,
 * created after the enforcement date) and checks Stripe for a real payment method.
 *
 * For each such user:
 *   - If Stripe has NO stored payment method → mark callingBlocked=true, subscriptionStatus="pending"
 *   - If Stripe HAS a stored payment method → mark trialGranted=true, subscriptionStatus="active"
 *     so they can proceed without re-entering billing
 *
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/repair-billing-blocked-users.ts
 * Dry-run (no writes): DRY_RUN=1 npx ts-node ...
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

  // Find bad users: emailVerified but no card confirmation, created after enforcement
  const badUsers = await usersCol
    .find({
      emailVerified: true,
      trialGranted: { $ne: true },
      hasEverPaid: { $ne: true },
      role: { $ne: "admin" },
      createdAt: { $gte: ENFORCEMENT_STARTED_AT },
    })
    .toArray();

  console.log(`Found ${badUsers.length} users to audit\n`);

  const results = { hasCard: 0, noCard: 0, noStripeId: 0, errors: 0 };

  for (const user of badUsers) {
    const email = String(user.email || "").toLowerCase();
    const customerId = String(user.stripeCustomerId || user.stripeCustomerID || "").trim();

    process.stdout.write(`  ${email} ... `);

    if (!customerId) {
      console.log("⚠️  no Stripe customer ID — skipping");
      results.noStripeId++;
      continue;
    }

    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 1,
      });

      const hasCard = paymentMethods.data.length > 0;

      if (hasCard) {
        const pm = paymentMethods.data[0];
        const last4 = pm.card?.last4 || "????";
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
                callingBlocked: false,
              },
            }
          );
        }
      } else {
        console.log("❌ no card — blocking");
        results.noCard++;

        if (!DRY_RUN) {
          await usersCol.updateOne(
            { _id: user._id },
            {
              $set: {
                callingBlocked: true,
                subscriptionStatus: "pending",
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
  console.log(`  Had card (trial granted): ${results.hasCard}`);
  console.log(`  No card (blocked):        ${results.noCard}`);
  console.log(`  No Stripe ID (skipped):   ${results.noStripeId}`);
  console.log(`  Errors:                   ${results.errors}`);
  if (DRY_RUN) console.log("\n  (DRY RUN — no changes written)");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
