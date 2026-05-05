import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import AdminAiAuditLog from "@/models/AdminAiAuditLog";
import { maybeHandleA2PFailure } from "@/lib/a2p/a2pFailureAutomation";
import { isAdminAiDevBypassAllowed } from "@/lib/admin-ai/devAuth";
import { sendSupportEmail } from "@/lib/email/supportEmailProvider";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

async function isAllowed(req: NextApiRequest, res: NextApiResponse) {
  if (isAdminAiDevBypassAllowed(req)) return true;
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  const email = String(session?.user?.email || "").toLowerCase();
  return Boolean(email && email === ADMIN_EMAIL);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!(await isAllowed(req, res))) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const body = req.body || {};
  const userEmail = String(body.userEmail || "").toLowerCase().trim();
  const rejectionReason =
    String(body.rejectionReason || "").trim() ||
    "Campaign rejected: Missing opt-out language and insufficient opt-in description.";
  const sendEmail = body.sendEmail === true;

  if (!userEmail) return res.status(400).json({ error: "missing_userEmail" });
  const user = await (User as any).findOne({ email: userEmail }).lean();
  if (!user) {
    return res.status(404).json({
      error: "test_user_not_found",
      message: "Use an email that exists in local DB",
    });
  }

  const fakeA2PRecord = {
    userId: String(user._id),
    userEmail,
    businessName: user.businessName || user.name || "Test Business",
    website: user.website || "",
    registrationStatus: "rejected",
    applicationStatus: "declined",
    brandStatus: "FAILED",
    campaignStatus: "rejected",
    lastError: rejectionReason,
    declinedReason: rejectionReason,
    rejectionReason,
    sampleMessages: "Hi {{first_name}}, thanks for your interest. Reply STOP to opt out.",
    optInDetails: "Lead submitted a web form requesting information.",
    source: "simulate",
  };

  const result: any = await maybeHandleA2PFailure({
    userId: String(user._id),
    userEmail,
    a2pRecord: fakeA2PRecord,
    rejectionReason,
    source: "simulate",
  });

  let emailSendResult: any = null;
  const draft = result.emailDraft;
  if (sendEmail && draft) {
    emailSendResult = await sendSupportEmail({
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
    });
  } else if (sendEmail) {
    emailSendResult = { ok: false, code: "email_draft_missing", status: "email_draft_missing" };
  }

  const auditLogs = await AdminAiAuditLog.find({ userEmail })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  return res.status(200).json({
    ok: true,
    skipped: Boolean(result.skipped),
    proposal: result.proposal || null,
    emailDraft: result.emailDraft || null,
    auditLogIds: auditLogs.map((log: any) => String(log._id)),
    autoEligible: Boolean(result.autoEligible),
    classification: result.classification || result.proposal?.proposedPayload?.classification || "",
    confidence: result.confidence ?? result.proposal?.confidence ?? 0,
    emailSendResult,
  });
}
