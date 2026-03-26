// pages/api/email/send-one.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { sendEmailWithTracking } from "@/lib/email/sendEmail";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();

  const { leadId, to, subject, html, text, replyTo, fromName, from } =
    req.body || {};

  if (!leadId || !to || !subject || !html) {
    return res
      .status(400)
      .json({ error: "leadId, to, subject, and html are required" });
  }

  await mongooseConnect();

  const user = await User.findOne({ email: userEmail }).select("_id").lean();
  if (!user?._id) return res.status(404).json({ error: "User not found" });

  const result = await sendEmailWithTracking({
    userId: user._id,
    userEmail,
    leadId,
    to,
    from,
    fromName,
    replyTo,
    subject,
    html,
    text,
  });

  if (result.suppressed) {
    return res.status(200).json({ ok: false, suppressed: true });
  }
  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }

  return res.status(200).json({
    ok: true,
    messageId: result.messageId,
    emailMessageId: result.emailMessageId,
  });
}
