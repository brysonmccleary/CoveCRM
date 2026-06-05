// pages/api/ai-calls/billing-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { requireBillingReady } from "@/lib/billing/requireBillingReady";

type BillingStatusResponse =
  | {
      ok: true;
      hasAiDialer: boolean; // ✅ access flag (entitlement)
      minutesRemaining: number;
      lastTopUpAt?: string | null;
      needsTopUp?: boolean;
    }
  | {
      ok: false;
      error: string;
    };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BillingStatusResponse>,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
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

    const billingReady = requireBillingReady(userDoc);
    const hasAiDialer = billingReady.ok && (userDoc as any).hasAI === true;

    return res.status(200).json({
      ok: true,
      hasAiDialer,
      minutesRemaining: hasAiDialer ? 999_999 : 0,
      lastTopUpAt: null,
      needsTopUp: false,
    });
  } catch (err) {
    console.error("AI Dialer billing-status error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to read AI Dialer billing status" });
  }
}
