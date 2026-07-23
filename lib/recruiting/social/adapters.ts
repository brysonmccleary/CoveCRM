import type { SocialActionDraft, SocialPlatform } from "./types";

export type SocialAdapterResult = {
  ok: boolean;
  simulated: true;
  platform: SocialPlatform;
  idempotencyKey: string;
  providerRequestMade: false;
  summary: string;
};

export interface SocialAdapter {
  readonly platform: SocialPlatform;
  simulate(draft: SocialActionDraft): Promise<SocialAdapterResult>;
}

function simulationAdapter(platform: SocialPlatform): SocialAdapter {
  return {
    platform,
    async simulate(draft) {
      if (draft.platform !== platform || draft.executionMode !== "simulation") {
        throw new Error("Adapter received a mismatched or non-simulation action.");
      }
      return {
        ok: true,
        simulated: true,
        platform,
        idempotencyKey: draft.idempotencyKey,
        providerRequestMade: false,
        summary: `${draft.actionType} validated for ${draft.target.displayName}; no provider request was made.`,
      };
    },
  };
}

export const socialAdapters: Record<SocialPlatform, SocialAdapter> = {
  linkedin: simulationAdapter("linkedin"),
  instagram: simulationAdapter("instagram"),
};
