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
    description: "Protecting the home / payment, appointment-driven script.",
    leadType: "Mortgage Protection",
    default: true,
  },
  {
    key: "final_expense",
    label: "Final Expense",
    description: "Final expense script focused on booking a quick call.",
    leadType: "Final Expense",
  },
  {
    key: "iul_cash_value",
    label: "IUL (Cash Value Focus)",
    description: "Cash value, tax-free growth, retirement gap script.",
    leadType: "IUL",
  },
  {
    key: "veteran_leads",
    label: "Veteran Programs",
    description: "Veteran benefit-style script.",
    leadType: "Veteran",
  },
  {
    key: "trucker_leads",
    label: "Trucker / CDL",
    description: "Trucker lead script tailored to over-the-road drivers.",
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
