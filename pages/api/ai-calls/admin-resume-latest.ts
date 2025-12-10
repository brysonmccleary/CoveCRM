// pages/api/ai-calls/admin-resume-latest.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";

const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();

/**
 * Dev-only helper:
 * - Finds the most recent AICallSession
 * - Forces it back to `queued` with lastIndex = -1, clears completedAt/error
 *
 * Safety:
 * - Disabled in production
 * - Can be called either:
 *   1) As an authenticated user (NextAuth session), or
 *   2) With ?key=AI_DIALER_CRON_KEY or x-cron-key header (for curl)
 *
 * This does NOT touch any existing CRM logic or endpoints.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Extra safety: never allow this in production
  if (process.env.NODE_ENV === "production") {
    return res
      .status(403)
      .json({ ok: false, error: "admin-resume-latest disabled in production" });
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed. Use POST." });
  }

  // Try normal auth first (typed so TS knows session.user exists)
  const session = (await getServerSession(
    req,
    res,
    authOptions as any
  )) as { user?: { email?: string | null } } | null;

  let userEmail: string | null =
    session?.user?.email != null
      ? String(session.user.email).toLowerCase()
      : null;

  // If no logged-in user, allow dev access via AI_DIALER_CRON_KEY (same as worker)
  if (!userEmail) {
    if (!AI_DIALER_CRON_KEY) {
      return res.status(500).json({
        ok: false,
        error: "AI_DIALER_CRON_KEY not configured.",
      });
    }

    const hdrKey = (req.headers["x-cron-key"] ||
      req.headers["x-cron-secret"] ||
      "") as string;

    const qsKey =
      (req.query.key as string | undefined) ||
      (req.query.token as string | undefined) ||
      "";

    const providedKey = (hdrKey || qsKey || "").trim();

    if (!providedKey || providedKey !== AI_DIALER_CRON_KEY) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized (missing session and invalid dev key).",
      });
    }

    // Optional: allow ?userEmail=... when using key
    const qsEmail =
      (req.query.userEmail as string | undefined)?.toLowerCase().trim() || null;
    userEmail = qsEmail;
  }

  await mongooseConnect();

  // If we have a userEmail, limit to that user. Otherwise, use the most recent session overall.
  const query: any = {};
  if (userEmail) {
    query.userEmail = userEmail;
  }

  const latest: any = await AICallSession.findOne(query)
    .sort({ createdAt: -1 })
    .exec();

  if (!latest) {
    return res.status(404).json({
      ok: false,
      error: "No AI call sessions found for this scope.",
    });
  }

  latest.status = "queued";
  latest.lastIndex = -1;
  latest.startedAt = null;
  latest.completedAt = null;
  latest.errorMessage = null;

  await latest.save();

  return res.status(200).json({
    ok: true,
    message: "Latest AI call session reset to queued.",
    session: {
      _id: String(latest._id),
      status: latest.status,
      total: latest.total,
      leadCount: Array.isArray(latest.leadIds) ? latest.leadIds.length : 0,
      lastIndex: latest.lastIndex,
      folderId: String(latest.folderId || ""),
      fromNumber: latest.fromNumber,
      scriptKey: latest.scriptKey,
      voiceKey: latest.voiceKey,
      startedAt: latest.startedAt,
      completedAt: latest.completedAt,
      errorMessage: latest.errorMessage,
      userEmail: latest.userEmail,
    },
  });
}
