export type VeteranGoldenVisual = {
  executionId: string;
  renderFingerprint: string;
  approvedGeometryId: string;
  backgroundAssetId: string | null;
  imageTreatment: string;
  heroAmount: 40_000 | 50_000 | 100_000 | null;
};

// Captured from the actual August 29 final Veteran review outputs. These are
// historical identities, not expectations generated from the current code.
export const VETERAN_AUG29_GOLDEN_VISUALS: readonly VeteranGoldenVisual[] = [
  { executionId: "VET_M11_EXEC_013", renderFingerprint: "fp_cc354c0617c06a98", approvedGeometryId: "VET_EXISTING_LAYOUT_11", backgroundAssetId: "VET_IMG_29", imageTreatment: "full_bleed_dark_overlay", heroAmount: 100_000 },
  { executionId: "VET_M05_EXEC_002", renderFingerprint: "fp_9d7826b470e1bdde", approvedGeometryId: "VET_EXISTING_LAYOUT_05", backgroundAssetId: "VET_IMG_27", imageTreatment: "faint_full_background", heroAmount: 50_000 },
  { executionId: "VET_M08_EXEC_026", renderFingerprint: "fp_8411304218c983ba", approvedGeometryId: "VET_EXISTING_LAYOUT_08", backgroundAssetId: "VET_IMG_12", imageTreatment: "top_environment_fade", heroAmount: 40_000 },
  { executionId: "VET_M13_EXEC_002", renderFingerprint: "fp_b2ae8523e16c8139", approvedGeometryId: "VET_EXISTING_LAYOUT_13", backgroundAssetId: "VET_IMG_03", imageTreatment: "hero_protected_background", heroAmount: 50_000 },
  { executionId: "VET_M14_EXEC_026", renderFingerprint: "fp_e9610d5b9a10465d", approvedGeometryId: "VET_EXISTING_LAYOUT_14", backgroundAssetId: "VET_IMG_02", imageTreatment: "split_background", heroAmount: 40_000 },
  { executionId: "VET_M19_EXEC_014", renderFingerprint: "fp_3686d85a857a7f44", approvedGeometryId: "VET_EXISTING_LAYOUT_19", backgroundAssetId: "VET_IMG_06", imageTreatment: "hero_protected_background", heroAmount: null },
  { executionId: "VET_M01_EXEC_017", renderFingerprint: "fp_506f2c1060c15a30", approvedGeometryId: "VET_EXISTING_LAYOUT_01", backgroundAssetId: "VET_IMG_12", imageTreatment: "full_bleed_dark_overlay", heroAmount: 50_000 },
  { executionId: "VET_REF_03_EXEC_008", renderFingerprint: "fp_7de6ee13759f7219", approvedGeometryId: "VET_REFERENCE_LOCKED_03", backgroundAssetId: "VET_IMG_20", imageTreatment: "hero_protected_background", heroAmount: 100_000 },
  { executionId: "VET_M20_EXEC_013", renderFingerprint: "fp_a30353d3e8d9ad41", approvedGeometryId: "VET_EXISTING_LAYOUT_20", backgroundAssetId: "VET_IMG_27", imageTreatment: "split_background", heroAmount: 100_000 },
  { executionId: "VET_REF_11_EXEC_013", renderFingerprint: "fp_220665f845488294", approvedGeometryId: "VET_REFERENCE_LOCKED_11", backgroundAssetId: "VET_IMG_05", imageTreatment: "full_bleed_dark_overlay", heroAmount: 100_000 },
  { executionId: "VET_REPLICA_07_EXEC_026", renderFingerprint: "fp_7a403caa8eb13256", approvedGeometryId: "VET_LITERAL_REFERENCE_07", backgroundAssetId: "VET_IMG_22", imageTreatment: "split_background", heroAmount: 40_000 },
  { executionId: "VET_REPLICA_12_EXEC_017", renderFingerprint: "fp_f8e78a774de2c015", approvedGeometryId: "VET_LITERAL_REFERENCE_12", backgroundAssetId: null, imageTreatment: "none", heroAmount: 50_000 },
] as const;
