import { createHash } from "crypto";
import type {
  SocialActionDraft,
  SocialActionType,
  SocialCampaignInput,
  SocialExecutionMode,
  SocialPlatform,
  SocialTargetSnapshot,
} from "./types";

export const MAX_DM_LENGTH = 500;
const UNSUPPORTED_MESSAGE_CLAIM = /guaranteed\s+(income|earnings|salary)|risk[- ]free|you(?:'re| are) hired/i;
const PROTECTED_RECRUITING_TARGET = /\b(age|aged|years? old|under \d{2}|over \d{2}|young|older|male|female|men only|women only|race|religion|ethnicity|disability|marital status)\b/i;

export function validateRecruitingAudienceDescription(value: string): string {
  const description = String(value || "").trim();
  if (description.length < 15 || description.length > 1000) {
    throw new Error("Describe who you want in at least 15 characters.");
  }
  if (PROTECTED_RECRUITING_TARGET.test(description)) {
    throw new Error("Recruiting audiences cannot target protected personal traits. Use experience, location, industry, or interests instead.");
  }
  return description;
}

export type ProviderCapability = {
  platform: SocialPlatform;
  action: SocialActionType;
  mode: SocialExecutionMode;
  enabled: boolean;
  reason: string;
};

const CAPABILITIES: ProviderCapability[] = [
  { platform: "linkedin", action: "dm", mode: "simulation", enabled: true, reason: "Simulation is safe and makes no provider call." },
  { platform: "linkedin", action: "connect", mode: "simulation", enabled: true, reason: "Simulation is safe and makes no provider call." },
  { platform: "linkedin", action: "like_post", mode: "simulation", enabled: true, reason: "Simulation is safe and makes no provider call." },
  { platform: "linkedin", action: "like_story", mode: "simulation", enabled: false, reason: "No approved LinkedIn story capability is configured." },
  { platform: "instagram", action: "dm", mode: "simulation", enabled: true, reason: "Simulation is safe and makes no provider call." },
  { platform: "instagram", action: "like_post", mode: "simulation", enabled: true, reason: "Simulation is safe and makes no provider call." },
  { platform: "instagram", action: "like_story", mode: "simulation", enabled: true, reason: "Simulation is safe and makes no provider call." },
  { platform: "instagram", action: "follow", mode: "simulation", enabled: true, reason: "Simulation is safe and makes no provider call." },
  { platform: "instagram", action: "connect", mode: "simulation", enabled: false, reason: "Instagram does not expose a LinkedIn-style connection operation." },
];

export function listProviderCapabilities(): ProviderCapability[] {
  return CAPABILITIES.map((entry) => ({ ...entry }));
}

export function normalizeProfileUrl(platform: SocialPlatform, value: string): string {
  const parsed = new URL(String(value || "").trim());
  if (parsed.protocol !== "https:") throw new Error("Profile URL must use HTTPS.");
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const expectedHost = platform === "linkedin" ? "linkedin.com" : "instagram.com";
  if (host !== expectedHost) throw new Error(`Profile URL must be on ${expectedHost}.`);
  parsed.hostname = expectedHost;
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  if (platform === "linkedin" && (pathSegments.length !== 2 || pathSegments[0].toLowerCase() !== "in")) {
    throw new Error("LinkedIn target must be an exact /in/{profile} URL.");
  }
  if (platform === "instagram") {
    const username = pathSegments[0] || "";
    const reserved = new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories"]);
    if (pathSegments.length !== 1 || !/^[a-zA-Z0-9._]{1,30}$/.test(username) || reserved.has(username.toLowerCase())) {
      throw new Error("Instagram target must be an exact public profile URL.");
    }
  }
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

export function buildRecipientLock(target: SocialTargetSnapshot): string {
  return createHash("sha256")
    .update([
      target.platform,
      target.externalRecipientId.trim(),
      normalizeProfileUrl(target.platform, target.profileUrl),
      target.displayName.trim().toLowerCase(),
      target.capturedAt,
    ].join("|"))
    .digest("hex");
}

export function validateCampaignInput(input: SocialCampaignInput): SocialCampaignInput {
  const name = String(input.name || "").trim();
  const idealRecruit = String(input.idealRecruit || "").trim();
  const category = String(input.category || "").trim();
  const openingMessage = String(input.openingMessage || "").trim();
  const platforms = [...new Set(input.platforms || [])];
  const actions = [...new Set(input.actions || [])];

  if (name.length < 3 || name.length > 120) throw new Error("Campaign name must be 3-120 characters.");
  if (idealRecruit.length < 20 || idealRecruit.length > 2000) throw new Error("Ideal recruit description must be 20-2000 characters.");
  if (category.length < 2 || category.length > 100) throw new Error("Category must be 2-100 characters.");
  if (!platforms.length) throw new Error("Select at least one platform.");
  if (!actions.length) throw new Error("Select at least one action.");
  if (actions.includes("dm") && (!openingMessage || openingMessage.length > MAX_DM_LENGTH)) {
    throw new Error(`DM opening message is required and must be ${MAX_DM_LENGTH} characters or fewer.`);
  }
  if (UNSUPPORTED_MESSAGE_CLAIM.test(openingMessage)) {
    throw new Error("Message contains an unsupported employment or income claim.");
  }

  return { name, idealRecruit, category, platforms, actions, openingMessage };
}

export function createSimulationDraft(params: {
  campaignId: string;
  actionType: SocialActionType;
  target: SocialTargetSnapshot;
  message?: string;
}): SocialActionDraft {
  const target = {
    ...params.target,
    externalRecipientId: String(params.target.externalRecipientId || "").trim(),
    displayName: String(params.target.displayName || "").trim(),
    profileUrl: normalizeProfileUrl(params.target.platform, params.target.profileUrl),
  };
  if (!target.externalRecipientId) throw new Error("An immutable external recipient ID is required.");
  if (!target.displayName) throw new Error("Target display name is required.");
  if (!Number.isFinite(Date.parse(target.capturedAt))) throw new Error("Target snapshot timestamp is invalid.");

  const capability = CAPABILITIES.find((entry) =>
    entry.platform === target.platform && entry.action === params.actionType && entry.mode === "simulation"
  );
  if (!capability?.enabled) throw new Error(capability?.reason || "Action is not supported for this platform.");

  const message = params.actionType === "dm" ? String(params.message || "").trim() : undefined;
  if (params.actionType === "dm" && (!message || message.length > MAX_DM_LENGTH)) {
    throw new Error(`DM must be 1-${MAX_DM_LENGTH} characters.`);
  }
  if (message && UNSUPPORTED_MESSAGE_CLAIM.test(message)) {
    throw new Error("Message contains an unsupported employment or income claim.");
  }

  const recipientLock = buildRecipientLock(target);
  const idempotencyKey = createHash("sha256")
    .update([params.campaignId, params.actionType, recipientLock, message || ""].join("|"))
    .digest("hex");

  return {
    actionType: params.actionType,
    platform: target.platform,
    recipientLock,
    target,
    message,
    reason: capability.reason,
    executionMode: "simulation",
    idempotencyKey,
  };
}
