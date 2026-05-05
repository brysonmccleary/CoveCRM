import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import SupportEmailDraft from "@/models/SupportEmailDraft";
import { sendSupportEmail } from "@/lib/email/supportEmailProvider";
import { isAdminAiDevBypassAllowed } from "@/lib/admin-ai/devAuth";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let adminEmail = "dev-bypass";
  if (!isAdminAiDevBypassAllowed(req)) {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    adminEmail = String(session?.user?.email || "").toLowerCase();
    if (!adminEmail) return res.status(401).json({ error: "Unauthorized" });
    if (adminEmail !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });
  }

  await mongooseConnect();
  const draft = await SupportEmailDraft.findById(String(req.query.id || ""));
  if (!draft) return res.status(404).json({ error: "Draft not found" });

  const result = await sendSupportEmail({
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
  });

  if (!result.ok) {
    return res.status(200).json({ ok: false, status: result.status || result.code || "email_send_disabled", result });
  }

  draft.status = "sent";
  await draft.save();
  return res.status(200).json({ ok: true, status: "sent", draft });
}
