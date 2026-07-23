import { randomUUID } from "crypto";

export async function claimLaunchCampaign(input: {
  campaignModel: { findOneAndUpdate: (...args: any[]) => Promise<any>; updateOne?: (...args: any[]) => Promise<any> };
  userEmail: string;
  launchFingerprint: string;
  setOnInsert: Record<string, any>;
  set: Record<string, any>;
}) {
  const launchClaimToken = randomUUID();
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  try {
    const campaign = await input.campaignModel.findOneAndUpdate(
      {
        userEmail: input.userEmail,
        launchFingerprint: input.launchFingerprint,
        $or: [
          { launchClaimToken: { $exists: false } },
          { launchClaimToken: "" },
          { launchClaimedAt: { $lt: staleBefore } },
          { metaPublishStatus: "success" },
        ],
      },
      {
        $setOnInsert: input.setOnInsert,
        $set: {
          ...input.set,
          launchFingerprint: input.launchFingerprint,
          launchClaimToken,
          launchClaimedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    if (!campaign) throw new Error("Identical campaign launch is already in progress");
    return { campaign, launchClaimToken };
  } catch (err: any) {
    if (err?.code === 11000) {
      throw new Error("Identical campaign launch is already in progress");
    }
    throw err;
  }
}

export async function releaseLaunchCampaignClaim(input: {
  campaignModel: { updateOne: (...args: any[]) => Promise<any> };
  campaignId: unknown;
  userEmail: string;
  launchClaimToken: string;
}) {
  await input.campaignModel.updateOne(
    { _id: input.campaignId, userEmail: input.userEmail, launchClaimToken: input.launchClaimToken },
    { $set: { launchClaimToken: "", launchClaimedAt: null } }
  );
}
