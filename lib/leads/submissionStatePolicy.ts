import { isStateAllowed, normalizeStateCode } from "@/lib/facebook/geo/usStates";

/**
 * State targeting controls ad delivery, not CRM ingestion. A completed form is
 * always accepted; out-of-area submissions are retained and visibly flagged so
 * the agent can route or disposition them appropriately.
 */
export function classifySubmissionState(input: {
  state: unknown;
  licensedStates: unknown;
}) {
  const normalizedState = normalizeStateCode(input.state);
  const licensedStates = Array.isArray(input.licensedStates) ? input.licensedStates : [];
  const outsideLicensedArea =
    !!normalizedState &&
    licensedStates.length > 0 &&
    !isStateAllowed(normalizedState, licensedStates);

  return {
    normalizedState,
    outsideLicensedArea,
    acceptSubmission: true as const,
  };
}
