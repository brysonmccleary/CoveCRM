import { randomUUID } from "crypto";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import {
  buildCreativeGenerationSignature,
  buildPublishedCreativeFingerprint,
} from "@/lib/facebook/creativeIdentity";

export const CREATIVE_ALREADY_USED_MESSAGE =
  "That exact ad was just reserved or launched by another agent. Regenerate once to receive a fresh set.";

export type CreativeReservation = {
  creativeFingerprint: string;
  generationSignature: string;
};

export async function claimCreativeSet(input: {
  userEmail: string;
  campaignId: unknown;
  leadType: string;
  drafts: Array<Record<string, any>>;
  usageModel?: any;
}): Promise<{ claimToken: string; reservations: CreativeReservation[] }> {
  const usageModel = input.usageModel || MetaCreativeUsage;
  if (typeof usageModel.init === "function") await usageModel.init();

  const reservations = input.drafts.map((draft) => ({
    creativeFingerprint: buildPublishedCreativeFingerprint(draft),
    generationSignature: String(draft?.creativeSignature || "").trim()
      || buildCreativeGenerationSignature(draft),
  }));
  if (new Set(reservations.map((item) => item.creativeFingerprint)).size !== reservations.length
    || new Set(reservations.map((item) => item.generationSignature)).size !== reservations.length) {
    throw new Error("A launch set cannot contain the same creative twice. Regenerate once for a fresh set.");
  }

  const claimToken = randomUUID();
  try {
    for (let index = 0; index < reservations.length; index++) {
      const reservation = reservations[index];
      const draft = input.drafts[index] || {};
      const claimed = await usageModel.findOneAndUpdate(
        {
          creativeFingerprint: reservation.creativeFingerprint,
          status: "reserved",
          userEmail: input.userEmail,
          campaignId: input.campaignId,
        },
        {
          $setOnInsert: {
            creativeFingerprint: reservation.creativeFingerprint,
            generationSignature: reservation.generationSignature,
          },
          $set: {
            status: "reserved",
            claimToken,
            claimedAt: new Date(),
            publishedAt: null,
            userEmail: input.userEmail,
            campaignId: input.campaignId,
            leadType: input.leadType,
            winningFamilyId: String(draft?.winningFamilyId || ""),
            variationType: String(draft?.variationType || ""),
            metaAdId: "",
            metaCreativeId: "",
          },
        },
        { upsert: true, new: true }
      );
      if (!claimed) throw new Error(CREATIVE_ALREADY_USED_MESSAGE);
    }
  } catch (error: any) {
    await usageModel.deleteMany({ claimToken, status: "reserved" }).catch(() => {});
    if (error?.code === 11000 || String(error?.message || "").includes(CREATIVE_ALREADY_USED_MESSAGE)) {
      throw new Error(CREATIVE_ALREADY_USED_MESSAGE);
    }
    throw error;
  }

  return { claimToken, reservations };
}

export async function finalizeCreativeReservation(input: {
  claimToken: string;
  creativeFingerprint: string;
  metaAdId: string;
  metaCreativeId: string;
  usageModel?: any;
}) {
  const usageModel = input.usageModel || MetaCreativeUsage;
  const result = await usageModel.findOneAndUpdate(
    {
      claimToken: input.claimToken,
      creativeFingerprint: input.creativeFingerprint,
      status: "reserved",
    },
    {
      $set: {
        status: "published",
        publishedAt: new Date(),
        metaAdId: input.metaAdId,
        metaCreativeId: input.metaCreativeId,
        claimToken: "",
      },
    },
    { new: true }
  );
  if (!result) throw new Error("Creative uniqueness reservation was lost before publish finalized");
  return result;
}

export async function releaseCreativeSet(claimToken: string, usageModel: any = MetaCreativeUsage) {
  if (!claimToken) return;
  await usageModel.deleteMany({ claimToken, status: "reserved" });
}
