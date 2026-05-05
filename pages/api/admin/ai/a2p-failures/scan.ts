import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { detectA2PFailure, maybeHandleA2PFailure } from "@/lib/a2p/a2pFailureAutomation";
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const admin = await requireAdmin(req, res);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  await mongooseConnect();
  const body = req.body || {};

  if (body.forceTest === true) {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "force_test_not_allowed_in_production" });
    }
    const testUserEmail = String(body.testUserEmail || "").toLowerCase().trim();
    const testRejectionReason =
      String(body.testRejectionReason || "").trim() ||
      "Campaign rejected: Missing opt-out language and insufficient opt-in description.";
    if (!testUserEmail) return res.status(400).json({ error: "missing_testUserEmail" });

    const user = await (User as any).findOne({ email: testUserEmail }).lean();
    if (!user) {
      return res.status(404).json({
        error: "test_user_not_found",
        message: "Use an email that exists in local DB",
      });
    }

    const fakeA2PRecord = {
      userId: String(user._id),
      userEmail: testUserEmail,
      businessName: user.businessName || user.name || "Test Business",
      website: user.website || "",
      registrationStatus: "rejected",
      applicationStatus: "declined",
      brandStatus: "FAILED",
      campaignStatus: "rejected",
      lastError: testRejectionReason,
      declinedReason: testRejectionReason,
      rejectionReason: testRejectionReason,
      sampleMessages: "Hi {{first_name}}, thanks for your interest. Reply STOP to opt out.",
      optInDetails: "Lead submitted a web form requesting information.",
      source: "force_test",
    };

    const result: any = await maybeHandleA2PFailure({
      userId: String(user._id),
      userEmail: testUserEmail,
      a2pRecord: fakeA2PRecord,
      rejectionReason: testRejectionReason,
      source: "force_test",
    });

    return res.status(200).json({
      ok: true,
      mode: "force_test",
      created: !result.skipped,
      skipped: Boolean(result.skipped),
      proposalId: result.proposalId || "",
      emailDraftId: result.emailDraftId || "",
      autoEligible: Boolean(result.autoEligible),
      classification: result.classification || result.proposal?.proposedPayload?.classification || "",
      confidence: result.confidence ?? result.proposal?.confidence ?? 0,
      result,
    });
  }

  const limit = Math.max(1, Math.min(100, Number((req.body || {})?.limit || 50)));
  const sinceDays = Math.max(1, Math.min(90, Number((req.body || {})?.sinceDays || 30)));
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const records = await A2PProfile.find({
    updatedAt: { $gte: since },
    $or: [
      { registrationStatus: "rejected" },
      { applicationStatus: "declined" },
      { brandStatus: { $in: ["FAILED", "REJECTED", "failed", "rejected", "NOT_FOUND"] } },
      { campaignStatus: { $in: ["FAILED", "REJECTED", "failed", "rejected"] } },
      { lastError: { $exists: true, $ne: "" } },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(limit);

  const summary = {
    scanned: records.length,
    failedDetected: 0,
    proposalsCreatedOrUpdated: 0,
    emailDraftsCreatedOrFound: 0,
    skipped: 0,
    errors: [] as Array<{ id: string; error: string }>,
    results: [] as any[],
  };

  for (const record of records) {
    const detection = detectA2PFailure({ userId: String(record.userId), userEmail: record.userEmail }, record);
    if (!detection.failed) {
      summary.skipped++;
      continue;
    }
    summary.failedDetected++;
    try {
      const result = await maybeHandleA2PFailure(
        { userId: String(record.userId), userEmail: record.userEmail },
        record.toObject ? record.toObject() : record
      );
      if (!result.skipped) {
        summary.proposalsCreatedOrUpdated++;
        summary.emailDraftsCreatedOrFound++;
      }
      summary.results.push({ a2pProfileId: String(record._id), ...result });
    } catch (err: any) {
      summary.errors.push({ id: String(record._id), error: String(err?.message || err).slice(0, 180) });
    }
  }

  return res.status(200).json({ ok: true, ...summary });
}
