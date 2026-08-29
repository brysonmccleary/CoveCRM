import fs from "fs";
import path from "path";
import { buildCreativeDepthCollisionCorpus } from "../lib/facebook/creativeIntelligence/qaCorpus";

function counts(rows: Array<Record<string, any>>, key: string) {
  const map = new Map<string, number>();
  rows.forEach((row) => map.set(String(row[key] || "unknown"), (map.get(String(row[key] || "unknown")) || 0) + 1));
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count, share: Number((count / rows.length).toFixed(4)) }));
}

function structuralKey(row: Record<string, any>) {
  return [row.cssMacroFamily, row.cssCompositionVariant, row.layoutId, row.cssRendererFamily, row.cssHierarchyTreatment,
    row.cssPanelStructure, row.cssTypographyTreatment, row.cssSelectorPresentation, row.cssBenefitTreatment,
    row.cssBackgroundTreatment, row.cssCtaTreatment, row.cssFrameTreatment, row.cssWhitespaceTreatment].join("|");
}

function pairCollisionRate(groups: Array<{ count: number }>, total: number) {
  const collidingPairs = groups.reduce((sum, group) => sum + (group.count * (group.count - 1)) / 2, 0);
  const possiblePairs = (total * (total - 1)) / 2;
  return Number((collidingPairs / Math.max(1, possiblePairs)).toFixed(6));
}

const corpus = buildCreativeDepthCollisionCorpus();
const sheetDirectory = path.resolve("artifacts/creative-intelligence/css-first-direct-response/depth-contact-sheets");
const renderedSheets = fs.existsSync(sheetDirectory) ? fs.readdirSync(sheetDirectory).filter((file) => file.endsWith(".jpg")).sort() : [];
const semanticGroups = counts(corpus.previews, "semanticFingerprint");
const structural = new Map<string, Array<Record<string, any>>>();
corpus.previews.forEach((row) => structural.set(structuralKey(row), [...(structural.get(structuralKey(row)) || []), row]));
const structuralClusters = [...structural.entries()].sort((a, b) => b[1].length - a[1].length);
const lanes = Object.fromEntries([...new Set(corpus.previews.map((row) => String(row.qaConfigLabel)))].map((label) => {
  const rows = corpus.previews.filter((row) => row.qaConfigLabel === label);
  const laneStructuralGroups = counts(rows.map((row) => ({ key: structuralKey(row) })), "key");
  return [label, {
    sampled: rows.length,
    semanticUnique: new Set(rows.map((row) => row.semanticFingerprint)).size,
    structuralClusters: new Set(rows.map(structuralKey)).size,
    largestStructuralCluster: Math.max(...laneStructuralGroups.map((entry) => entry.count)),
    substantiallyUniqueShare: Number((new Set(rows.map(structuralKey)).size / rows.length).toFixed(4)),
    randomPairStructuralCollisionRate: pairCollisionRate(laneStructuralGroups, rows.length),
    compositionVariants: new Set(rows.map((row) => row.cssCompositionVariant)).size,
    macroFamilies: new Set(rows.map((row) => row.cssMacroFamily)).size,
    executionIds: new Set(rows.map((row) => row.cssExecutionId)).size,
  }];
}));

const report = {
  generatedAt: new Date().toISOString(), previewOnly: true, metaObjectsCreated: 0, coveObjectsCreated: 0,
  sample: corpus.previews.length,
  requiredAllocation: { veteran: 150, finalExpense: 150, mortgage: 150, iul: 150, trucker: 150, spanish: 200 },
  semanticExactDuplicates: semanticGroups.filter((group) => group.count > 1).length,
  semanticUnique: semanticGroups.length,
  structuralClusterCount: structuralClusters.length,
  largestStructuralCluster: structuralClusters[0]?.[1].length || 0,
  largestStructuralClusterShare: Number(((structuralClusters[0]?.[1].length || 0) / corpus.previews.length).toFixed(4)),
  substantiallyUniqueShare: Number((structuralClusters.length / corpus.previews.length).toFixed(4)),
  randomPairStructuralCollisionRate: pairCollisionRate(structuralClusters.map(([, rows]) => ({ count: rows.length })), corpus.previews.length),
  largestClusters: structuralClusters.slice(0, 20).map(([key, rows]) => ({ key, count: rows.length, previewIds: rows.slice(0, 8).map((row) => row.previewId) })),
  compositionConcentration: counts(corpus.previews, "cssCompositionVariant"),
  macroConcentration: counts(corpus.previews, "cssMacroFamily").slice(0, 20),
  layoutConcentration: counts(corpus.previews, "layoutId"),
  executionConcentration: counts(corpus.previews, "cssExecutionId").slice(0, 20),
  averageBatchDiversity: Number((corpus.batches.reduce((sum, batch) => sum + Number(batch.diversity.score), 0) / corpus.batches.length * 10).toFixed(2)),
  minimumBatchDiversity: Number((Math.min(...corpus.batches.map((batch) => Number(batch.diversity.score))) * 10).toFixed(2)),
  lanes,
  humanVisibleSheetEvidence: {
    browserRendered: renderedSheets.length === 38,
    renderedSheets: renderedSheets.length,
    previewsPerSheet: 25,
    renderedPreviewEvidence: renderedSheets.length * 25,
    directory: sheetDirectory,
    files: renderedSheets,
  },
};
const output = path.resolve("artifacts/creative-intelligence/css-first-direct-response/depth-collision-report.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, ...report }, null, 2)}\n`);
