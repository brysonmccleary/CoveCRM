// One-time recovery script for j.jace.vance@gmail.com A2P campaign.
// Steps:
//   1. Delete failed campaign QE2c... from Twilio
//   2. Clear failed campaign state from DB (preserve brand + messaging service)
//   3. Submit a new campaign using existing lastSubmitted* data
//   4. Update DB with new campaign SID and pending status
//   5. Verify live Twilio + Mongo state
//
// Usage: npx tsx scripts/recover-jace-a2p.ts

import "dotenv/config";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { buildA2PCampaignPayload } from "@/lib/a2p/campaignPayload";

const EMAIL = "j.jace.vance@gmail.com";
const FAILED_CAMPAIGN_SID = "QE2c6890da8086d771620e9b13fadeba0b";
const BASE_URL = "https://www.covecrm.com";

function campaignStatusOf(c: any): string {
  return String(c?.campaignStatus || c?.campaign_status || c?.status || c?.state || "").trim();
}

function campaignSidOf(c: any): string {
  return String(c?.sid || c?.campaignSid || c?.campaign_id || c?.campaignId || "").trim();
}

async function main() {
  await dbConnect();

  const user = await User.findOne({ email: EMAIL }).lean<any>();
  if (!user) { console.error("User not found:", EMAIL); process.exit(1); }
  const userId = String(user._id);

  const profile = await A2PProfile.findOne({ userId }).lean<any>();
  if (!profile) { console.error("A2PProfile not found for", EMAIL); process.exit(1); }

  const brandSid: string = profile.brandSid || user.a2p?.brandSid;
  const messagingServiceSid: string = profile.messagingServiceSid || user.a2p?.messagingServiceSid;

  if (!brandSid || !messagingServiceSid) {
    console.error("Missing brandSid or messagingServiceSid — cannot proceed.");
    process.exit(1);
  }

  console.log("brandSid:", brandSid);
  console.log("messagingServiceSid:", messagingServiceSid);
  console.log("failedCampaignSid:", FAILED_CAMPAIGN_SID);

  const { client, accountSid } = await getClientForUser(EMAIL) as any;
  console.log("Twilio accountSid:", accountSid);

  // Step 1: Delete failed campaign from Twilio
  console.log("\n--- Step 1: Delete failed campaign from Twilio ---");
  try {
    await (client as any).messaging.v1
      .services(messagingServiceSid)
      .usAppToPerson(FAILED_CAMPAIGN_SID)
      .remove();
    console.log("Deleted campaign", FAILED_CAMPAIGN_SID, "from Twilio.");
  } catch (e: any) {
    // 404 = already gone, that's fine
    if (e?.status === 404 || String(e?.message || "").includes("404") || String(e?.code || "") === "20404") {
      console.log("Campaign already deleted or not found on Twilio (404) — continuing.");
    } else {
      console.error("Failed to delete campaign:", e?.message || e);
      process.exit(1);
    }
  }

  // Step 2: Clear failed campaign state from DB
  console.log("\n--- Step 2: Clear failed campaign state from DB ---");
  await A2PProfile.updateOne(
    { userId },
    {
      $set: {
        registrationStatus: "brand_approved",
        applicationStatus: "pending",
        messagingReady: false,
        lastSyncedAt: new Date(),
      },
      $unset: {
        campaignSid: 1,
        usa2pSid: 1,
        campaignStatus: 1,
        declinedReason: 1,
        declineNotifiedAt: 1,
        lastError: 1,
      },
    }
  );

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        "a2p.registrationStatus": "brand_approved",
        "a2p.applicationStatus": "pending",
        "a2p.messagingReady": false,
        "a2p.lastSyncedAt": new Date(),
      },
      $unset: {
        "a2p.campaignSid": 1,
        "a2p.campaignStatus": 1,
        "a2p.declinedReason": 1,
        "a2p.declineNotifiedAt": 1,
      },
    }
  );
  console.log("DB cleared. Brand + messagingService preserved.");

  // Step 3: Submit new campaign
  console.log("\n--- Step 3: Submit new campaign to Twilio ---");

  const freshProfile = await A2PProfile.findOne({ userId }).lean<any>();
  if (!freshProfile) { console.error("A2PProfile disappeared — aborting."); process.exit(1); }

  const messageFlow = String(
    freshProfile.lastSubmittedOptInDetails || freshProfile.optInDetails || ""
  ).trim() || "Leads opt in through CoveCRM hosted forms and request insurance follow-up by SMS. Reply STOP to opt out.";

  const messageSamples: string[] = Array.isArray(freshProfile.lastSubmittedSampleMessages) && freshProfile.lastSubmittedSampleMessages.length
    ? freshProfile.lastSubmittedSampleMessages.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 5)
    : [
        "Hi {{first_name}}, this is {{agent_name}}. I received your insurance request and wanted to help you review your options. Reply STOP to opt out.",
        "Hi {{first_name}}, following up on your recent insurance request. When is a good time to connect? Reply STOP to opt out.",
      ];

  const payload = buildA2PCampaignPayload({
    profile: freshProfile,
    brandRegistrationSid: brandSid,
    baseUrl: BASE_URL,
    userId,
    usecase: String(freshProfile.lastSubmittedUseCase || "LOW_VOLUME"),
    messageFlow,
    messageSamples,
  });

  console.log("Campaign payload description:", payload.description?.slice(0, 80), "...");
  console.log("MessageFlow:", payload.messageFlow?.slice(0, 80), "...");
  console.log("Samples count:", (payload.messageSamples || []).length);

  let newCampaign: any = null;
  try {
    newCampaign = await (client as any).messaging.v1
      .services(messagingServiceSid)
      .usAppToPerson.create(payload);
    console.log("Campaign created:", campaignSidOf(newCampaign), "status:", campaignStatusOf(newCampaign));
  } catch (e: any) {
    console.error("Campaign creation failed:", e?.message || e);
    process.exit(1);
  }

  const newCampaignSid = campaignSidOf(newCampaign);
  const newCampaignStatus = campaignStatusOf(newCampaign) || "pending";

  if (!newCampaignSid) {
    console.error("No SID returned from Twilio campaign creation.");
    process.exit(1);
  }

  // Step 4: Update DB with new campaign SID
  console.log("\n--- Step 4: Update DB with new campaign SID ---");
  await A2PProfile.updateOne(
    { userId },
    {
      $set: {
        campaignSid: newCampaignSid,
        usa2pSid: newCampaignSid,
        campaignStatus: newCampaignStatus,
        registrationStatus: "campaign_submitted",
        applicationStatus: "pending",
        messagingReady: false,
        lastSyncedAt: new Date(),
      },
    }
  );

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        "a2p.campaignSid": newCampaignSid,
        "a2p.campaignStatus": newCampaignStatus,
        "a2p.registrationStatus": "campaign_submitted",
        "a2p.applicationStatus": "pending",
        "a2p.messagingReady": false,
        "a2p.lastSyncedAt": new Date(),
      },
    }
  );
  console.log("DB updated with new campaignSid:", newCampaignSid);

  // Step 5: Verify final state
  console.log("\n--- Step 5: Verify ---");
  const finalProfile = await A2PProfile.findOne({ userId }).lean<any>();
  const finalUser = await User.findOne({ email: EMAIL }).lean<any>();

  console.log("\nA2PProfile (final):", JSON.stringify({
    brandSid: finalProfile?.brandSid,
    brandStatus: finalProfile?.brandStatus,
    campaignSid: finalProfile?.campaignSid,
    campaignStatus: finalProfile?.campaignStatus,
    messagingServiceSid: finalProfile?.messagingServiceSid,
    messagingReady: finalProfile?.messagingReady,
    registrationStatus: finalProfile?.registrationStatus,
    applicationStatus: finalProfile?.applicationStatus,
  }, null, 2));

  console.log("\nUser.a2p (final):", JSON.stringify({
    brandSid: finalUser?.a2p?.brandSid,
    brandStatus: finalUser?.a2p?.brandStatus,
    campaignSid: finalUser?.a2p?.campaignSid,
    campaignStatus: finalUser?.a2p?.campaignStatus,
    messagingServiceSid: finalUser?.a2p?.messagingServiceSid,
    messagingReady: finalUser?.a2p?.messagingReady,
    registrationStatus: finalUser?.a2p?.registrationStatus,
  }, null, 2));

  // Live Twilio check on new campaign
  console.log("\nLive Twilio — new campaign status:");
  try {
    const live = await (client as any).messaging.v1
      .services(messagingServiceSid)
      .usAppToPerson(newCampaignSid)
      .fetch();
    console.log(JSON.stringify({
      sid: live.sid,
      campaignStatus: campaignStatusOf(live),
      brandRegistrationSid: live.brandRegistrationSid,
      dateCreated: live.dateCreated,
      errors: live.errors,
    }, null, 2));
  } catch (e: any) {
    console.error("Live fetch failed:", e?.message || e);
  }

  console.log("\n=== DONE ===");
  console.log("New campaign", newCampaignSid, "submitted and pending Twilio review.");
  console.log("messagingReady is FALSE until Twilio approves the campaign.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
