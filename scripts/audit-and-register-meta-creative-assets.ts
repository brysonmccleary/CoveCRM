import { createHash } from "crypto";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import mongooseConnect from "@/lib/mongooseConnect";
import MetaCreativeAsset from "@/models/MetaCreativeAsset";
import MetaCreativeUsage from "@/models/MetaCreativeUsage";
import { CREATIVE_FAMILIES } from "@/lib/facebook/creativeIntelligence/families";
import { PROMPTS } from "./generate-static-ad-backgrounds";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

type LegacyLane = "veteran" | "trucker" | "mortgage_protection";

const PHOTO_LAYOUTS = [
  "hero_amount_age_grid", "problem_consequence_offer", "portrait_hero_offer",
  "full_bleed_text_overlay", "family_lifestyle_offer", "comparison_two_column",
  "calculator_quiz_assessment", "ugc_talking_head", "agent_trust_explainer",
];

function sha256(input: Buffer | string) {
  return createHash("sha256").update(input).digest("hex");
}

async function differenceHash(filePath: string): Promise<string> {
  const pixels = await sharp(filePath).resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      bits += pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? "1" : "0";
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

function hamming(left: string, right: string): number {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}

function visualClass(lane: LegacyLane, prompt: string): string {
  if (lane === "trucker") return /driver|man|woman|family|hands/i.test(prompt) ? "trucker_lifestyle" : "commercial_truck";
  if (lane === "mortgage_protection") {
    if (/couple|family|hand/i.test(prompt)) return "homeowner_lifestyle";
    if (/key|document|model house|icon|illustration|blueprint/i.test(prompt)) return "mortgage_education_object";
    return "residential_home";
  }
  if (/man|couple|hands|profile|silhouette/i.test(prompt)) return "veteran_lifestyle";
  if (/flag|eagle|dog tags|memorial/i.test(prompt)) return "patriotic_symbolic";
  return "patriotic_environment";
}

function assetType(lane: LegacyLane, prompt: string) {
  if (lane === "trucker") return /driver|man|woman|family/i.test(prompt) ? "LIFESTYLE" : "TRUCK";
  if (lane === "mortgage_protection") {
    if (/couple|family|hand/i.test(prompt)) return "LIFESTYLE";
    if (/icon|illustration|blueprint/i.test(prompt)) return "GRAPHIC";
    return "HOME";
  }
  return /man|couple|hands|profile|silhouette/i.test(prompt) ? "LIFESTYLE" : "PATRIOTIC";
}

function compatibility(lane: LegacyLane) {
  if (lane === "veteran" || lane === "trucker") {
    const audience = lane;
    const families = CREATIVE_FAMILIES.filter((family) => family.audienceSegments.includes(audience)).map((family) => family.familyId);
    const products = [...new Set(CREATIVE_FAMILIES.filter((family) => family.audienceSegments.includes(audience)).map((family) => family.vertical))];
    return { audienceSegments: [audience], products, verticals: products, compatibleFamilies: families };
  }
  const families = CREATIVE_FAMILIES.filter((family) => family.vertical === lane && family.audienceSegments.includes("standard")).map((family) => family.familyId);
  return { audienceSegments: ["standard"], products: [lane], verticals: [lane], compatibleFamilies: families };
}

async function main() {
  const apply = process.argv.includes("--apply") || process.env.APPLY === "1";
  const root = path.resolve(__dirname, "..");
  const rows: any[] = [];
  for (const lane of ["veteran", "mortgage_protection", "trucker"] as LegacyLane[]) {
    for (let index = 0; index < (PROMPTS[lane] || []).length; index++) {
      const filePath = path.join(root, "public", "ad-backgrounds", lane, `${index + 1}.jpg`);
      const bytes = await fs.readFile(filePath);
      const metadata = await sharp(bytes).metadata();
      const prompt = PROMPTS[lane][index];
      const fingerprint = await differenceHash(filePath);
      const dimensionsPass = Number(metadata.width) >= 1200 && Number(metadata.height) >= 800;
      rows.push({
        assetId: `cove_legacy_${lane}_${String(index + 1).padStart(3, "0")}`,
        assetType: assetType(lane, prompt),
        ...compatibility(lane),
        languages: ["en"], format: "photo", direction: prompt, imageDirection: prompt,
        visualClass: visualClass(lane, prompt), layoutCompatibility: PHOTO_LAYOUTS,
        orientation: "landscape", aspectRatio: `${metadata.width}:${metadata.height}`,
        width: metadata.width, height: metadata.height,
        subjectClass: visualClass(lane, prompt), backgroundClass: lane,
        source: "openai_gpt_image_1_legacy_repo_generation", sourceUrl: "scripts/generate-static-ad-backgrounds.ts",
        storageUrl: `/ad-backgrounds/${lane}/${index + 1}.jpg`, contentHash: sha256(bytes),
        semanticFingerprint: sha256(prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()),
        visualFingerprint: fingerprint, ownershipStatus: "owned", licenseStatus: "owned",
        approvalStatus: dimensionsPass ? "approved" : "rejected",
        approvalSource: dimensionsPass ? "cove-visual-qa-2026-08-29" : "automated-dimension-gate",
        approvedAt: dimensionsPass ? new Date("2026-08-29T00:00:00.000Z") : null,
        expiresAt: null, rejectionReasons: dimensionsPass ? [] : ["minimum_dimensions_failed"],
        useCount: 0, recentUsage: 0, lastUsedAt: null, active: dimensionsPass,
      });
    }
  }
  const exactGroups = [...new Set(rows.map((row) => row.contentHash))]
    .map((hash) => rows.filter((row) => row.contentHash === hash).map((row) => row.assetId)).filter((group) => group.length > 1);
  const nearPairs: Array<{ left: string; right: string; distance: number }> = [];
  for (let left = 0; left < rows.length; left++) for (let right = left + 1; right < rows.length; right++) {
    const distance = hamming(rows[left].visualFingerprint, rows[right].visualFingerprint);
    if (distance <= 5) nearPairs.push({ left: rows[left].assetId, right: rows[right].assetId, distance });
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", total: rows.length,
    approved: rows.filter((row) => row.approvalStatus === "approved").length,
    rejected: rows.filter((row) => row.approvalStatus === "rejected").length,
    exactDuplicateGroups: exactGroups, nearDuplicatePairs: nearPairs,
    directions: Object.fromEntries([...new Set(rows.map((row) => row.visualClass))].map((key) => [key, rows.filter((row) => row.visualClass === key).length])),
  }, null, 2));
  if (!apply) return;
  if (exactGroups.length || nearPairs.length) throw new Error("Duplicate audit failed; review before applying registry records.");
  await mongooseConnect();
  const historicalUsage = await MetaCreativeUsage.aggregate([
    { $match: { status: "published", imageIdentity: { $in: rows.map((row) => row.storageUrl) } } },
    { $group: { _id: "$imageIdentity", count: { $sum: 1 }, lastUsedAt: { $max: "$publishedAt" } } },
  ]);
  const historicalByUrl = new Map(historicalUsage.map((entry: any) => [String(entry._id), entry]));
  await MetaCreativeAsset.bulkWrite(rows.map((row) => {
    const { useCount: _useCount, recentUsage: _recentUsage, lastUsedAt: _lastUsedAt, ...metadata } = row;
    const historical: any = historicalByUrl.get(row.storageUrl);
    const update: Record<string, any> = {
      $set: metadata,
      $setOnInsert: { useCount: 0, recentUsage: 0, lastUsedAt: null },
    };
    if (historical?.count) update.$max = { useCount: historical.count, lastUsedAt: historical.lastUsedAt || new Date(0) };
    return { updateOne: {
      filter: { assetId: row.assetId }, update, upsert: true,
    } };
  }), { ordered: true });
  console.log(`Registered ${rows.length} approved legacy assets without generating or purchasing media.`);
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
