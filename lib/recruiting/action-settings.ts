import type { SocialActionType, SocialPlatform } from "@/lib/recruiting/social/types";

export type PlatformActionSettings = {
  instagram: { like_post: boolean; like_story: boolean; follow: boolean; dm: boolean };
  linkedin: { like_post: boolean; connect: boolean; dm: boolean };
};

export const ACTION_OPTIONS: Record<SocialPlatform, Array<{ action: SocialActionType; label: string }>> = {
  instagram: [
    { action: "like_post", label: "Like posts" },
    { action: "like_story", label: "Like stories" },
    { action: "follow", label: "Follow profiles" },
    { action: "dm", label: "Send DMs" },
  ],
  linkedin: [
    { action: "like_post", label: "Like posts" },
    { action: "connect", label: "Send connections" },
    { action: "dm", label: "Send DMs" },
  ],
};

export const DEFAULT_PLATFORM_ACTION_SETTINGS: PlatformActionSettings = {
  instagram: { like_post: true, like_story: true, follow: true, dm: true },
  linkedin: { like_post: true, connect: true, dm: true },
};

export function normalizePlatformActionSettings(value: unknown): PlatformActionSettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const normalized = structuredClone(DEFAULT_PLATFORM_ACTION_SETTINGS);
  for (const platform of ["instagram", "linkedin"] as SocialPlatform[]) {
    const platformValue = raw[platform];
    if (!platformValue || typeof platformValue !== "object") continue;
    for (const { action } of ACTION_OPTIONS[platform]) {
      const supplied = (platformValue as Record<string, unknown>)[action];
      if (typeof supplied === "boolean") (normalized[platform] as Record<string, boolean>)[action] = supplied;
    }
  }
  return normalized;
}

export function enabledActionsForPlatform(settings: PlatformActionSettings, platform: SocialPlatform): SocialActionType[] {
  return ACTION_OPTIONS[platform]
    .filter(({ action }) => Boolean((settings[platform] as Record<string, boolean>)[action]))
    .map(({ action }) => action);
}
