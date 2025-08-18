// /lib/billing/trackUsage.ts
import mongoose from "mongoose";
import User from "@/models/User";
import Stripe from "stripe";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
// Use the account's default API version to avoid TS literal mismatches
const stripe = STRIPE_KEY ? new Stripe(STRIPE_KEY) : null;

const isProd = process.env.NODE_ENV === "production";
const DEV_SKIP_BILLING = process.env.DEV_SKIP_BILLING === "1";

// Top-up settings
const TOPUP_AMOUNT_USD = 10; // $10 top-up when balance < $1
const TOPUP_AMOUNT_CENTS = TOPUP_AMOUNT_USD * 100;

/**
 * Ensures we have a real Mongoose document for the user
 */
async function ensureMongooseDoc(user: any) {
  if (!user) return null;

  // Already a Mongoose doc
  if (typeof user.save === "function") {
    return user;
  }

  // Try fetching by _id if available
  if (user._id && mongoose.isValidObjectId(user._id)) {
    const doc = await User.findById(user._id);
    if (doc) return doc;
  }

  // Try fetching by email
  if (user.email) {
    const doc = await User.findOne({ email: user.email });
    if (doc) return doc;
  }

  return null;
}

/**
 * Track Twilio/OpenAI usage. In dev, do not block for missing Stripe linkage.
 * In prod, requires stripeCustomerId and will try to auto-topup $10 when balance < $1.
 */
export async function trackUsage({
  user,
  amount,
  source = "twilio",
}: {
  user: any;
  amount: number;
  source?: "twilio" | "openai";
}) {
  // Ensure connected to DB
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI as string);
  }

  // Ensure we have a real Mongoose doc
  const userDoc = await ensureMongooseDoc(user);

  if (!userDoc) {
    if (isProd) throw new Error("User missing");
    console.warn("[DEV billing] No valid user doc. Skipping billing checks.");
    return;
  }

  // Hard freeze if balance too negative
  if ((userDoc.usageBalance || 0) < -20) {
    console.warn(`⛔ Usage frozen for ${userDoc.email} — balance too negative.`);
    if (isProd) throw new Error("Usage suspended. Please update your payment method.");
    return;
  }

  // Subtract usage & update totals
  userDoc.usageBalance = (userDoc.usageBalance || 0) - amount;
  userDoc.aiUsage = {
    ...userDoc.aiUsage,
    twilioCost: (userDoc.aiUsage?.twilioCost || 0) + (source === "twilio" ? amount : 0),
    openAiCost: (userDoc.aiUsage?.openAiCost || 0) + (source === "openai" ? amount : 0),
    totalCost: (userDoc.aiUsage?.totalCost || 0) + amount,
  };

  const canBill =
    !!stripe &&
    !!userDoc.stripeCustomerId &&
    !(DEV_SKIP_BILLING && isProd);

  // Missing Stripe linkage
  if (!userDoc.stripeCustomerId) {
    if (isProd) {
      throw new Error("User missing or not linked to Stripe");
    } else {
      console.warn("[DEV billing] User not linked to Stripe. Skipping auto-topup/charges.");
    }
  }

  // Auto-topup if needed
  if (userDoc.usageBalance < 1 && canBill) {
    try {
      // Create an invoice item for a fixed $10 (no Price object)
      await stripe!.invoiceItems.create({
        customer: userDoc.stripeCustomerId,
        amount: TOPUP_AMOUNT_CENTS,
        currency: "usd",
        description: `Cove CRM usage top-up ($${TOPUP_AMOUNT_USD})`,
      });

      // Create and auto-charge the invoice
      await stripe!.invoices.create({
        customer: userDoc.stripeCustomerId,
        collection_method: "charge_automatically",
        auto_advance: true,
      });

      userDoc.usageBalance += TOPUP_AMOUNT_USD;
      console.log(`💰 Auto-topup: $${TOPUP_AMOUNT_USD} charged to ${userDoc.email}`);
    } catch (err) {
      console.error("❌ Stripe auto top-up failed:", err);
    }
  } else if (userDoc.usageBalance < 1 && !canBill && !isProd) {
    console.warn("[DEV billing] Balance < $1 but billing disabled/unavailable; continuing for testing.");
  }

  await userDoc.save();
}
