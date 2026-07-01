// Read-only diagnostic: reports whether the global Stripe billing kill switch
// is active in this deployment. Exposes booleans and the deployed commit only.
import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({
    ok: true,
    stripeWritesDisabled: process.env.DISABLE_ALL_STRIPE_BILLING === "1",
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    env: process.env.VERCEL_ENV || null,
  });
}
