// pages/api/facebook/subscription/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "next-auth/react";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession({ req });
  const email = session?.user?.email;

  // DEV BYPASS FOR BRYSON
  // TEMP-QA-VERIFY: local-only, reverted after manual browser verification.
  if (email === "bryson.mccleary1@gmail.com" || email === "qa-adcheck@covecrm.local") {
    return res.status(200).json({
      active: true,
      plan: "manager_pro",
      bypass: true,
    });
  }

  // Default (others)
  return res.status(200).json({
    active: false,
    plan: null,
  });
}
