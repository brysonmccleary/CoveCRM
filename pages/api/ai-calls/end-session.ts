// pages/api/ai-calls/end-session.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";
import { Types } from "mongoose";

type Response =
  | { ok: false; message: string }
  | { ok: true; session: any | null };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Response>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!email) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  try {
    await mongooseConnect();
    const { sessionId } = req.body as { sessionId?: string };

    if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
      return res
        .status(400)
        .json({ ok: false, message: "Valid sessionId is required" });
    }

    const doc = await AICallSession.findOne({
      _id: sessionId,
      userEmail: email,
    }).exec();

    if (!doc) {
      return res.status(404).json({ ok: false, message: "Session not found" });
    }

    doc.status = "stopped";
    doc.completedAt = new Date();
    await doc.save();

    return res.status(200).json({ ok: true, session: doc.toJSON() });
  } catch (err) {
    console.error("End AI session error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Failed to end AI dial session" });
  }
}
