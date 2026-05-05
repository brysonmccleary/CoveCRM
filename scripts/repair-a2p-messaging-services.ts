import "dotenv/config";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { ensureMessagingServiceA2PReadyForUser } from "@/lib/a2p/ensureMessagingServiceA2PReady";

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = new Set(argv);
  const execute = args.has("--execute");
  const dryRun = !execute || args.has("--dry-run");
  const emailArg = argv.find((arg) => arg.startsWith("--email="));
  const userIdArg = argv.find((arg) => arg.startsWith("--userId="));
  return {
    dryRun,
    execute,
    onlyUnregistered: args.has("--only-unregistered"),
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

function summarize(user: any, result: any, errors: string[] = []) {
  return {
    email: user.email,
    userId: String(user._id),
    accountSid: result?.accountSid || user?.twilio?.accountSid || null,
    messagingServiceSid: result?.messagingServiceSid || user?.a2p?.messagingServiceSid || null,
    serviceUsecase: result?.serviceUsecase || null,
    serviceA2PRegistered: result?.serviceA2PRegistered ?? false,
    senderPoolCount: result?.senderPoolCount ?? 0,
    dbBrandStatus: result?.brandStatus || user?.a2p?.brandStatus || null,
    dbCampaignStatus: result?.campaignStatus || user?.a2p?.campaignStatus || null,
    dbCampaignSid: result?.campaignSid || user?.a2p?.campaignSid || user?.a2p?.usa2pSid || null,
    campaignResolveReason: result?.campaignResolveReason || null,
    beforeRegistered: result?.beforeRegistered ?? null,
    afterRegistered: result?.serviceA2PRegistered ?? false,
    canSendSms: result?.canSendSms ?? false,
    reason: errors.length ? errors.join("; ") : result?.blockedReason || null,
    attachedNumbers: result?.attachedNumbers || [],
    numbersMissing: result?.numbersMissing || [],
    skippedNumbers: result?.skippedNumbers || [],
    errors,
  };
}

async function main() {
  const { dryRun, execute, onlyUnregistered, email, userId } = parseArgs();
  if (!dryRun && !execute) throw new Error("Use --dry-run or --execute.");

  await mongooseConnect();
  const users = await loadCandidateUsers(email, userId);
  const summaries: any[] = [];

  for (const user of users) {
    try {
      const audit = await ensureMessagingServiceA2PReadyForUser(user, {
        dryRun: true,
        repair: false,
        attachNumbers: false,
        logPrefix: "repair-a2p:audit",
      });

      if (onlyUnregistered && audit.canSendSms) {
        summaries.push({ ...summarize(user, audit), skipped: "already_ready" });
        continue;
      }

      const result = await ensureMessagingServiceA2PReadyForUser(user, {
        dryRun,
        repair: true,
        attachNumbers: true,
        logPrefix: dryRun ? "repair-a2p:dry-run" : "repair-a2p:execute",
      });
      summaries.push(summarize(user, result));
    } catch (err: any) {
      summaries.push(summarize(user, null, [err?.message || String(err)]));
    }
  }

  console.log(JSON.stringify({ dryRun, execute, onlyUnregistered, checked: summaries.length, summaries }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
