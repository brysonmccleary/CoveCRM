
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const intel = {
      trendingHooks: [
        "Do you own a home?",
        "Final expense costs are rising",
        "Veterans can qualify for benefits"
      ],
      bestPerformerAgeRange: "45-64",
      bestTimeOfDay: "Evenings",
      suggestedBudget: 30
    };

    return res.status(200).json(intel);
  } catch (err) {
    return res.status(500).json({ error: "Market intel error" });
  }
}
