// pages/api/facebook/subscription/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "next-auth/react";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession({ req });
  const email = session?.user?.email;

  // DEV BYPASS FOR BRYSON
  if (email === "bryson.mccleary1@gmail.com") {
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
