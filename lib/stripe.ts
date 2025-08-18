// /lib/stripe.ts
import Stripe from "stripe";

/**
 * Shared Stripe client for all server-side code.
 * Do NOT pin apiVersion here — let the SDK use your account's default
 * to avoid TS literal mismatches during builds.
 */
const SECRET = process.env.STRIPE_SECRET_KEY;
if (!SECRET) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

export const stripe = new Stripe(SECRET, {
  // Optional: shows up in Stripe Dashboard logs as the client name
  appInfo: {
    name: "CoveCRM",
    version: process.env.npm_package_version ?? undefined,
  },
});

export type { Stripe };
