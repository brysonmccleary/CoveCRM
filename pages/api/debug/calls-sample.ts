import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = (await getServerSession(req, res, authOptions as any)) as
    | { user?: { email?: string | null } }
    | null;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const userEmail = String(session.user.email).toLowerCase();

  try { await dbConnect(); } catch {}

  const callSid = typeof req.query.callSid === "string" ? req.query.callSid : "";
  if (callSid) {
    const one = await (Call as any).findOne({ userEmail, callSid }).lean();
    return res.status(200).json({ one });
  }

  const last = await (Call as any)
    .find({ userEmail })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  // return only fields the dashboard uses so it’s easy to eyeball
  const trimmed = last.map((c: any) => ({
    callSid: c.callSid,
    direction: c.direction,
    startedAt: c.startedAt,
    completedAt: c.completedAt,
    createdAt: c.createdAt,
    duration: c.duration,
    talkTime: c.talkTime,
    amd: c.amd,
    ownerNumber: c.ownerNumber,
    otherNumber: c.otherNumber,
    status: c.status,
  }));

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ last: trimmed });
}
