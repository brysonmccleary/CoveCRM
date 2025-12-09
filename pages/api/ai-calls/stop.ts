// pages/api/ai-calls/stop.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";

function getAiServerBase() {
  const raw =
    process.env.AI_VOICE_STREAM_URL ||
    process.env.AI_VOICE_SERVER_URL ||
    "";
  return raw.replace(/\/+$/, "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = (await getServerSession(
    req,
    res,
    authOptions as any
  )) as Session | null;

  const userEmail = String(session?.user?.email ?? "").toLowerCase();
  if (!userEmail) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { sessionId } = (req.body || {}) as { sessionId?: string };

  try {
    await dbConnect();
  } catch (e) {
    console.error("AI stop dbConnect error:", e);
    // continue anyway – we'll still try to stop remote AI server
  }

  // 1) Find the session to stop
  let aiSession = null;

  if (sessionId) {
    aiSession = await AICallSession.findOne({
      _id: sessionId,
      userEmail,
    });
  } else {
    // fallback: most recent active session for this user
    aiSession = await AICallSession.findOne({
      userEmail,
      status: { $in: ["queued", "running", "paused"] },
    }).sort({ createdAt: -1 });
  }

  if (!aiSession) {
    return res.status(404).json({
      ok: false,
      error: "No active AI dial session found for this user",
    });
  }

  const now = new Date();

  // 2) Mark as completed in Mongo so the UI / schedulers stop using it
  aiSession.status = "completed";
  aiSession.completedAt = now;
  aiSession.errorMessage = null;
  await aiSession.save();

  // 3) Best-effort notify the AI voice server to stop
  const base = getAiServerBase();
  if (base) {
    try {
      await fetch(`${base}/stop-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          sessionId: String(aiSession._id),
        }),
      });
    } catch (e) {
      console.error("AI stop remote error:", e);
      // don't fail the request – user should still see the session as ended
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    sessionId: aiSession._id,
    status: aiSession.status,
  });
}
