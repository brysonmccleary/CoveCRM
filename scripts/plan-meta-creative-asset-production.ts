import { buildUnfundedStaticAssetQueue, MASS_ASSET_COST_PLAN } from "@/lib/facebook/creativeAssets/productionPlan";
import { buildPendingVideoFrameworks } from "@/lib/facebook/creativeAssets/videoFrameworks";

const queue = buildUnfundedStaticAssetQueue();
const frameworks = buildPendingVideoFrameworks();
const maximumTextCost = queue.length * MASS_ASSET_COST_PLAN.maximumPromptTokensPerAsset
  / 1_000_000 * MASS_ASSET_COST_PLAN.textInputCostPerMillionTokensUsd;
const imageOutputCost = queue.length * MASS_ASSET_COST_PLAN.imageOutputCostPerAssetUsd;
const estimatedStorageGb = MASS_ASSET_COST_PLAN.estimatedNewAssetBytes / 1_000_000_000;
const storageCost = estimatedStorageGb * MASS_ASSET_COST_PLAN.blobStorageCostPerGbMonthUsd;

console.log(JSON.stringify({
  authorizationState: "PLANNED_UNFUNDED_DO_NOT_GENERATE",
  ...MASS_ASSET_COST_PLAN,
  imageOutputCostUsd: Number(imageOutputCost.toFixed(2)),
  maximumTextInputCostUsd: Number(maximumTextCost.toFixed(2)),
  maximumExpectedGenerationCostUsd: Number((imageOutputCost + maximumTextCost).toFixed(2)),
  estimatedStorageGb: Number(estimatedStorageGb.toFixed(4)),
  rawOnDemandStorageCostUsdPerMonth: Number(storageCost.toFixed(4)),
  marginalStorageCostWithinVercelProAllowanceUsd: 0,
  actualVideoAssets: 0,
  videoFrameworksPlanned: frameworks.length,
  videoRenderingCost: "UNKNOWN_UNTIL_VENDOR_AND_RENDER_METHOD_ARE_AUTHORIZED",
  lanes: Object.fromEntries([...new Set(queue.map((job) => job.laneId))].map((lane) => [lane, queue.filter((job) => job.laneId === lane).length])),
  queue,
  videoFrameworks: frameworks,
}, null, 2));
