import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import AdminAiActionProposal from "@/models/AdminAiActionProposal";
import { maybeHandleA2PFailure } from "@/lib/a2p/a2pFailureAutomation";
import { isAdminAiDevBypassAllowed } from "@/lib/admin-ai/devAuth";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

async function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
  if (isAdminAiDevBypassAllowed(req)) return { ok: true as const, email: "dev-bypass" };
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const email = String(session?.user?.email || "").toLowerCase();
  if (!email) return { ok: false as const, status: 401, error: "Unauthorized" };
  if (email !== ADMIN_EMAIL) return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const, email };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireAdmin(req, res);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  await mongooseConnect();

  if (req.method === "GET") {
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

  if (req.method === "POST") {
    const userEmail = String((req.body || {})?.userEmail || "").toLowerCase().trim();
    if (!userEmail) return res.status(400).json({ error: "Missing userEmail" });

    const user = await (User as any).findOne({ email: userEmail }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    const a2pRecord = await A2PProfile.findOne({ userId: String(user._id) }).lean();
    if (!a2pRecord) return res.status(404).json({ error: "A2P profile not found" });

    const result = await maybeHandleA2PFailure({
      userId: String(user._id),
      userEmail,
      a2pRecord,
      rejectionReason: String((req.body || {})?.rejectionReason || ""),
      source: "admin_manual_rerun",
    });
    return res.status(200).json({ ok: true, result });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
