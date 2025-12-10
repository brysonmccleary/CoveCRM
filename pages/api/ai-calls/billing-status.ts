// pages/api/ai-calls/billing-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

type BillingStatusResponse =
  | {
      ok: true;
      hasAiDialer: boolean;
      minutesRemaining: number;
      lastTopUpAt?: string | null;
    }
  | {
      ok: false;
      error: string;
    };

// Default $0.15/minute if env not set
const RATE_PER_MINUTE = Number(
  process.env.AI_DIALER_BILL_RATE_PER_MINUTE || "0.15",
);

// 🔹 Owner / admin-free emails: Bryson hard-coded + optional env list
const OWNER_FREE_EMAILS: string[] = [
  "bryson.mccleary1@gmail.com",
  ...(process.env.ADMIN_FREE_AI_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
];

const isOwnerFree = (email: string) =>
  OWNER_FREE_EMAILS.includes(String(email || "").toLowerCase());

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BillingStatusResponse>,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // Typed session so TS knows about session.user.email
    const session = (await getServerSession(
      req,
      res,
      authOptions as any,
    )) as { user?: { email?: string | null } } | null;

    if (!session?.user?.email) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    await mongooseConnect();

    const email = String(session.user.email).toLowerCase();
    const userDoc = await User.findOne({ email }).lean();

    if (!userDoc) {
      return res
        .status(404)
        .json({ ok: false, error: "User not found for AI billing" });
    }

    // 🔹 Bryson / owner accounts: always have AI Dialer enabled + effectively infinite minutes.
    if (isOwnerFree(email)) {
      return res.status(200).json({
        ok: true,
        hasAiDialer: true,
        minutesRemaining: 999_999, // effectively "unlimited" for UI purposes
        lastTopUpAt: null,
      });
    }

    const anyUser = userDoc as any;

    const balanceUSD = Number(anyUser.aiDialerBalance || 0);
    const minutes =
      balanceUSD > 0 && RATE_PER_MINUTE > 0
        ? balanceUSD / RATE_PER_MINUTE
        : 0;

    const minutesRemaining = isNaN(minutes) ? 0 : minutes;
    const hasAiDialer = minutesRemaining > 0;

    const lastTopUpAt =
      anyUser.aiDialerLastTopUpAt instanceof Date
        ? anyUser.aiDialerLastTopUpAt.toISOString()
        : null;

    return res.status(200).json({
      ok: true,
      hasAiDialer,
      minutesRemaining,
      lastTopUpAt,
    });
  } catch (err) {
    console.error("AI Dialer billing-status error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to read AI Dialer billing status" });
  }
}
