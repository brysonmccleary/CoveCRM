import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AdminAiActionProposal from "@/models/AdminAiActionProposal";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const email = String(session?.user?.email || "").toLowerCase();
  if (!email) return res.status(401).json({ error: "Unauthorized" });
  if (email !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });

  await mongooseConnect();
  const status = String(req.query.status || "pending");
  const proposals = await AdminAiActionProposal.find({
    actionType: "a2p_resubmission",
    source: "a2p_failure_detector",
    ...(status === "all" ? {} : { status }),
  })
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  return res.status(200).json({ ok: true, proposals });
}

