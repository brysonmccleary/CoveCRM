// /lib/stripe.ts
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

// Do NOT pass apiVersion — let the SDK use the account default to avoid TS literal mismatches
export const stripe = new Stripe(STRIPE_SECRET_KEY);
