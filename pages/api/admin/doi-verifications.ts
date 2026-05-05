// pages/api/admin/doi-verifications.ts
// Admin endpoint for inspecting and overriding email verifications.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import EmailVerification from "@/models/EmailVerification";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email || session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    const status = req.query.status ? String(req.query.status) : "";
    const agentId = req.query.agentId ? String(req.query.agentId) : "";
    const filter: Record<string, any> = {};
    if (status) filter.verificationStatus = status;
    if (agentId) filter.agentId = agentId;

    const records = await EmailVerification.find(filter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({ verifications: records });
  }

  if (req.method === "POST") {
    const { id, decision, notes } = req.body || {};
    if (!id || !decision || !["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    if (decision === "approved") {
      await EmailVerification.updateOne(
        { _id: id },
        {
          $set: {
            manualDecision: "approved",
            manualNotes: notes || "",
            verificationStatus: "valid",
            smtpValid: true,
            confidenceScore: 95,
            verifiedAt: new Date(),
            reasonBucket: "",
            rejectionReason: "",
          },
        }
      );
    } else {
      await EmailVerification.updateOne(
        { _id: id },
        {
          $set: {
            manualDecision: "rejected",
            manualNotes: notes || "",
            verificationStatus: "invalid",
            smtpValid: false,
            confidenceScore: 5,
            verifiedAt: new Date(),
            reasonBucket: "manual_reject",
            rejectionReason: "manual_reject",
          },
        }
      );
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
