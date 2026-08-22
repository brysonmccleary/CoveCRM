import "dotenv/config";
import crypto from "crypto";
import mongoose from "mongoose";
import { createMocks } from "node-mocks-http";

type CheckResult = { name: string; ok: boolean; details?: string };
const results: CheckResult[] = [];

function check(name: string, condition: unknown, details?: string): asserts condition {
  results.push({ name, ok: !!condition, details });
  const output = `${condition ? "PASS" : "FAIL"} ${name}${details ? ` - ${details}` : ""}`;
  (condition ? console.log : console.error)(output);
  if (!condition) throw new Error(output);
}

function normalizeUri(uri: string) {
  return uri.trim().replace(/\/+$/, "");
}

async function invoke(handler: any, options: Parameters<typeof createMocks>[0]) {
  const { req, res } = createMocks(options);
  await handler(req, res);
  return { status: res._getStatusCode(), body: res._getJSONData() };
}

async function main() {
  const testUri = process.env.MONGODB_URI_TEST || "";
  const prodUri = process.env.MONGODB_URI || "";
  check("MONGODB_URI_TEST present", !!testUri);
  check(
    "isolated test database",
    normalizeUri(testUri) !== normalizeUri(prodUri),
    "refusing to run against production DB",
  );

  process.env.MONGODB_URI = testUri;
  process.env.MONGODB_DBNAME = process.env.MONGODB_DBNAME_TEST || process.env.MONGODB_DBNAME || undefined;
  process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "hosted-funnel-simulation-secret";
  process.env.NEXT_PUBLIC_APP_URL = "https://www.covecrm.com";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ ok: true, mocked: true })) as typeof fetch;

  const timestamp = Date.now();
  const userEmail = `hosted-flow-test-${timestamp}@example.test`;
  const webhookKey = crypto.randomBytes(24).toString("hex");
  const standardPhone = `520${String(timestamp).slice(-7)}`;
  const otpPhone = `602${String(timestamp + 1).slice(-7)}`;

  const mongooseConnect = (await import("../lib/mongooseConnect")).default;
  const User = (await import("../models/User")).default;
  const Folder = (await import("../models/Folder")).default;
  const FBLeadCampaign = (await import("../models/FBLeadCampaign")).default;
  const FBLeadEntry = (await import("../models/FBLeadEntry")).default;
  const Lead = (await import("../models/Lead")).default;
  const FunnelOTPSession = (await import("../models/FunnelOTPSession")).default;
  const FunnelSubmission = (await import("../models/FunnelSubmission")).default;
  const SmsConsentEvidence = (await import("../models/SmsConsentEvidence")).default;
  const MetaCAPIEvent = (await import("../models/MetaCAPIEvent")).default;
  const { FUNNEL_TEMPLATES, getFunnelTemplate } = await import("../lib/facebook/funnels/funnelTemplates");
  const submitHandler = (await import("../pages/api/facebook/funnel-submit")).default;
  const verifyOtpHandler = (await import("../pages/api/funnel/verify-otp")).default;

  let campaignIds: mongoose.Types.ObjectId[] = [];
  try {
    await mongooseConnect();
    await Promise.all([
      User.deleteMany({ email: userEmail }),
      Folder.deleteMany({ userEmail }),
      FBLeadCampaign.deleteMany({ userEmail }),
      FBLeadEntry.deleteMany({ userEmail }),
      Lead.deleteMany({ userEmail }),
      FunnelSubmission.deleteMany({ userEmail }),
      SmsConsentEvidence.deleteMany({ userEmail }),
      MetaCAPIEvent.deleteMany({ userEmail }),
    ]);

    const expectedTemplates = [
      ["final_expense", "standard"],
      ["mortgage_protection", "standard"],
      ["iul", "standard"],
      ["veteran", "standard"],
      ["trucker", "standard"],
      ["mortgage_protection", "veteran"],
      ["iul", "veteran"],
      ["mortgage_protection", "trucker"],
      ["iul", "trucker"],
      ["final_expense", "spanish"],
      ["mortgage_protection", "spanish"],
      ["iul", "spanish"],
    ] as const;
    check("all hosted funnel templates registered", Object.keys(FUNNEL_TEMPLATES).length >= expectedTemplates.length);
    for (const [leadType, audience] of expectedTemplates) {
      const template = getFunnelTemplate(leadType, audience);
      const requiredIds = new Set(template.steps.filter((step) => step.required).map((step) => step.id));
      check(
        `${leadType}/${audience} has complete contact and consent steps`,
        ["state", "firstName", "lastName", "email", "phone", "consent"].every((id) => requiredIds.has(id)),
      );
      check(
        `${leadType}/${audience} has complete visible copy and theme`,
        !!template.displayName && !!template.defaultHeadline && !!template.defaultSubheadline &&
          template.reassurance.length >= 3 && Object.values(template.theme).every(Boolean),
      );
    }

    const user = await User.create({ email: userEmail, name: "Hosted Funnel Test User", hasAI: false });
    const folder = await Folder.create({ name: "FB: Hosted Funnel Simulation", userEmail, assignedDrips: [] });
    const commonCampaign = {
      userId: user._id,
      userEmail,
      folderId: folder._id,
      audienceSegment: "standard",
      status: "setup",
      funnelStatus: "active",
      webhookKey,
      licensedStates: ["AZ"],
      borderStateBehavior: "block",
      writeLeadsToSheet: false,
      publicAgentProfile: { displayName: "Test Agent", businessName: "Your Life Quotes" },
      complianceProfile: {
        privacyUrl: "https://www.covecrm.com/legal/privacy",
        termsUrl: "https://www.covecrm.com/legal/terms",
      },
    };
    const standardCampaign = await FBLeadCampaign.create({
      ...commonCampaign,
      leadType: "mortgage_protection",
      campaignType: "hosted_funnel",
      campaignName: "Hosted Funnel Simulation",
      metaCampaignId: `META_HOSTED_${timestamp}`,
    });
    const otpCampaign = await FBLeadCampaign.create({
      ...commonCampaign,
      leadType: "final_expense",
      campaignType: "hosted_funnel_otp",
      campaignName: "OTP Funnel Simulation",
      metaCampaignId: `META_OTP_${timestamp}`,
    });
    campaignIds = [standardCampaign._id, otpCampaign._id] as mongoose.Types.ObjectId[];

    const standardSubmit = await invoke(submitHandler, {
      method: "POST",
      url: `/api/facebook/funnel-submit?key=${webhookKey}`,
      query: { key: webhookKey },
      headers: { "user-agent": "CoveCRM hosted funnel simulation", "x-forwarded-for": "203.0.113.10" },
      body: {
        campaignId: String(standardCampaign._id),
        firstName: "Hosted",
        lastName: "Lead",
        phone: standardPhone,
        email: `hosted-${timestamp}@example.test`,
        age: "42",
        state: "AZ",
        selectedOption: "$250k - $500k",
        answers: { mortgageAmount: "$250k - $500k", beneficiary: "Family" },
        smsConsentGiven: true,
        utm: { utm_source: "facebook", utm_campaign: "simulation" },
      },
    });
    check("hosted funnel submission accepted", standardSubmit.status === 200 && standardSubmit.body.ok === true);
    const standardLead = await Lead.findOne({ userEmail, Phone: standardPhone }).lean() as any;
    check("hosted funnel lead created in CRM", !!standardLead, standardSubmit.body.leadId);
    check("hosted funnel routes to correct folder", String(standardLead.folderId) === String(folder._id));
    check("hosted funnel maps lead type", standardLead.leadType === "Mortgage Protection");
    check("hosted funnel stores state", standardLead.State === "AZ", `State=${standardLead.State || "(blank)"}`);
    check(
      "hosted funnel stores source",
      standardLead.leadSource === "facebook_funnel" && standardLead.sourceType === "facebook_funnel" && standardLead.realTimeEligible === true,
      `leadSource=${standardLead.leadSource || "(blank)"}, sourceType=${standardLead.sourceType || "(blank)"}, realTimeEligible=${String(standardLead.realTimeEligible)}`,
    );

    const otpCode = "482731";
    const otpSession = await FunnelOTPSession.create({
      campaignId: String(otpCampaign._id),
      phoneLast10: otpPhone,
      codeHash: crypto.createHash("sha256").update(otpCode).digest("hex"),
      verified: false,
      attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const otpVerify = await invoke(verifyOtpHandler, {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.11" },
      body: {
        sessionId: String(otpSession._id),
        campaignId: String(otpCampaign._id),
        phone: otpPhone,
        code: otpCode,
      },
    });
    check("OTP verifies and returns signed token", otpVerify.status === 200 && !!otpVerify.body.verifiedToken);

    const otpSubmit = await invoke(submitHandler, {
      method: "POST",
      url: `/api/facebook/funnel-submit?key=${webhookKey}`,
      query: { key: webhookKey },
      headers: { "user-agent": "CoveCRM OTP funnel simulation", "x-forwarded-for": "203.0.113.11" },
      body: {
        campaignId: String(otpCampaign._id),
        firstName: "Verified",
        lastName: "Lead",
        phone: otpPhone,
        email: `otp-${timestamp}@example.test`,
        age: "68",
        state: "AZ",
        selectedOption: "$25k - $50k",
        answers: { coverage: "$25k - $50k", bestTime: "Morning" },
        smsConsentGiven: true,
        verifiedToken: otpVerify.body.verifiedToken,
      },
    });
    check("OTP funnel submission accepted", otpSubmit.status === 200 && otpSubmit.body.ok === true);
    const otpLead = await Lead.findOne({ userEmail, Phone: otpPhone }).lean() as any;
    check("OTP funnel lead created in CRM", !!otpLead, otpSubmit.body.leadId);
    check("OTP funnel maps lead type", otpLead.leadType === "Final Expense");
    check("verified OTP session consumed", !(await FunnelOTPSession.exists({ _id: otpSession._id })));

    const [entries, submissions, consents] = await Promise.all([
      FBLeadEntry.countDocuments({ userEmail, source: "hosted_funnel", importedToCrm: true }),
      FunnelSubmission.countDocuments({ userEmail, wasDuplicate: false }),
      SmsConsentEvidence.countDocuments({ userEmail, consentGiven: true }),
    ]);
    check("both flows recorded in Meta lead feed", entries === 2, `entries=${entries}`);
    check("both raw submissions retained", submissions === 2, `submissions=${submissions}`);
    check("both consent records retained", consents === 2, `consents=${consents}`);
  } finally {
    await Promise.all([
      User.deleteMany({ email: userEmail }),
      Folder.deleteMany({ userEmail }),
      FBLeadCampaign.deleteMany({ userEmail }),
      FBLeadEntry.deleteMany({ userEmail }),
      Lead.deleteMany({ userEmail }),
      FunnelSubmission.deleteMany({ userEmail }),
      SmsConsentEvidence.deleteMany({ userEmail }),
      MetaCAPIEvent.deleteMany({ userEmail }),
      FunnelOTPSession.deleteMany({ campaignId: { $in: campaignIds.map(String) } }),
    ]).catch(() => {});
    globalThis.fetch = originalFetch;
    await mongoose.disconnect().catch(() => {});
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nHosted simulation complete: ${results.length - failed.length} passed, ${failed.length} failed.`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(`\nFAIL hosted simulation aborted - ${error?.message || String(error)}`);
  process.exit(1);
});
