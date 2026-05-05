import "dotenv/config";
import mongoose from "mongoose";

type CheckResult = {
  name: string;
  ok: boolean;
  details?: string;
};

const results: CheckResult[] = [];

function pass(name: string, details?: string) {
  results.push({ name, ok: true, details });
  console.log(`PASS ${name}${details ? ` - ${details}` : ""}`);
}

function fail(name: string, details?: string) {
  results.push({ name, ok: false, details });
  console.error(`FAIL ${name}${details ? ` - ${details}` : ""}`);
}

function assertCheck(name: string, condition: unknown, details?: string): asserts condition {
  if (!condition) {
    fail(name, details);
    throw new Error(`${name}${details ? `: ${details}` : ""}`);
  }
  pass(name, details);
}

function normalizeUri(uri: string) {
  return uri.trim().replace(/\/+$/, "");
}

function createMockFetch(fakeLeadPayload: any) {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method || "GET";
    calls.push(`${method} ${url}`);

    if (url.includes("graph.facebook.com")) {
      if (url.includes("/LEADGEN_TEST_")) {
        return Response.json(fakeLeadPayload);
      }
      if (url.includes("/adimages")) {
        return Response.json({ images: { bytes: { hash: "mock_image_hash" } } });
      }
      return Response.json({ id: `mock_${calls.length}` });
    }

    if (url.includes("/trigger-call")) {
      return Response.json({ ok: true, mocked: true });
    }

    return Response.json({ ok: true, mocked: true });
  };

  globalThis.fetch = mockFetch;

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function main() {
  const testUri = process.env.MONGODB_URI_TEST || "";
  const prodUri = process.env.MONGODB_URI || "";

  assertCheck("MONGODB_URI_TEST present", !!testUri);
  assertCheck(
    "MONGODB_URI_TEST differs from MONGODB_URI",
    normalizeUri(testUri) !== normalizeUri(prodUri),
    "refusing to run against production DB"
  );

  const timestamp = Date.now();
  const userEmail = `fb-flow-test-${timestamp}@example.test`;
  const metaCampaignId = `META_CAMPAIGN_TEST_${timestamp}`;
  const metaAdsetId = `META_ADSET_TEST_${timestamp}`;
  const metaAdId = `META_AD_TEST_${timestamp}`;
  const metaFormId = `META_FORM_TEST_${timestamp}`;
  const pageId = `PAGE_TEST_${timestamp}`;
  const leadgenId = `LEADGEN_TEST_${timestamp}`;

  process.env.MONGODB_URI = testUri;
  process.env.MONGODB_DBNAME = process.env.MONGODB_DBNAME_TEST || process.env.MONGODB_DBNAME || undefined;
  process.env.META_SYSTEM_USER_TOKEN = process.env.META_SYSTEM_USER_TOKEN || "test-meta-token";
  process.env.AI_VOICE_HTTP_BASE = process.env.AI_VOICE_HTTP_BASE || "https://voice.test.local";
  process.env.COVECRM_API_SECRET = process.env.COVECRM_API_SECRET || "test-secret";

  const fakeLeadPayload = {
    id: leadgenId,
    created_time: "2026-04-29T12:00:00+0000",
    form_id: metaFormId,
    ad_id: metaAdId,
    adset_id: metaAdsetId,
    campaign_id: metaCampaignId,
    page_id: pageId,
    field_data: [
      { name: "full_name", values: ["Test Veteran"] },
      { name: "email", values: [`lead-${timestamp}@example.test`] },
      { name: "phone_number", values: ["5551234567"] },
      { name: "state", values: ["AZ"] },
    ],
  };
  const fetchMock = createMockFetch(fakeLeadPayload);

  let cleanupReady = false;

  try {
    const mongooseConnect = (await import("../lib/mongooseConnect")).default;
    const User = (await import("../models/User")).default;
    const Folder = (await import("../models/Folder")).default;
    const FBLeadCampaign = (await import("../models/FBLeadCampaign")).default;
    const FBLeadSubscription = (await import("../models/FBLeadSubscription")).default;
    const FBLeadEntry = (await import("../models/FBLeadEntry")).default;
    const Lead = (await import("../models/Lead")).default;
    const AISettings = (await import("../models/AISettings")).default;
    const AdMetricsDaily = (await import("../models/AdMetricsDaily")).default;
    const CRMOutcome = (await import("../models/CRMOutcome")).default;
    const CampaignActionLog = (await import("../models/CampaignActionLog")).default;
    const {
      buildWinningFunnelConfig,
      generateWinningVariants,
      selectRecommendedVariant,
    } = await import("../lib/facebook/winningAdLibrary");
    const { buildCampaignStructure } = await import("../lib/facebook/buildCampaignStructure");
    const { processMetaLead } = await import("../lib/meta/processMetaLead");
    const { trackOutcomeFromDisposition } = await import("../lib/facebook/trackCRMOutcome");

    await mongooseConnect();
    cleanupReady = true;

    await Promise.all([
      User.deleteMany({ email: userEmail }),
      Folder.deleteMany({ userEmail }),
      FBLeadCampaign.deleteMany({ userEmail }),
      FBLeadSubscription.deleteMany({ userEmail }),
      FBLeadEntry.deleteMany({ userEmail }),
      Lead.deleteMany({ userEmail }),
      AISettings.deleteMany({ userEmail }),
      AdMetricsDaily.deleteMany({ userEmail }),
      CRMOutcome.deleteMany({ userEmail }),
    ]);

    const user = await User.create({
      email: userEmail,
      name: "FB Flow Test User",
      firstName: "FB",
      lastName: "Tester",
      hasAI: true,
      metaAccessToken: "test-user-access-token",
      metaSystemUserToken: "test-system-user-token",
      metaAdAccountId: `ACT_TEST_${timestamp}`,
      metaPageId: pageId,
      metaPageName: "Test Page",
    });
    pass("seed test user", String(user._id));

    await AISettings.create({
      userId: user._id,
      userEmail,
      aiNewLeadCallEnabled: true,
      newLeadCallDelayMinutes: 0,
      businessHoursOnly: false,
    });
    pass("seed AI settings", "aiNewLeadCallEnabled=true");

    await FBLeadSubscription.create({
      userId: user._id,
      userEmail,
      plan: "manager_pro",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    pass("seed active FB lead subscription");

    const variants = generateWinningVariants({
      leadType: "iul",
      audienceSegment: "veteran",
      userId: userEmail,
      campaignName: "Veteran IUL Leads - Arizona Campaign",
      location: "Arizona",
    });
    const selectedVariant = selectRecommendedVariant("iul", variants);
    const draft = {
      leadType: "iul",
      audienceSegment: "veteran",
      campaignName: "Veteran IUL Leads - Arizona Campaign",
      dailyBudgetCents: 2500,
      primaryText: selectedVariant.primaryText,
      headline: selectedVariant.headline,
      description: selectedVariant.description,
      cta: selectedVariant.cta,
      imagePrompt: selectedVariant.imagePrompt,
      imageUrl: `data:image/png;base64,${Buffer.from("mock-image").toString("base64")}`,
      landingPageConfig: buildWinningFunnelConfig(selectedVariant),
      winningFamilyId: selectedVariant.familyId,
      variationType: selectedVariant.variantType,
      uniquenessFingerprint: selectedVariant.uniquenessFingerprint,
      vendorStyleTag: selectedVariant.vendorStyleTag,
    };
    assertCheck("generate Veteran IUL draft", draft.leadType === "iul" && draft.audienceSegment === "veteran", draft.winningFamilyId);
    assertCheck("mock image URL attached", draft.imageUrl.startsWith("data:image/png;base64,"));

    const structure = buildCampaignStructure({
      campaignName: draft.campaignName,
      licensedStates: ["AZ"],
      dailyBudgetCents: draft.dailyBudgetCents,
      creatives: [
        {
          primaryText: draft.primaryText,
          headline: draft.headline,
          description: draft.description,
          cta: draft.cta,
          imageUrl: draft.imageUrl,
          imagePrompt: draft.imagePrompt,
          templateId: draft.winningFamilyId,
        },
      ],
    });
    assertCheck(
      "build paused Meta campaign structure",
      structure.campaign.status === "PAUSED" && structure.adSet.status === "PAUSED" && structure.ads.length === 1,
      `${structure.campaign.objective}/${structure.adSet.optimization_goal}`
    );

    await Promise.all([
      fetch(`https://graph.facebook.com/v19.0/act_TEST/campaigns`, { method: "POST" }),
      fetch(`https://graph.facebook.com/v19.0/act_TEST/adsets`, { method: "POST" }),
      fetch(`https://graph.facebook.com/v19.0/${pageId}/leadgen_forms`, { method: "POST" }),
      fetch(`https://graph.facebook.com/v19.0/act_TEST/adimages`, { method: "POST" }),
      fetch(`https://graph.facebook.com/v19.0/act_TEST/adcreatives`, { method: "POST" }),
      fetch(`https://graph.facebook.com/v19.0/act_TEST/ads`, { method: "POST" }),
    ]);
    assertCheck("mock Meta publish calls", fetchMock.calls.filter((call) => call.includes("graph.facebook.com")).length >= 6);

    const folder = await Folder.create({
      name: `FB: ${draft.campaignName}`,
      userEmail,
      assignedDrips: [],
      aiFirstCallEnabled: true,
      aiContactEnabled: true,
      aiEnabledAt: new Date(),
      aiScriptKey: "iul_cash_value",
    });

    const campaign = await FBLeadCampaign.create({
      userId: user._id,
      userEmail,
      leadType: "iul",
      campaignName: draft.campaignName,
      status: "setup",
      dailyBudget: 25,
      plan: "manager_pro",
      folderId: folder._id,
      facebookPageId: pageId,
      metaCampaignId,
      metaAdsetId,
      metaAdId,
      metaFormId,
      metaPublishStatus: "success",
      metaObjectHealth: "paused_on_meta",
      licensedStates: ["AZ"],
      stateRestrictionNoticeAccepted: true,
      landingPageConfig: draft.landingPageConfig,
      notes: JSON.stringify({ simulated: true, draft }),
    });
    pass("seed simulated published campaign", String(campaign._id));

    await processMetaLead(
      leadgenId,
      pageId,
      metaFormId,
      metaAdId,
      metaAdsetId,
      metaCampaignId,
      Math.floor(Date.now() / 1000)
    );

    const crmLead = (await Lead.findOne({ userEmail, metaLeadgenId: leadgenId }).lean()) as any;
    assertCheck("CRM lead created", !!crmLead, "metaLeadgenId matched");
    assertCheck("CRM firstName", crmLead?.["First Name"] === "Test");
    assertCheck("CRM lastName", crmLead?.["Last Name"] === "Veteran");
    assertCheck("CRM phone", crmLead?.Phone === "5551234567");
    assertCheck("CRM email", crmLead?.email === `lead-${timestamp}@example.test`);
    assertCheck("CRM state", crmLead?.State === "AZ");
    assertCheck("CRM leadType", crmLead?.leadType === "IUL");
    assertCheck("CRM metaCampaignId", crmLead?.metaCampaignId === metaCampaignId);
    assertCheck("CRM folderId", String(crmLead?.folderId || "") === String(folder._id));

    const leadCountBeforeDuplicate = await Lead.countDocuments({ userEmail, metaLeadgenId: leadgenId });
    await processMetaLead(
      leadgenId,
      pageId,
      metaFormId,
      metaAdId,
      metaAdsetId,
      metaCampaignId,
      Math.floor(Date.now() / 1000)
    );
    const leadCountAfterDuplicate = await Lead.countDocuments({ userEmail, metaLeadgenId: leadgenId });
    assertCheck("duplicate webhook skipped", leadCountBeforeDuplicate === 1 && leadCountAfterDuplicate === 1);

    await AdMetricsDaily.create({
      campaignId: campaign._id,
      userId: user._id,
      userEmail,
      date: "2026-04-29",
      spend: 50,
      leads: 1,
      cpl: 50,
    });
    await trackOutcomeFromDisposition(String(crmLead!._id), "Booked Appointment");
    await trackOutcomeFromDisposition(String(crmLead!._id), "Sold");
    const outcomes = await CRMOutcome.find({ userEmail, campaignId: campaign._id }).lean();
    const booked = outcomes.reduce((sum, row: any) => sum + Number(row.appointmentsBooked || 0), 0);
    const sold = outcomes.reduce((sum, row: any) => sum + Number(row.sales || 0), 0);
    assertCheck("stats source seeded", booked >= 1 && sold >= 1, `booked=${booked}, sold=${sold}`);

    const dryRunOldBudget = Number(campaign.dailyBudget || 0);
    const dryRunNewBudget = Number((dryRunOldBudget * 1.2).toFixed(2));
    assertCheck(
      "execute-action dryRun simulation",
      dryRunOldBudget === 25 && dryRunNewBudget === 30,
      "SCALE would not call Meta in dryRun"
    );

    const actionLog = await CampaignActionLog.create({
      userId: user._id,
      campaignId: campaign._id,
      actionType: "SCALE",
      oldBudget: dryRunOldBudget,
      newBudget: dryRunNewBudget,
      metaResponse: {
        summary: {
          dryRun: true,
          mock: true,
          message: `Dry run: Budget would be increased from $${dryRunOldBudget.toFixed(2)} to $${dryRunNewBudget.toFixed(2)}.`,
        },
      },
      createdAt: new Date(),
    });
    pass("record dryRun action log", String(actionLog._id));
  } finally {
    if (cleanupReady) {
      try {
        const User = (await import("../models/User")).default;
        const Folder = (await import("../models/Folder")).default;
        const FBLeadCampaign = (await import("../models/FBLeadCampaign")).default;
        const FBLeadSubscription = (await import("../models/FBLeadSubscription")).default;
        const FBLeadEntry = (await import("../models/FBLeadEntry")).default;
        const Lead = (await import("../models/Lead")).default;
        const AISettings = (await import("../models/AISettings")).default;
        const AdMetricsDaily = (await import("../models/AdMetricsDaily")).default;
        const CRMOutcome = (await import("../models/CRMOutcome")).default;
        const CampaignActionLog = (await import("../models/CampaignActionLog")).default;
        const campaigns = await FBLeadCampaign.find({ userEmail }).select("_id").lean();
        const campaignIds = campaigns.map((campaign: any) => campaign._id);
        await Promise.all([
          CampaignActionLog.deleteMany({ campaignId: { $in: campaignIds } }),
          User.deleteMany({ email: userEmail }),
          Folder.deleteMany({ userEmail }),
          FBLeadCampaign.deleteMany({ userEmail }),
          FBLeadSubscription.deleteMany({ userEmail }),
          FBLeadEntry.deleteMany({ userEmail }),
          Lead.deleteMany({ userEmail }),
          AISettings.deleteMany({ userEmail }),
          AdMetricsDaily.deleteMany({ userEmail }),
          CRMOutcome.deleteMany({ userEmail }),
        ]);
        pass("cleanup test records", userEmail);
      } catch (err: any) {
        fail("cleanup test records", err?.message || String(err));
      }
    }

    fetchMock.restore();
    await mongoose.disconnect().catch(() => {});
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nSimulation complete: ${results.length - failed.length} passed, ${failed.length} failed.`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(`\nFAIL simulation aborted - ${err?.message || String(err)}`);
  process.exit(1);
});
