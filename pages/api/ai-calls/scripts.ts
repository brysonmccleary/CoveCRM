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

const SCRIPTS: ScriptOption[] = [
  {
    key: "fex_default",
    label: "Final Expense – Default",
    description: "Jeremy-style FE script focused on booking a quick call.",
    leadType: "Final Expense",
    default: true,
  },
  {
    key: "mortgage_protection",
    label: "Mortgage Protection",
    description: "Protecting the home / payment, appointment-driven script.",
    leadType: "Mortgage Protection",
  },
  {
    key: "iul",
    label: "IUL – Cash Value Focus",
    description: "Cash value, tax-free growth, retirement gap script.",
    leadType: "IUL",
  },
  {
    key: "veterans",
    label: "Veteran Programs",
    description: "Veteran benefit-style script.",
    leadType: "Veteran",
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
