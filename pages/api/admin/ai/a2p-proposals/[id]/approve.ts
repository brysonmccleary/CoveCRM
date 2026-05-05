import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AdminAiActionProposal from "@/models/AdminAiActionProposal";
import { executeA2PResubmission } from "@/lib/a2p/a2pResubmissionExecutor";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const adminEmail = String(session?.user?.email || "").toLowerCase();
  if (!adminEmail) return res.status(401).json({ error: "Unauthorized" });
  if (adminEmail !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });

  await mongooseConnect();
  const proposal = await AdminAiActionProposal.findById(String(req.query.id || ""));
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  if (proposal.actionType !== "a2p_resubmission") return res.status(400).json({ error: "Unsupported proposal type" });

  proposal.status = "approved";
  proposal.createdBy = adminEmail;
  await proposal.save();

  const execution = await executeA2PResubmission({ proposalId: String(proposal._id), approvedBy: adminEmail });
  proposal.executionResult = execution as any;
  await proposal.save();

  return res.status(200).json({ ok: true, status: execution.status, execution, proposal });
}

