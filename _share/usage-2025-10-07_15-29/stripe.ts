// lib/stripe.ts
import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set");
}

// Use the account default API version to avoid literal-type mismatches
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export type { Stripe };
