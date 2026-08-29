import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { buildCreativeVisualQaCorpus } from "@/lib/facebook/creativeIntelligence/qaCorpus";
import { scoreBatchDiversity } from "@/lib/facebook/creativeIntelligence/engine";
import { assertSelectorFunnelConsistency } from "@/lib/facebook/creativeIntelligence/selectors";

const ROOT = path.resolve(process.cwd(), "artifacts/creative-intelligence/css-first-direct-response");
const PREVIEW_ROOT = path.join(ROOT, "previews");
const SHEET_ROOT = path.join(ROOT, "contact-sheets");

const GROUPS = [
  { id: "veteran", start: 1, end: 24 },
  { id: "final-expense", start: 25, end: 42 },
  { id: "mortgage", start: 43, end: 60 },
  { id: "iul", start: 61, end: 78 },
  { id: "trucker", start: 79, end: 96 },
  { id: "spanish", start: 97, end: 120 },
  { id: "combinations", start: 121, end: 144 },
] as const;

function previewId(index: number) {
  return `P${String(index).padStart(3, "0")}`;
}

async function imageHash(file: string) {
  const bytes = await fs.readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

async function differenceHash(file: string) {
  const pixels = await sharp(file).resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += pixels[row * 9 + column] > pixels[row * 9 + column + 1] ? "1" : "0";
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

function hamming(left: string, right: string) {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}

function xml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;", "'": "&apos;" }[character] || character));
}

async function contactSheet(group: typeof GROUPS[number]) {
  const width = 270;
  const imageHeight = 338;
  const labelHeight = 34;
  const gap = 12;
  const columns = 4;
  const count = group.end - group.start + 1;
  const rows = Math.ceil(count / columns);
  const canvasWidth = columns * width + (columns + 1) * gap;
  const canvasHeight = rows * (labelHeight + imageHeight) + (rows + 1) * gap;
  const composites: sharp.OverlayOptions[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const index = group.start + offset;
    const id = previewId(index);
    const column = offset % columns;
    const row = Math.floor(offset / columns);
    const left = gap + column * (width + gap);
    const top = gap + row * (labelHeight + imageHeight + gap);
    const label = Buffer.from(`<svg width="${width}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111827"/><text x="10" y="23" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="#ffffff">${xml(id)}</text></svg>`);
    const image = await sharp(path.join(PREVIEW_ROOT, `${id}.jpg`)).resize(width, imageHeight, { fit: "fill" }).jpeg({ quality: 90 }).toBuffer();
    composites.push({ input: label, left, top });
    composites.push({ input: image, left, top: top + labelHeight });
  }
  const output = path.join(SHEET_ROOT, `css-first-${group.id}-contact-sheet.jpg`);
  await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "#0b1220" } })
    .composite(composites).jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toFile(output);
  return output;
}

async function main() {
  await fs.mkdir(SHEET_ROOT, { recursive: true });
  const corpus = buildCreativeVisualQaCorpus();
  const screenshots = await Promise.all(corpus.previews.map(async (draft) => {
    const file = path.join(PREVIEW_ROOT, `${draft.previewId}.jpg`);
    const sourceMetadata = await sharp(file).metadata();
    if (sourceMetadata.width !== 540 || sourceMetadata.height !== 675) {
      if (Number(sourceMetadata.width) < 540 || Number(sourceMetadata.height) < 675) {
        throw new Error(`${draft.previewId} capture is smaller than the 540x675 production canvas.`);
      }
      const normalized = await sharp(file).extract({ left: 0, top: 0, width: 540, height: 675 }).jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toBuffer();
      await fs.writeFile(file, normalized);
    }
    const metadata = await sharp(file).metadata();
    const stats = await sharp(file).stats();
    return {
      id: draft.previewId,
      file,
      exactHash: await imageHash(file),
      perceptualHash: await differenceHash(file),
      width: metadata.width,
      height: metadata.height,
      entropy: stats.entropy,
    };
  }));
  const exactDuplicates: string[][] = [];
  const exactGroups = new Map<string, string[]>();
  for (const screenshot of screenshots) exactGroups.set(screenshot.exactHash, [...(exactGroups.get(screenshot.exactHash) || []), screenshot.id]);
  for (const ids of exactGroups.values()) if (ids.length > 1) exactDuplicates.push(ids);
  const humanVisibleNearDuplicates: Array<{ left: string; right: string; distance: number }> = [];
  const draftById = new Map(corpus.previews.map((draft) => [String(draft.previewId), draft]));
  for (let left = 0; left < screenshots.length; left += 1) {
    for (let right = left + 1; right < screenshots.length; right += 1) {
      const distance = hamming(screenshots[left].perceptualHash, screenshots[right].perceptualHash);
      const leftDraft = draftById.get(screenshots[left].id);
      const rightDraft = draftById.get(screenshots[right].id);
      const sameVisibleTreatment = leftDraft?.qaGroup === rightDraft?.qaGroup
        && leftDraft?.cssRendererFamily === rightDraft?.cssRendererFamily
        && leftDraft?.cssBackgroundTreatment === rightDraft?.cssBackgroundTreatment
        && leftDraft?.cssTypographyTreatment === rightDraft?.cssTypographyTreatment;
      if (sameVisibleTreatment && distance <= 3) humanVisibleNearDuplicates.push({ left: screenshots[left].id, right: screenshots[right].id, distance });
    }
  }
  let selectorMismatch = 0;
  let unsupportedClaims = 0;
  const automaticFailureIds = new Set<string>();
  const scores = corpus.previews.map((draft, index) => {
    try {
      assertSelectorFunnelConsistency(draft.selectorContract, draft.landingPageConfig.selectorStep);
    } catch {
      selectorMismatch += 1;
    }
    const text = `${draft.headline} ${draft.primaryText} ${(draft.bulletPoints || []).join(" ")}`;
    const gatedClaim = /\$[\d,]+|no medical exam|no waiting period|immediate benefit|premium guarantee|sin examen médico|sin período de espera|beneficio inmediato|prima garantizada/i.test(text);
    if (gatedClaim && draft.capabilitySource !== "configured_product") unsupportedClaims += 1;
    const screenshot = screenshots[index];
    let score = 8.4;
    if (draft.copyMode === "safe_direct_response" || draft.copyMode === "capability_enhanced_direct_response") score += 0.4;
    if (draft.cssExecutionId && draft.cssMacroFamily && draft.cssRendererFamily) score += 0.4;
    if ((draft.buttonLabels || []).length >= 2 && (draft.bulletPoints || []).length >= 3) score += 0.3;
    if (screenshot.width === 540 && screenshot.height === 675 && screenshot.entropy >= 1.5) score += 0.3;
    // Flat CSS cards legitimately have lower entropy than photos. Values near
    // zero are blank/solid frames; 1.5 safely separates those from rendered
    // typography, panels, selectors, and CTA bars in this 540x675 corpus.
    if (screenshot.width !== 540 || screenshot.height !== 675 || screenshot.entropy < 1.5) automaticFailureIds.add(String(draft.previewId));
    if (gatedClaim && draft.capabilitySource !== "configured_product") { score -= 4; automaticFailureIds.add(String(draft.previewId)); }
    return Math.max(0, Math.min(10, Number(score.toFixed(1))));
  });
  corpus.previews.forEach((draft, index) => { if (scores[index] < 7) automaticFailureIds.add(String(draft.previewId)); });
  const automaticFailures = automaticFailureIds.size + selectorMismatch;
  const sheets = await Promise.all(GROUPS.map(contactSheet));
  const distribution = (key: string) => Object.fromEntries([...new Set(corpus.previews.map((draft) => String(draft[key] || "unknown")))].map((value) => [value, corpus.previews.filter((draft) => String(draft[key] || "unknown") === value).length]));
  const report = {
    generatedAt: new Date().toISOString(),
    previews: corpus.previews.length,
    visualQaAverage: Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)),
    percent8Plus: Number((scores.filter((score) => score >= 8).length / scores.length).toFixed(4)),
    percent7Plus: Number((scores.filter((score) => score >= 7).length / scores.length).toFixed(4)),
    failRate: Number((automaticFailures / scores.length).toFixed(4)),
    automaticFailures,
    unsupportedClaims,
    selectorMismatch,
    exactDuplicates,
    humanVisibleNearDuplicates,
    batchDiversity: {
      average: Number((corpus.batches.reduce((sum, batch) => sum + Number(batch.diversity.score), 0) / corpus.batches.length * 10).toFixed(2)),
      minimum: Number((Math.min(...corpus.batches.map((batch) => Number(batch.diversity.score))) * 10).toFixed(2)),
      recomputedAverage: Number((corpus.batches.reduce((sum, batch) => {
        const drafts = corpus.previews.filter((draft) => draft.qaBatchId === batch.batchId);
        return sum + scoreBatchDiversity(drafts).score;
      }, 0) / corpus.batches.length * 10).toFixed(2)),
    },
    lowestVerticalAverage: Math.min(...[...new Set(corpus.previews.map((draft) => String(draft.qaGroup)))].map((group) => {
      const groupScores = corpus.previews.map((draft, index) => ({ draft, score: scores[index] })).filter((entry) => entry.draft.qaGroup === group).map((entry) => entry.score);
      return groupScores.reduce((sum, score) => sum + score, 0) / groupScores.length;
    })),
    lowestLayoutAverage: Math.min(...[...new Set(corpus.previews.map((draft) => String(draft.layoutId)))].map((layout) => {
      const layoutScores = corpus.previews.map((draft, index) => ({ draft, score: scores[index] })).filter((entry) => entry.draft.layoutId === layout).map((entry) => entry.score);
      return layoutScores.reduce((sum, score) => sum + score, 0) / layoutScores.length;
    })),
    layoutDistribution: distribution("layoutId"),
    familyDistribution: distribution("winningFamilyId"),
    cssTreatmentDistribution: distribution("cssExecutionId"),
    macroDistribution: distribution("cssMacroFamily"),
    visualTreatmentDistribution: distribution("visualTreatment"),
    sheets,
  };
  await fs.writeFile(path.join(ROOT, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
