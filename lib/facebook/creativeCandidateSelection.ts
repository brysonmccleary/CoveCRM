type CreativeCandidate = Record<string, any>;

function isPhoto(candidate: CreativeCandidate): boolean {
  return String(candidate?.visualTreatment || "").trim().toLowerCase() === "photo";
}

/**
 * Keep the generator's ranked order while enforcing a useful treatment mix.
 * A one-ad set must show a paid photo whenever that audience has a photo pool.
 * Larger sets lead with a photo and include a graphic control, so users never
 * accidentally launch an all-CSS set or an all-photo set.
 */
export function selectCreativeTreatmentMix(
  candidates: CreativeCandidate[],
  requestedCount: number,
  photoPoolAvailable: boolean
): CreativeCandidate[] {
  const count = Math.max(0, Math.floor(Number(requestedCount) || 0));
  if (!count) return [];
  if (!photoPoolAvailable) return candidates.slice(0, count);

  const firstPhoto = candidates.find(isPhoto);
  if (!firstPhoto) return candidates.slice(0, count);
  if (count === 1) return [firstPhoto];

  const firstGraphic = candidates.find((candidate) => !isPhoto(candidate));
  const selected: CreativeCandidate[] = [firstPhoto];
  if (firstGraphic && firstGraphic !== firstPhoto) selected.push(firstGraphic);

  const remaining = [
    ...candidates.filter((candidate) => isPhoto(candidate) && !selected.includes(candidate)),
    ...candidates.filter((candidate) => !isPhoto(candidate) && !selected.includes(candidate)),
  ];
  for (const candidate of remaining) {
    if (selected.length >= count) break;
    selected.push(candidate);
  }

  return selected.slice(0, count);
}

export function hasRequiredCreativeTreatmentMix(
  drafts: CreativeCandidate[],
  photoPoolAvailable: boolean
): boolean {
  if (!drafts.length || !photoPoolAvailable) return true;
  const hasPhoto = drafts.some(isPhoto);
  if (drafts.length === 1) return hasPhoto;
  return hasPhoto && drafts.some((draft) => !isPhoto(draft));
}

export function ownerApprovedCreativeMixWarnings(
  drafts: CreativeCandidate[],
  photoPoolAvailable: boolean
): string[] {
  return hasRequiredCreativeTreatmentMix(drafts, photoPoolAvailable)
    ? []
    : ["The selected ad set does not match Cove's preferred photo/graphic treatment mix; owner-approved Meta launch continued."];
}
