// scripts/a2p-pipeline-check.ts
// Read-only A2P pipeline diagnostic for a single user.
// Uses the same platform-fallback TrustHub logic as resumeAutomation.
//
// Usage:
//   ONLY_EMAIL=aliciaandrade.ffl@gmail.com npx tsx scripts/a2p-pipeline-check.ts
//   ONLY_EMAIL=aliciaandrade.ffl@gmail.com npx tsx scripts/a2p-pipeline-check.ts --advance

import { config as dotenvConfig } from "dotenv";
// Load .env.local first (Next.js convention), then fall back to .env
dotenvConfig({ path: ".env.local", override: false });
dotenvConfig({ path: ".env", override: false });
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { resumeA2PAutomationForUserEmail } from "@/lib/a2p/resumeAutomation";

const ONLY_EMAIL = (process.env.ONLY_EMAIL || "").toLowerCase().trim();
const ADVANCE = process.argv.includes("--advance");

const TRUSTHUB_APPROVED = new Set(["APPROVED", "TWILIO_APPROVED", "twilio-approved"]);
const BRAND_OK = new Set(["APPROVED", "VERIFIED", "ACTIVE", "IN_USE", "REGISTERED"]);
const CAMPAIGN_OK = new Set(["APPROVED", "VERIFIED", "ACTIVE", "IN_USE", "REGISTERED", "CAMPAIGN_APPROVED"]);

function normUpper(v: any) { return String(v || "").trim().toUpperCase(); }
function normTrustHub(v: any) {
  const r = String(v || "").trim().toUpperCase().replace(/-/g, "_");
  if (r === "INREVIEW") return "IN_REVIEW";
  return r;
}

function buildPlatformClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || "").replace(/[^A-Za-z0-9]/g, "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!sid.startsWith("AC") || !token) return null;
  try { return twilio(sid, token, { accountSid: sid }); } catch { return null; }
}

async function tryFetch<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); }
  catch (e: any) {
    console.log(`  [${label}] ERROR: ${e?.message || e} (code=${e?.code ?? "?"})`);
    return null;
  }
}

async function main() {
  if (!ONLY_EMAIL) {
    console.error("Set ONLY_EMAIL env var.");
    process.exit(1);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`A2P PIPELINE CHECK — ${ONLY_EMAIL}`);
  console.log(`ADVANCE MODE: ${ADVANCE}`);
  console.log("=".repeat(72));

  await dbConnect();

  const user = await User.findOne({ email: ONLY_EMAIL }).lean<any>();
  if (!user) { console.error("User not found."); process.exit(1); }

  const profile = await A2PProfile.findOne({ userId: String(user._id) }).lean<any>();
  if (!profile) { console.error("A2PProfile not found."); process.exit(1); }

  console.log("\n--- MONGO USER ---");
  console.log({
    _id: String(user._id),
    email: user.email,
    billingMode: user.billingMode,
    twilioAccountSid: user.twilio?.accountSid || null,
    hasApiKeySid: Boolean(user.twilio?.apiKeySid),
    a2p: user.a2p,
    numbersCount: Array.isArray(user.numbers) ? user.numbers.length : 0,
  });

  console.log("\n--- MONGO A2PPROFILE ---");
  console.log({
    _id: String(profile._id),
    businessName: profile.businessName || null,
    profileSid: profile.profileSid || null,
    profileStatus: profile.profileStatus || null,
    trustProductSid: profile.trustProductSid || null,
    trustProductStatus: profile.trustProductStatus || null,
    brandSid: profile.brandSid || null,
    brandStatus: profile.brandStatus || null,
    campaignSid: profile.campaignSid || profile.usa2pSid || null,
    messagingServiceSid: profile.messagingServiceSid || null,
    registrationStatus: profile.registrationStatus || null,
    messagingReady: profile.messagingReady,
    lastError: profile.lastError || null,
    lastSubmittedUseCase: profile.lastSubmittedUseCase || null,
    hasSampleMessages: Boolean(profile.sampleMessages || profile.sampleMessagesArr?.length),
    hasOptInDetails: Boolean(profile.lastSubmittedOptInDetails || profile.optInDetails),
  });

  // Resolve clients
  let tenantClient: any = null;
  let tenantAccountSid: string | null = null;
  try {
    const resolved = await getClientForUser(ONLY_EMAIL);
    tenantClient = resolved.client;
    tenantAccountSid = resolved.accountSid;
  } catch (e: any) {
    console.log(`\n[ERROR] getClientForUser failed: ${e?.message}`);
  }

  const platformClient = buildPlatformClient();
  const platformSid = (process.env.TWILIO_ACCOUNT_SID || "").replace(/[^A-Za-z0-9]/g, "").trim();

  console.log("\n--- TWILIO CLIENT ---");
  console.log({
    tenantAccountSid,
    platformSid: platformSid || null,
    isSameAccount: tenantAccountSid === platformSid,
  });

  // Use platform for TrustHub; tenant for messaging/campaigns
  const thClient = platformClient ?? tenantClient;

  console.log("\n--- TWILIO TRUTH ---");

  // Customer Profile
  let profileStatus = normTrustHub(profile.profileStatus);
  if (profile.profileSid && thClient) {
    const cp = await tryFetch("CustomerProfile", () =>
      thClient.trusthub.v1.customerProfiles(profile.profileSid).fetch()
    );
    if (cp) profileStatus = normTrustHub((cp as any).status);
    console.log(`  CustomerProfile ${profile.profileSid}: ${cp ? (cp as any).status : "NOT FOUND"}`);
  } else {
    console.log(`  CustomerProfile: ${profile.profileSid || "MISSING"}`);
  }

  // Trust Product
  let trustStatus = normTrustHub(profile.trustProductStatus);
  if (profile.trustProductSid && thClient) {
    const tp = await tryFetch("TrustProduct", () =>
      thClient.trusthub.v1.trustProducts(profile.trustProductSid).fetch()
    );
    if (tp) trustStatus = normTrustHub((tp as any).status);
    console.log(`  TrustProduct ${profile.trustProductSid}: ${tp ? (tp as any).status : "NOT FOUND"}`);
  } else {
    console.log(`  TrustProduct: ${profile.trustProductSid || "MISSING"}`);
  }

  // Brand Registration
  const brandSidStored = profile.brandSid || null;
  let brandStatus: string | null = null;
  if (brandSidStored && thClient) {
    const br = await tryFetch("BrandRegistration", () =>
      thClient.messaging.v1.brandRegistrations(brandSidStored).fetch()
    );
    if (br) brandStatus = normUpper((br as any).status);
    console.log(`  Brand ${brandSidStored}: ${br ? (br as any).status : "NOT FOUND"}`);
  } else {
    console.log(`  Brand: ${brandSidStored || "MISSING"}`);
  }

  // Messaging Service
  const mgSid = profile.messagingServiceSid || null;
  let mgExists = false;
  if (mgSid && tenantClient) {
    const mg = await tryFetch("MessagingService(tenant)", () =>
      tenantClient.messaging.v1.services(mgSid).fetch()
    );
    if (!mg && thClient) {
      const mg2 = await tryFetch("MessagingService(platform)", () =>
        thClient.messaging.v1.services(mgSid).fetch()
      );
      mgExists = Boolean(mg2);
      console.log(`  MessagingService ${mgSid}: ${mg2 ? "found on platform" : "NOT FOUND"}`);
    } else {
      mgExists = Boolean(mg);
      console.log(`  MessagingService ${mgSid}: ${mg ? "found on tenant" : "NOT FOUND"}`);
    }
  } else {
    console.log(`  MessagingService: ${mgSid || "MISSING"}`);
  }

  // Campaign
  const campaignSid = profile.campaignSid || profile.usa2pSid || null;
  let campaignStatus: string | null = null;
  if (campaignSid && mgSid && tenantClient) {
    const ca = await tryFetch("Campaign", () =>
      tenantClient.messaging.v1.services(mgSid).usAppToPerson(campaignSid).fetch()
    );
    if (ca) campaignStatus = normUpper((ca as any).campaignStatus || (ca as any).status);
    console.log(`  Campaign ${campaignSid}: ${ca ? campaignStatus : "NOT FOUND / wrong service"}`);
  } else {
    console.log(`  Campaign: ${campaignSid || "MISSING"}`);
  }

  // --- Determine next action ---
  console.log("\n--- NEXT ACTION ---");

  const profileApproved = TRUSTHUB_APPROVED.has(profileStatus);
  const trustApproved = TRUSTHUB_APPROVED.has(trustStatus);
  const trustInReview = trustStatus === "IN_REVIEW" || trustStatus === "PENDING_REVIEW";
  const brandApproved = brandStatus ? BRAND_OK.has(brandStatus) : false;
  const campaignApproved = campaignStatus ? CAMPAIGN_OK.has(campaignStatus) : false;

  if (!profileApproved) {
    console.log("NEXT: A — Customer Profile is NOT approved. Status:", profileStatus || "(unknown)");
    console.log("  → Wait for Twilio to approve the Customer Profile.");
  } else if (!profile.trustProductSid || trustStatus === "") {
    console.log("NEXT: B — Profile approved but no Trust Product. Safe to submit brand.");
    if (trustApproved) {
      console.log("  Actually: Trust Product is approved → see brand step.");
    } else {
      console.log("  Brand payload when ready:");
      console.log("  client.messaging.v1.brandRegistrations.create({");
      console.log(`    customerProfileBundleSid: "${profile.profileSid}",`);
      console.log(`    a2PProfileBundleSid: "<trustProductSid after creation>",`);
      console.log(`    brandType: "LOW_VOLUME_STANDARD",`);
      console.log("  })");
      console.log("  → Run resumeAutomation to create Trust Product first.");
    }
  } else if (trustInReview) {
    console.log("NEXT: A — Trust Product IN_REVIEW. Do NOT submit brand yet.");
    console.log(`  → trustProductSid: ${profile.trustProductSid}`);
    console.log("  → Wait for Twilio to approve the Trust Product.");
    console.log("  → Run /api/a2p/sync periodically to advance when approved.");
  } else if (trustApproved && !brandSidStored) {
    console.log("NEXT: B — Trust Product approved + brandSid missing. Safe to submit brand.");
    console.log("  Brand payload:");
    console.log("  client.messaging.v1.brandRegistrations.create({");
    console.log(`    customerProfileBundleSid: "${profile.profileSid}",`);
    console.log(`    a2PProfileBundleSid: "${profile.trustProductSid}",`);
    console.log(`    brandType: "LOW_VOLUME_STANDARD",`);
    console.log("  })");
    console.log("  → Run --advance (calls resumeAutomation) to trigger automatically.");
  } else if (brandSidStored && !brandApproved) {
    console.log("NEXT: Waiting for Brand approval.");
    console.log(`  → brandSid: ${brandSidStored}, status: ${brandStatus || "(unknown)"}`);
    console.log("  → Wait for Twilio to approve the Brand.");
  } else if (brandApproved && !campaignSid) {
    console.log("NEXT: D — Brand approved + campaign missing. Safe to create campaign.");
    console.log("  → Run --advance to trigger campaign creation automatically.");
  } else if (campaignSid && !campaignApproved) {
    console.log("NEXT: Waiting for Campaign approval.");
    console.log(`  → campaignSid: ${campaignSid}, status: ${campaignStatus || "(unknown)"}`);
  } else if (campaignApproved && !profile.messagingReady) {
    console.log("NEXT: E — Campaign approved but messagingReady=false.");
    console.log("  → Run --advance to mark ready.");
  } else if (profile.messagingReady) {
    console.log("NEXT: DONE — messagingReady=true. All steps complete.");
  } else {
    console.log("NEXT: F — Blocked. Required fields missing:");
    if (!profile.profileSid) console.log("  - profileSid missing");
    if (!profile.trustProductSid) console.log("  - trustProductSid missing");
    if (!profile.messagingServiceSid) console.log("  - messagingServiceSid missing");
    if (!profile.sampleMessages && !profile.sampleMessagesArr?.length) console.log("  - sampleMessages missing");
    if (!profile.lastSubmittedOptInDetails && !profile.optInDetails) console.log("  - optInDetails missing");
  }

  console.log("\n" + "=".repeat(72));

  if (ADVANCE) {
    console.log("\n[--advance] Calling resumeA2PAutomationForUserEmail...");
    try {
      const result = await resumeA2PAutomationForUserEmail(ONLY_EMAIL);
      console.log("[--advance] DONE. Updated state:");
      console.log({
        profileSid: result?.profileSid,
        profileStatus: result?.profileStatus,
        trustProductSid: result?.trustProductSid,
        trustProductStatus: result?.trustProductStatus,
        brandSid: result?.brandSid,
        brandStatus: result?.brandStatus,
        campaignSid: result?.campaignSid || result?.usa2pSid,
        campaignStatus: result?.campaignStatus,
        messagingReady: result?.messagingReady,
        registrationStatus: result?.registrationStatus,
      });
    } catch (e: any) {
      console.error("[--advance] FAILED:", e?.message || e);
    }
  } else {
    console.log("(Dry run — pass --advance to call resumeAutomation)");
  }

  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e?.message || e); process.exit(1); });
