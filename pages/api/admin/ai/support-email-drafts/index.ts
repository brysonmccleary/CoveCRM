import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import SupportEmailDraft from "@/models/SupportEmailDraft";
import { isSupportEmailSendEnabled } from "@/lib/email/supportEmailProvider";
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
    const status = String(req.query.status || "draft");
    const drafts = await SupportEmailDraft.find(status === "all" ? {} : { status })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    return res.status(200).json({ ok: true, drafts, supportEmailSendEnabled: isSupportEmailSendEnabled() });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const userId = String(body.userId || "").trim();
    const userEmail = String(body.userEmail || "").toLowerCase().trim();
    const to = String(body.to || userEmail).toLowerCase().trim();
    const subject = String(body.subject || "").trim();
    const emailBody = String(body.body || "").trim();
    if (!userId || !userEmail || !to || !subject || !emailBody) {
      return res.status(400).json({ error: "Missing required draft fields" });
    }
    const draft = await SupportEmailDraft.create({
      userId,
      userEmail,
      to,
      subject,
      body: emailBody,
      source: "a2p_failure",
      status: "draft",
      relatedProposalId: body.relatedProposalId ? String(body.relatedProposalId) : undefined,
    });
    return res.status(200).json({ ok: true, draft });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
