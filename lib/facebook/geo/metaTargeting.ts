import { normalizeStateCodesStrict } from "./usStates";
import { META_REGION_MAP } from "./metaRegionMap";

export function buildMetaStateTargeting(licensedStates?: unknown) {
  const selectedCodes = normalizeStateCodesStrict(licensedStates);
  const regionIds = selectedCodes.map((code) => {
    const regionId = META_REGION_MAP[code];
    if (!regionId) {
      throw new Error(`No Meta region key configured for selected state: ${code}`);
    }
    return regionId;
  });

  if (!selectedCodes.length) {
    throw new Error("Licensed states must resolve to Meta region targeting");
  }
  if (selectedCodes.length !== regionIds.length) {
    throw new Error("Every selected state must resolve to exactly one Meta region key");
  }

  return {
    geo_locations: {
      regions: regionIds.map((id) => ({ key: id })),
      location_types: ["home"],
    },
    targeting_automation: {
      advantage_audience: 0,
    },
    publisher_platforms: ["facebook", "instagram"],
    facebook_positions: ["feed"],
    instagram_positions: ["stream"],
  };
}
