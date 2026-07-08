// scripts/create-jace-a2p-stub.ts
// Creates a new A2P compliance stub FBLeadCampaign for Jace Vance and updates his A2PProfile.
// Run: MONGODB_URI="$(grep '^MONGODB_URI=' .env.local | cut -d'=' -f2-)" npx tsx scripts/create-jace-a2p-stub.ts
// DO NOT push. DO NOT commit. DO NOT touch Twilio API.

import mongoose from "mongoose";
import dbConnect from "../lib/mongooseConnect";
import FBLeadCampaign from "../models/FBLeadCampaign";
import A2PProfile from "../models/A2PProfile";
import { buildLeadGenerationConsentText } from "../lib/a2p/flowSelection";

const JACE_EMAIL   = "j.jace.vance@gmail.com";
const JACE_USER_ID = "6a175b6bbdb4f73aabfef827";
const OLD_STUB_ID  = "6a2c7bffc8eaeabb04b18d4e";
const BASE_URL     = "https://www.covecrm.com";

async function run() {
  await dbConnect();

  // Step 1: Fetch Jace's A2PProfile for accurate agent name / business name
  const a2pProfile = await (A2PProfile as any)
    .findOne({ userId: JACE_USER_ID })
    .select("contactFirstName contactLastName businessName phone")
    .lean() as any;

  if (!a2pProfile) {
    console.error("❌  A2PProfile not found for userId:", JACE_USER_ID);
    process.exit(1);
  }

  const agentName = [
    String(a2pProfile.contactFirstName || "").trim(),
    String(a2pProfile.contactLastName || "").trim(),
  ].filter(Boolean).join(" ");
  const businessName = String(a2pProfile.businessName || "").trim();
  const agentPhone   = String(a2pProfile.phone || "").trim();

  console.log(`\nA2P profile: agentName="${agentName}", businessName="${businessName}"`);

  const consentText = buildLeadGenerationConsentText({
    agentName,
    businessName,
    campaignType: "final_expense",
  });

  // Step 2: Invalidate the old stub so hosted-compliance.ts upsert creates a NEW _id.
  // Change funnelVersion so it no longer matches { funnelVersion: "a2p-compliance-stub" }.
  const oldStubDoc = await (FBLeadCampaign as any)
    .findOne({ _id: OLD_STUB_ID, userEmail: JACE_EMAIL })
    .select("_id funnelVersion funnelStatus")
    .lean() as any;

  if (oldStubDoc) {
    await (FBLeadCampaign as any).updateOne(
      { _id: OLD_STUB_ID },
      { $set: { funnelVersion: "a2p-compliance-stub-rejected", funnelStatus: "paused" } },
    );
    console.log(`\n🔴  Old stub ${OLD_STUB_ID} invalidated → funnelVersion=a2p-compliance-stub-rejected, funnelStatus=paused`);
  } else {
    console.log(`\n⚠️   Old stub ${OLD_STUB_ID} not found with JACE_EMAIL — already gone or already invalidated. Continuing.`);
  }

  // Step 3: Create a brand-new FBLeadCampaign stub (fresh _id = fresh URL)
  const tosUrl     = `${BASE_URL}/sms/lead-optin-terms/${JACE_USER_ID}`;
  const privacyUrl = `${BASE_URL}/sms/lead-optin-privacy/${JACE_USER_ID}`;

  const newStub = await (FBLeadCampaign as any).create({
    userId:       new mongoose.Types.ObjectId(JACE_USER_ID),
    userEmail:    JACE_EMAIL,
    leadType:     "final_expense",
    campaignName: "A2P Compliance Review",
    status:       "active",
    funnelStatus: "active",
    funnelVersion: "a2p-compliance-stub",
    campaignType:  "hosted_funnel",
    webhookKey:    Math.random().toString(36).substring(2, 12),
    licensedStates: [],
    borderStateBehavior: "allow_with_warning",
    publicAgentProfile: {
      displayName:  agentName,
      businessName,
      phone:        agentPhone,
      stateLabel:   "",
      logoUrl:      "",
      headshotUrl:  "",
    },
    complianceProfile: {
      consentText,
      disclaimerText: "",
      privacyUrl,
      termsUrl: tosUrl,
    },
  });

  const newStubId   = String(newStub._id);
  const newOptInUrl = `${BASE_URL}/f/${newStubId}`;

  console.log(`\n✅  New A2P stub created: ${newStubId}`);
  console.log(`   URL: ${newOptInUrl}`);

  // Step 4: Update Jace's A2PProfile with the new landing opt-in URL
  const profileResult = await (A2PProfile as any).updateOne(
    { userId: JACE_USER_ID },
    {
      $set: {
        landingOptInUrl: newOptInUrl,
        landingTosUrl:   tosUrl,
        landingPrivacyUrl: privacyUrl,
        a2pFlow:          "lead_generation",
        campaignType:     "final_expense",
        useHostedCompliancePages: true,
      },
    },
  );

  if (profileResult.modifiedCount > 0) {
    console.log(`\n✅  A2PProfile updated → landingOptInUrl: ${newOptInUrl}`);
  } else {
    console.warn(`\n⚠️   A2PProfile updateOne matched 0 docs. Verify userId ${JACE_USER_ID} is correct.`);
  }

  // Step 5: Verify
  const oldCheck = await (FBLeadCampaign as any)
    .findById(OLD_STUB_ID)
    .select("funnelVersion funnelStatus")
    .lean() as any;
  const newCheck = await (FBLeadCampaign as any)
    .findById(newStubId)
    .select("funnelVersion funnelStatus userEmail")
    .lean() as any;

  console.log(`\nVerification:`);
  console.log(`  old ${OLD_STUB_ID}: funnelVersion=${oldCheck?.funnelVersion}, funnelStatus=${oldCheck?.funnelStatus}`);
  console.log(`  new ${newStubId}: funnelVersion=${newCheck?.funnelVersion}, funnelStatus=${newCheck?.funnelStatus}`);

  console.log(`\n🔗  New A2P opt-in URL for Twilio re-submission:`);
  console.log(`    ${newOptInUrl}\n`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("\n❌  Script failed:", err?.message || err);
  process.exit(1);
});
