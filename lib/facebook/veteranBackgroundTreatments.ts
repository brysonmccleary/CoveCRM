export const VETERAN_BACKGROUND_TREATMENTS = [
  "full_bleed_dark_overlay",
  "faint_full_background",
  "left_image_gradient",
  "right_image_gradient",
  "split_background",
  "hero_protected_background",
  "patriotic_texture",
  "top_environment_fade",
] as const;

export type VeteranBackgroundTreatment = typeof VETERAN_BACKGROUND_TREATMENTS[number];

const BASE_COMPATIBILITY: Record<string, VeteranBackgroundTreatment[]> = {
  VET_M01: ["full_bleed_dark_overlay", "faint_full_background", "patriotic_texture"],
  VET_M02: ["faint_full_background", "patriotic_texture"],
  VET_M03: ["full_bleed_dark_overlay", "hero_protected_background"],
  VET_M05: ["full_bleed_dark_overlay", "faint_full_background", "patriotic_texture"],
  VET_M07: ["left_image_gradient", "split_background"],
  VET_M08: ["faint_full_background", "top_environment_fade"],
  VET_M09: ["right_image_gradient", "faint_full_background", "hero_protected_background"],
  VET_M10: ["faint_full_background", "patriotic_texture"],
  VET_M11: ["full_bleed_dark_overlay", "patriotic_texture", "hero_protected_background"],
  VET_M13: ["top_environment_fade", "full_bleed_dark_overlay", "hero_protected_background"],
  VET_M14: ["left_image_gradient", "right_image_gradient", "split_background"],
  VET_M15: ["top_environment_fade", "faint_full_background"],
  VET_M16: ["left_image_gradient", "right_image_gradient", "split_background", "hero_protected_background"],
  VET_M18: ["patriotic_texture", "faint_full_background", "full_bleed_dark_overlay"],
  VET_M19: ["faint_full_background", "hero_protected_background", "right_image_gradient"],
  VET_M20: ["right_image_gradient", "split_background"],
  VET_M21: ["full_bleed_dark_overlay", "hero_protected_background", "top_environment_fade"],
  VET_M22: ["patriotic_texture", "full_bleed_dark_overlay"],
  VET_M23: ["faint_full_background", "split_background", "top_environment_fade"],
  VET_M24: [...VETERAN_BACKGROUND_TREATMENTS],
  VET_REF_01: ["full_bleed_dark_overlay", "faint_full_background", "patriotic_texture"],
  VET_REF_02: ["faint_full_background", "patriotic_texture"],
  VET_REF_03: ["full_bleed_dark_overlay", "hero_protected_background"],
  VET_REF_05: ["full_bleed_dark_overlay", "faint_full_background", "patriotic_texture"],
  VET_REF_07: ["left_image_gradient", "split_background"],
  VET_REF_08: ["faint_full_background", "top_environment_fade"],
  VET_REF_09: ["right_image_gradient", "faint_full_background", "hero_protected_background"],
  VET_REF_10: ["faint_full_background", "patriotic_texture"],
  VET_REF_11: ["full_bleed_dark_overlay", "patriotic_texture", "hero_protected_background"],
  VET_REF_12: ["faint_full_background", "top_environment_fade"],
  VET_REPLICA_07: ["left_image_gradient", "split_background"],
};

const LEFT_FOCAL_ASSETS = new Set([1, 3, 4, 9, 11, 15, 21, 28, 30, 38]);
const RIGHT_FOCAL_ASSETS = new Set([14, 25, 26, 33, 34, 36, 39, 40]);
const ENVIRONMENT_ASSETS = new Set([2, 5, 8, 10, 11, 12, 14, 18, 20, 22, 24, 25, 27, 29, 31, 32, 34, 35, 37, 39]);
const PATRIOTIC_TEXTURE_ASSETS = new Set([2, 5, 10, 13, 14, 16, 18, 20, 22, 24, 25, 27, 29, 31, 32, 34, 35, 37, 38, 39]);

export function normalizeVeteranMasterId(masterId: string) {
  return masterId.replace(/^SVET_/, "VET_");
}

export function compatibleVeteranBackgroundTreatments(masterId: string): VeteranBackgroundTreatment[] {
  return [...(BASE_COMPATIBILITY[normalizeVeteranMasterId(masterId)] || [])];
}

export function isVeteranBackgroundEnabled(masterId: string) {
  return compatibleVeteranBackgroundTreatments(masterId).length > 0;
}

export function treatmentSupportsAsset(treatment: VeteranBackgroundTreatment, assetNumber: number) {
  if (treatment === "left_image_gradient") return LEFT_FOCAL_ASSETS.has(assetNumber);
  if (treatment === "right_image_gradient") return RIGHT_FOCAL_ASSETS.has(assetNumber);
  if (treatment === "top_environment_fade") return ENVIRONMENT_ASSETS.has(assetNumber);
  if (treatment === "patriotic_texture") return PATRIOTIC_TEXTURE_ASSETS.has(assetNumber);
  if (treatment === "split_background") return LEFT_FOCAL_ASSETS.has(assetNumber) || RIGHT_FOCAL_ASSETS.has(assetNumber) || ENVIRONMENT_ASSETS.has(assetNumber);
  return true;
}

export function chooseVeteranBackgroundTreatment(masterId: string, executionIndex: number, assetNumber: number): VeteranBackgroundTreatment {
  const allowed = compatibleVeteranBackgroundTreatments(masterId);
  if (!allowed.length) throw new Error(`${masterId} is not background compatible`);
  const compatible = allowed.filter(treatment => treatmentSupportsAsset(treatment, assetNumber));
  const pool = compatible.length ? compatible : allowed.filter(treatment => treatment === "hero_protected_background" || treatment === "faint_full_background" || treatment === "full_bleed_dark_overlay");
  return (pool.length ? pool : allowed)[executionIndex % (pool.length ? pool.length : allowed.length)];
}

export function focalPositionForTreatment(treatment: VeteranBackgroundTreatment, assetNumber: number) {
  if (treatment === "left_image_gradient") return "30% center";
  if (treatment === "right_image_gradient") return "70% center";
  if (treatment === "top_environment_fade") return "center 35%";
  if (treatment === "split_background") return RIGHT_FOCAL_ASSETS.has(assetNumber) ? "72% center" : "28% center";
  if (LEFT_FOCAL_ASSETS.has(assetNumber)) return "32% center";
  if (RIGHT_FOCAL_ASSETS.has(assetNumber)) return "68% center";
  return "center";
}

export function auditBackgroundEnabledMasters() {
  const ids = Object.keys(BASE_COMPATIBILITY).sort();
  return {
    before: 27,
    after: ids.length,
    enabledMasterIds: ids,
    newlyEnabledMasterIds: ["VET_M02", "VET_M10", "VET_REF_02", "VET_REF_10"],
  };
}
