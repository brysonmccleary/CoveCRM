// pages/api/ai-calls/scripts.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

type ScriptOption = {
  key: string;
  label: string;
  description?: string;
  leadType?: string;
  default?: boolean;
};

/**
 * ✅ IMPORTANT:
 * These keys MUST match what the voice server prompt builder understands.
 * We return ONLY canonical keys here to prevent “wrong script” drift.
 */
const SCRIPTS: ScriptOption[] = [
  {
    key: "mortgage_protection",
    label: "Mortgage Protection",
    description: "For leads who requested mortgage protection coverage.",
    leadType: "Mortgage Protection",
    default: true,
  },
  {
    key: "final_expense",
    label: "Life Insurance / Final Expense",
    description: "For general life insurance or final expense leads.",
    leadType: "Final Expense",
  },
  {
    key: "generic_life",
    label: "Generic Life Insurance",
    description: "Broad life insurance opener — works for any life insurance lead.",
    leadType: "Life Insurance",
  },
  {
    key: "iul_cash_value",
    label: "IUL / Cash Value",
    description: "For leads interested in indexed UL or cash value life insurance.",
    leadType: "IUL",
  },
  {
    key: "veteran_leads",
    label: "Veteran Programs",
    description: "Veteran-specific life insurance programs and benefits.",
    leadType: "Veteran",
  },
  {
    key: "trucker_leads",
    label: "Trucker / CDL",
    description: "Life insurance tailored to over-the-road truck drivers.",
    leadType: "Trucker",
  },
];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return res.status(200).json({ scripts: SCRIPTS });
}
