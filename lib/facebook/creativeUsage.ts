import { randomUUID } from "crypto";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import MetaCreativeAsset from "@/models/MetaCreativeAsset";
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

export const DRAFT_RESERVATION_MINUTES = 90;

function usageFields(draft: Record<string, any>) {
  return {
    leadType: String(draft?.leadType || ""),
    winningFamilyId: String(draft?.winningFamilyId || draft?.creativeFamily || ""),
    creativeClass: String(draft?.creativeClass || ""),
    layoutId: String(draft?.layoutId || ""),
    hookClass: String(draft?.hookClass || ""),
    headline: String(draft?.headline || ""),
    primaryText: String(draft?.primaryText || ""),
    description: String(draft?.description || ""),
    bulletPoints: Array.isArray(draft?.bulletPoints) ? draft.bulletPoints.map(String) : [],
    cta: String(draft?.cta || ""),
    imageDirection: String(draft?.imageDirection || draft?.imageUrl || ""),
    imageIdentity: String(draft?.imageIdentity || draft?.imageUrl || ""),
    assetId: String(draft?.assetId || ""),
    assetVisualFingerprint: String(draft?.assetVisualFingerprint || ""),
    backgroundDirection: String(draft?.backgroundDirection || draft?.backgroundImage || ""),
    palette: String(draft?.paletteId || draft?.colorScheme || ""),
    offerClass: String(draft?.offerClass || draft?.displayAmount || ""),
    selectorSchema: draft?.selectorContract || null,
    semanticFingerprint: String(draft?.semanticFingerprint || ""),
    visualFingerprint: String(draft?.visualFingerprint || ""),
    variationType: String(draft?.variationType || ""),
  };
}

export async function reserveGeneratedDrafts(input: {
  userEmail: string;
  generationId: string;
  drafts: Array<Record<string, any>>;
  ttlMinutes?: number;
  usageModel?: any;
}): Promise<{ reservationId: string; expiresAt: Date }> {
  const usageModel = input.usageModel || MetaCreativeUsage;
  if (typeof usageModel.init === "function") await usageModel.init();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(5, input.ttlMinutes || DRAFT_RESERVATION_MINUTES) * 60_000);
  await usageModel.deleteMany({ status: "draft_reserved", expiresAt: { $lte: now } });
  const reservationId = randomUUID();
  const rows = input.drafts.map((draft) => {
    const generationSignature = String(draft?.creativeSignature || "").trim() || buildCreativeGenerationSignature(draft);
    const renderedAsset = String(draft?.renderedCreativeDataUrl || draft?.imageUrl || "").trim();
    return {
      creativeFingerprint: renderedAsset ? buildPublishedCreativeFingerprint(draft) : `draft_${generationSignature}`,
      generationSignature,
      status: "draft_reserved",
      claimToken: "",
      claimedAt: now,
      publishedAt: null,
      userEmail: input.userEmail,
      campaignId: null,
      generationId: input.generationId,
      reservationId,
      expiresAt,
      ...usageFields(draft),
      metaAdId: "",
      metaCreativeId: "",
    };
  });
  if (new Set(rows.map((row) => row.generationSignature)).size !== rows.length) {
    throw new Error("Generated creative set contains an exact duplicate.");
  }
  try {
    await usageModel.insertMany(rows, { ordered: true });
  } catch (error: any) {
    await usageModel.deleteMany({ reservationId, status: "draft_reserved" }).catch(() => {});
    if (error?.code === 11000) throw new Error(CREATIVE_ALREADY_USED_MESSAGE);
    throw error;
  }
  return { reservationId, expiresAt };
}

export async function releaseGeneratedDrafts(input: {
  userEmail: string;
  generationId?: string;
  reservationId?: string;
  usageModel?: any;
}) {
  const usageModel = input.usageModel || MetaCreativeUsage;
  const filter: Record<string, any> = { userEmail: input.userEmail, status: "draft_reserved" };
  if (input.generationId) filter.generationId = input.generationId;
  if (input.reservationId) filter.reservationId = input.reservationId;
  if (!input.generationId && !input.reservationId) return { deletedCount: 0 };
  return usageModel.deleteMany(filter);
}

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
      let claimed = Number(draft?.creativeEngineVersion || 0) >= 1 ? await usageModel.findOneAndUpdate(
        {
          generationSignature: reservation.generationSignature,
          status: "draft_reserved",
          userEmail: input.userEmail,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: "reserved",
            claimToken,
            claimedAt: new Date(),
            expiresAt: null,
            campaignId: input.campaignId,
            creativeFingerprint: reservation.creativeFingerprint,
            ...usageFields(draft),
          },
        },
        { new: true }
      ) : null;
      if (!claimed) claimed = await usageModel.findOneAndUpdate(
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
            metaAdId: "",
            metaCreativeId: "",
            expiresAt: null,
            ...usageFields(draft),
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
  assetModel?: any;
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
        expiresAt: null,
      },
    },
    { new: true }
  );
  if (!result) throw new Error("Creative uniqueness reservation was lost before publish finalized");
  const assetId = String(result?.assetId || "").trim();
  if (assetId) {
    const assetModel = input.assetModel || MetaCreativeAsset;
    await assetModel.findOneAndUpdate(
      { assetId, active: true, approvalStatus: "approved" },
      { $inc: { useCount: 1 }, $set: { lastUsedAt: new Date() } }
    );
  }
  return result;
}

export async function releaseCreativeSet(claimToken: string, usageModel: any = MetaCreativeUsage) {
  if (!claimToken) return;
  await usageModel.deleteMany({ claimToken, status: "reserved" });
}
