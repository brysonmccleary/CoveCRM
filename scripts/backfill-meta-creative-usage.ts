import "dotenv/config";
import { createHash } from "crypto";
import mongooseConnect from "../lib/mongooseConnect";
import MetaLaunchArchive from "../models/MetaLaunchArchive";
import MetaCreativeUsage from "../models/MetaCreativeUsage";
import { buildPublishedCreativeFingerprint } from "../lib/facebook/creativeIdentity";

async function main() {
  await mongooseConnect();
  await MetaCreativeUsage.init();
  let archives = 0;
  let creatives = 0;

  const cursor = MetaLaunchArchive.find({}).lean().cursor();
  for await (const archive of cursor as any) {
    archives += 1;
    const images = Array.isArray(archive.images) ? archive.images : [];
    const copies = Array.isArray(archive.adCopy) ? archive.adCopy : [];
    for (let index = 0; index < images.length; index++) {
      const image = images[index] || {};
      const variantId = String(image.variantId || "");
      const copy = copies.find((candidate: any) => String(candidate?.variantId || "") === variantId)
        || copies[index]
        || {};
      const dataUrl = String(image.dataUrl || "").trim();
      if (!dataUrl) continue;
      const creativeFingerprint = buildPublishedCreativeFingerprint({
        primaryText: copy.primaryText,
        headline: copy.headline,
        description: copy.description,
        cta: copy.cta,
        renderedCreativeDataUrl: dataUrl,
      });
      const generationSignature = `legacy_cgs_${createHash("sha256").update(creativeFingerprint).digest("hex")}`;
      await MetaCreativeUsage.updateOne(
        { creativeFingerprint },
        {
          $setOnInsert: {
            creativeFingerprint,
            generationSignature,
            status: "published",
            claimToken: "",
            claimedAt: archive.archivedAt || archive.createdAt || new Date(),
            publishedAt: archive.archivedAt || archive.createdAt || new Date(),
            userEmail: String(archive.userEmail || "").toLowerCase(),
            campaignId: archive.campaignId,
            leadType: String(archive.leadType || "unknown"),
            winningFamilyId: String(copy.creativeFamily || ""),
            variationType: "",
            metaAdId: String(archive.metaObjectIds?.ads?.[index]?.adId || ""),
            metaCreativeId: String(archive.metaObjectIds?.ads?.[index]?.creativeId || ""),
          },
        },
        { upsert: true }
      );
      creatives += 1;
    }
  }

  console.log(JSON.stringify({ ok: true, archives, creatives }));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

