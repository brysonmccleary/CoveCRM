export const SOCIAL_PLATFORMS = ["linkedin", "instagram"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_ACTION_TYPES = ["dm", "like_post", "like_story", "follow", "connect"] as const;
export type SocialActionType = (typeof SOCIAL_ACTION_TYPES)[number];

export type SocialExecutionMode = "simulation" | "browser_companion" | "hosted_cloud";

export type SocialTargetSnapshot = {
  platform: SocialPlatform;
  externalRecipientId: string;
  profileUrl: string;
  displayName: string;
  headline?: string;
  capturedAt: string;
};

export type SocialActionDraft = {
  actionType: SocialActionType;
  platform: SocialPlatform;
  recipientLock: string;
  target: SocialTargetSnapshot;
  message?: string;
  reason: string;
  executionMode: SocialExecutionMode;
  idempotencyKey: string;
};

export type SocialCampaignInput = {
  name: string;
  idealRecruit: string;
  category: string;
  platforms: SocialPlatform[];
  actions: SocialActionType[];
  openingMessage: string;
};
