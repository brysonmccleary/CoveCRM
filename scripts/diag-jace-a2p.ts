// READ-ONLY diagnostic: query live Twilio state for j.jace.vance@gmail.com
// No writes, no mutations.
// Usage: npx tsx scripts/diag-jace-a2p.ts

import "dotenv/config";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const EMAIL = "j.jace.vance@gmail.com";

async function main() {
  await dbConnect();

  const user = await User.findOne({ email: EMAIL }).lean<any>();
  if (!user) { console.error("User not found:", EMAIL); process.exit(1); }

  const profile = await A2PProfile.findOne({ userId: String(user._id) }).lean<any>();

  console.log("\n=== DB: User.a2p ===");
  console.log(JSON.stringify(user.a2p, null, 2));

  console.log("\n=== DB: A2PProfile (key fields) ===");
  console.log(JSON.stringify({
    brandSid: profile?.brandSid,
    brandStatus: profile?.brandStatus,
    campaignSid: profile?.campaignSid,
    usa2pSid: profile?.usa2pSid,
    campaignStatus: profile?.campaignStatus,
    messagingServiceSid: profile?.messagingServiceSid,
    messagingReady: profile?.messagingReady,
    registrationStatus: profile?.registrationStatus,
    applicationStatus: profile?.applicationStatus,
    lastSyncedAt: profile?.lastSyncedAt,
    updatedAt: profile?.updatedAt,
    lastError: profile?.lastError,
  }, null, 2));

  const { client, accountSid } = await getClientForUser(EMAIL) as any;
  console.log("\n=== Twilio accountSid resolved ===", accountSid);

  // Brand
  const brandSid = profile?.brandSid || user.a2p?.brandSid;
  if (brandSid) {
    try {
      const brand = await (client as any).messaging.v1.brandRegistrations(brandSid).fetch();
      console.log("\n=== LIVE: Brand ===");
      console.log(JSON.stringify({
        sid: brand.sid,
        status: brand.status,
        state: brand.state,
        brandType: brand.brandType,
        identity: brand.identity,
        customerProfileBundleSid: brand.customerProfileBundleSid,
      }, null, 2));
    } catch (e: any) {
      console.error("Brand fetch error:", e.message);
    }
  } else {
    console.log("\nNo brandSid in DB");
  }

  // Messaging services + campaigns
  const services = await (client as any).messaging.v1.services.list({ limit: 50 });
  console.log(`\n=== LIVE: Messaging Services (${services.length}) ===`);
  for (const svc of services) {
    console.log(`\nService: ${svc.sid} (${svc.friendlyName})`);
    try {
      const campaigns = await (client as any).messaging.v1.services(svc.sid).usAppToPerson.list({ limit: 50 });
      if (!campaigns.length) {
        console.log("  No campaigns");
      }
      for (const c of campaigns) {
        console.log("  Campaign:", JSON.stringify({
          sid: c.sid,
          campaignStatus: c.campaignStatus,
          status: c.status,
          state: c.state,
          brandRegistrationSid: c.brandRegistrationSid,
          dateCreated: c.dateCreated,
        }));
      }
    } catch (e: any) {
      console.log("  Error listing campaigns:", e.message);
    }
  }

  // Direct fetch of known campaign SID
  const campaignSid = profile?.campaignSid || profile?.usa2pSid || user.a2p?.campaignSid;
  const messagingServiceSid = profile?.messagingServiceSid || user.a2p?.messagingServiceSid;
  if (campaignSid && messagingServiceSid) {
    console.log(`\n=== LIVE: Direct Campaign Fetch (${campaignSid} on ${messagingServiceSid}) ===`);
    try {
      const camp = await (client as any).messaging.v1.services(messagingServiceSid).usAppToPerson(campaignSid).fetch();
      console.log(JSON.stringify({
        sid: camp.sid,
        campaignStatus: camp.campaignStatus,
        status: camp.status,
        state: camp.state,
        brandRegistrationSid: camp.brandRegistrationSid,
        errors: camp.errors,
        dateUpdated: camp.dateUpdated,
      }, null, 2));
    } catch (e: any) {
      console.error("Direct campaign fetch error:", e.message);
    }
  }

  console.log("\n=== DONE ===");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
