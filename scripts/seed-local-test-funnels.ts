// scripts/seed-local-test-funnels.ts
// Creates two clearly-marked test FBLeadCampaign records for manual browser testing.
// Safe by design: both webhookKeys are intentionally invalid strings — any form
// submission will receive a 403 before any lead, AI call, or SMS is created.
// Run: npx ts-node -r tsconfig-paths/register scripts/seed-local-test-funnels.ts
// Clean up: re-run this script (deleteMany at top removes previous records first).

import mongoose from "mongoose";
import dbConnect from "../lib/mongooseConnect";
import FBLeadCampaign from "../models/FBLeadCampaign";
import User from "../models/User";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

const A2P_CAMPAIGN_NAME   = "LOCAL TEST - A2P Compliance Stub";
const PROD_CAMPAIGN_NAME  = "LOCAL TEST - Production Funnel";

async function seed() {
  await dbConnect();

  const admin = await (User as any).findOne({ email: ADMIN_EMAIL }).lean() as any;
  if (!admin) {
    console.error(`\n❌  Admin user "${ADMIN_EMAIL}" not found. Aborting.\n`);
    process.exit(1);
  }

  // Remove any previously seeded test records to avoid duplicates.
  const removed = await (FBLeadCampaign as any).deleteMany({
    userEmail: ADMIN_EMAIL,
    campaignName: { $in: [A2P_CAMPAIGN_NAME, PROD_CAMPAIGN_NAME] },
  });
  if (removed.deletedCount > 0) {
    console.log(`🧹  Removed ${removed.deletedCount} stale test record(s).`);
  }

  const base = {
    userId:    admin._id,
    userEmail: ADMIN_EMAIL,
    leadType:  "final_expense",
    status:    "active",
    funnelStatus: "active",
    campaignType: "hosted_funnel",
    publicAgentProfile: {
      displayName:  "Test Agent",
      businessName: "Local Test Agency",
      phone:        "",
      stateLabel:   "",
      logoUrl:      "",
      headshotUrl:  "",
    },
    complianceProfile: {
      disclaimerText: "",
      consentText:    "",
      privacyUrl:     "",
      termsUrl:       "",
    },
    licensedStates: [],
  };

  // ── A2P compliance stub ──────────────────────────────────────────────────────
  // funnelVersion: "a2p-compliance-stub" → funnel page shows optional checkbox,
  // original SMS-only wording, no AI language, "optional" note visible.
  // funnel-submit.ts returns { ok: true, complianceOnly: true } immediately —
  // no lead created, no AI call, no SMS.
  const a2pRecord = await (FBLeadCampaign as any).create({
    ...base,
    campaignName:  A2P_CAMPAIGN_NAME,
    funnelVersion: "a2p-compliance-stub",
    webhookKey:    "LOCAL-TEST-A2P-DO-NOT-SUBMIT",
  });

  // ── Production test funnel ───────────────────────────────────────────────────
  // funnelVersion omitted → defaults to "2026-04-production-v1".
  // Funnel page shows required checkbox + AI/artificial/prerecorded voice language.
  // webhookKey mismatch → funnel-submit.ts returns 403 before creating anything.
  const prodRecord = await (FBLeadCampaign as any).create({
    ...base,
    campaignName: PROD_CAMPAIGN_NAME,
    webhookKey:   "LOCAL-TEST-PROD-DO-NOT-SUBMIT",
    // funnelVersion intentionally omitted — uses schema default
  });

  console.log("\n✅  Test records created.\n");
  console.log(`A2P Stub   (optional checkbox, SMS-only wording):`);
  console.log(`  http://localhost:3000/f/${a2pRecord._id}\n`);
  console.log(`Production (required checkbox, AI/voice language):`);
  console.log(`  http://localhost:3000/f/${prodRecord._id}\n`);
  console.log("⚠️   Both webhookKeys are intentionally invalid.");
  console.log("     Submitting either form will 403 before creating leads, AI calls, or SMS.\n");
  console.log("🧹  To clean up: re-run this script — deleteMany at top removes both records first.\n");

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("\n❌  Seed failed:", err?.message || err);
  process.exit(1);
});
