// /pages/api/debug/a2p-state.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile, { IA2PProfile } from "@/models/A2PProfile";

/**
 * GET /api/debug/a2p-state?email=...&token=CRON_SECRET
 *
 * - If token matches CRON_SECRET, no session required (for CLI checks).
 * - Otherwise requires a logged-in session (returns only current user's info).
 *
 * Response shape (example):
 * {
 *   email: "test@example.com",
 *   userId: "....",
 *   numbersCount: 1,
 *   msFromNumbers: ["MGxxxx"],
 *   a2pSummary: {
 *     messagingReady: true,
 *     registrationStatus: "campaign_approved",
 *     applicationStatus: "approved",
 *     brandSid: "BNxxxx",
 *     brandStatus: "APPROVED",
 *     brandFailureReason: null,
 *     usa2pSid: "QExxxx",
 *     messagingServiceSid: "MGxxxx",
 *     declinedReason: null,
 *     lastSyncedAt: "2025-11-24T03:50:20.865Z"
 *   },
 *   updatedAt: "2025-11-25T20:15:00.000Z"
 * }
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  const token = typeof req.query.token === "string" ? req.query.token : "";
  const usingToken = token && token === process.env.CRON_SECRET;

  const session = await getServerSession(req, res, authOptions);
  const sessionEmail = session?.user?.email?.toLowerCase() || null;

  const queryEmail = String(req.query.email || "").toLowerCase() || null;

  if (!usingToken && !sessionEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const email = usingToken ? queryEmail || sessionEmail : sessionEmail;
  if (!email) return res.status(400).json({ error: "Missing email" });

  try {
    await dbConnect();

    const user = await User.findOne({ email }).lean<any>();
    if (!user) return res.status(404).json({ error: "User not found" });

    const userId = String(user._id);

    // Pull latest A2PProfile for this user (single profile per userId)
    const a2pDoc = await A2PProfile.findOne({ userId }).lean<IA2PProfile | null>();

    const numbers = Array.isArray(user.numbers) ? user.numbers : [];

    // Build a compact summary for quick CLI checks / dashboards
    const a2pSummary = a2pDoc
      ? {
          messagingReady: !!a2pDoc.messagingReady,
          registrationStatus: a2pDoc.registrationStatus || "not_started",
          applicationStatus: a2pDoc.applicationStatus || "pending",
          brandSid: a2pDoc.brandSid || null,
          brandStatus: a2pDoc.brandStatus || null,
          brandFailureReason: a2pDoc.brandFailureReason || null,
          usa2pSid: (a2pDoc as any).usa2pSid || a2pDoc.campaignSid || null,
          messagingServiceSid: a2pDoc.messagingServiceSid || null,
          declinedReason: a2pDoc.declinedReason || null,
          lastSyncedAt: a2pDoc.lastSyncedAt || a2pDoc.updatedAt || null,
        }
      : null;

    return res.status(200).json({
      email,
      userId,
      numbersCount: numbers.length,
      msFromNumbers: numbers
        .map((n: any) => n?.messagingServiceSid)
        .filter(Boolean),
      a2pSummary,
      // raw document for deep debugging (can hide later if you want)
      a2pProfile: a2pDoc,
      updatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[debug/a2p-state] error:", e);
    return res.status(500).json({ error: e?.message || "lookup failed" });
  }
}
