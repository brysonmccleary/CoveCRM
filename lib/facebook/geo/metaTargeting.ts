import { normalizeStateCodes } from "./usStates";
import { META_REGION_MAP } from "./metaRegionMap";

export function buildMetaStateTargeting(licensedStates?: unknown) {
  const regionIds = Array.from(
    new Set(
      normalizeStateCodes(licensedStates)
        .map((code) => META_REGION_MAP[code])
        .filter((id): id is string => !!id)
    )
  );

  if (!regionIds.length) {
    throw new Error("Licensed states must resolve to Meta region targeting");
  }

  return {
    geo_locations: {
      regions: regionIds.map((id) => ({ key: id })),
      location_types: ["home"],
    },
  };
}
