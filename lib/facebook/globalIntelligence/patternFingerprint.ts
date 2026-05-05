import { createHash } from "crypto";

function normalizeToken(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[$]\d[\d,]*(?:k|\+)?/g, "amount")
    .replace(/\b\d{2,3}\s*[–-]\s*\d{2,3}\b/g, "age_range")
    .replace(/\b\d+\b/g, "number")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

export function normalizePatternText(value: unknown): string {
  return normalizeToken(value)
    .replace(/\b(you|your|my|our|the|and|or|to|for|in|of|a|an|may|can)\b/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

export function buildPatternFingerprint(input: {
  leadType: string;
  winningFamilyId?: string;
  variationType?: string;
  vendorStyleTag?: string;
  creativeArchetype?: string;
  pageType?: string;
  hookType?: string;
  bodyAngle?: string;
  offerType?: string;
  emotionalAngle?: string;
  qualifierAngle?: string;
  headlineTemplate?: string;
  primaryTextTemplate?: string;
  imagePromptStyle?: string;
}): string {
  const parts = [
    normalizeToken(input.leadType),
    normalizeToken(input.winningFamilyId || input.creativeArchetype),
    normalizeToken(input.variationType),
    normalizeToken(input.vendorStyleTag),
    normalizeToken(input.pageType),
    normalizeToken(input.hookType),
    normalizeToken(input.bodyAngle),
    normalizeToken(input.offerType),
    normalizeToken(input.emotionalAngle),
    normalizeToken(input.qualifierAngle),
    normalizePatternText(input.headlineTemplate),
    normalizePatternText(input.primaryTextTemplate).slice(0, 36),
    normalizePatternText(input.imagePromptStyle).slice(0, 36),
  ].filter(Boolean);

  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
