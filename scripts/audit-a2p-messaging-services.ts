import "dotenv/config";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { ensureMessagingServiceA2PReadyForUser } from "@/lib/a2p/ensureMessagingServiceA2PReady";

function parseArgs() {
  const argv = process.argv.slice(2);
  const emailArg = argv.find((arg) => arg.startsWith("--email="));
  const userIdArg = argv.find((arg) => arg.startsWith("--userId="));
  return {
    email: emailArg ? emailArg.slice("--email=".length).toLowerCase().trim() : "",
    userId: userIdArg ? userIdArg.slice("--userId=".length).trim() : "",
  };
}

async function loadCandidateUsers(email?: string, userId?: string) {
  const profiles = await A2PProfile.find({
    ...(email ? { userEmail: email } : {}),
    ...(userId ? { userId } : {}),
    $or: [
      { messagingServiceSid: { $exists: true, $ne: "" } },
      { campaignSid: { $exists: true, $ne: "" } },
      { usa2pSid: { $exists: true, $ne: "" } },
      { brandSid: { $exists: true, $ne: "" } },
      { applicationStatus: "approved" },
      { registrationStatus: { $in: ["brand_approved", "campaign_approved", "ready"] } },
    ],
  }).lean<any[]>();

  const userIds = profiles.map((profile) => String(profile.userId)).filter(Boolean);
  const users = await User.find({
    ...(email ? { email } : {}),
    ...(userId ? { _id: userId } : {}),
    $or: [
      { _id: { $in: userIds } },
      { "a2p.messagingServiceSid": { $exists: true, $ne: "" } },
      { "a2p.brandSid": { $exists: true, $ne: "" } },
      { "a2p.campaignSid": { $exists: true, $ne: "" } },
      { "a2p.usa2pSid": { $exists: true, $ne: "" } },
      { "a2p.messagingReady": true },
    ],
  }).lean<any[]>();

  const byId = new Map(users.map((user) => [String(user._id), user]));
  for (const profile of profiles) {
    if (!byId.has(String(profile.userId))) {
      const user = await User.findById(profile.userId).lean<any>();
      if (user) byId.set(String(user._id), user);
    }
  }
  return Array.from(byId.values());
}

async function main() {
  const { email, userId } = parseArgs();
  await mongooseConnect();
  const users = await loadCandidateUsers(email, userId);
  const rows: any[] = [];

  for (const user of users) {
    try {
      const result = await ensureMessagingServiceA2PReadyForUser(user, {
        dryRun: true,
        repair: false,
        attachNumbers: false,
        logPrefix: "audit-a2p",
      });
      rows.push({
        email: result.email,
        userId: result.userId,
        accountSid: result.accountSid,
        messagingServiceSid: result.messagingServiceSid,
        serviceUsecase: result.serviceUsecase,
        serviceA2PRegistered: result.serviceA2PRegistered,
        senderPoolCount: result.senderPoolCount,
        dbBrandStatus: result.brandStatus,
        dbCampaignStatus: result.campaignStatus,
        dbCampaignSid: result.campaignSid,
        canActuallySendSms: result.canSendSms,
        reason: result.blockedReason,
      });
    } catch (err: any) {
      rows.push({
        email: user.email,
        userId: String(user._id),
        accountSid: user?.twilio?.accountSid || null,
        messagingServiceSid: user?.a2p?.messagingServiceSid || null,
        serviceUsecase: null,
        serviceA2PRegistered: false,
        senderPoolCount: 0,
        dbBrandStatus: user?.a2p?.brandStatus || null,
        dbCampaignStatus: user?.a2p?.campaignStatus || null,
        dbCampaignSid: user?.a2p?.campaignSid || user?.a2p?.usa2pSid || null,
        canActuallySendSms: false,
        reason: err?.message || String(err),
      });
    }
  }

  console.log(JSON.stringify({ checked: rows.length, rows }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
