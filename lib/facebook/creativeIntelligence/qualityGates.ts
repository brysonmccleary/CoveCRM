import type { CreativeEngineDraft, LayoutId } from "./types";

const LIMITS: Record<LayoutId, { headline: number; body: number; button: number }> = {
  hero_amount_age_grid: { headline: 52, body: 84, button: 28 },
  audience_benefit_grid: { headline: 54, body: 82, button: 26 },
  problem_consequence_offer: { headline: 56, body: 88, button: 24 },
  portrait_hero_offer: { headline: 54, body: 86, button: 26 },
  full_bleed_text_overlay: { headline: 50, body: 80, button: 24 },
  notice_letter_paper: { headline: 48, body: 72, button: 24 },
  family_lifestyle_offer: { headline: 54, body: 82, button: 26 },
  comparison_two_column: { headline: 50, body: 76, button: 22 },
  educational_explainer_card: { headline: 52, body: 78, button: 24 },
  calculator_quiz_assessment: { headline: 50, body: 76, button: 24 },
  ugc_talking_head: { headline: 48, body: 72, button: 24 },
  agent_trust_explainer: { headline: 52, body: 78, button: 24 },
};

export function shortenAtWordBoundary(value: string, maxLength: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const approvedClauses = text.split(/(?<=[.!?;:])\s+|\s+[—–-]\s+/).filter(Boolean);
  const clause = approvedClauses.find((part) => part.length >= Math.floor(maxLength * 0.45) && part.length <= maxLength);
  if (clause) return clause.replace(/[.!?;:]$/, "");
  const words = text.split(" ");
  let result = "";
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > maxLength) break;
    result = next;
  }
  return result || text;
}

export function fitCopyForLayout(input: {
  layoutId: LayoutId;
  headline: string;
  body: string;
  buttons: string[];
}) {
  const limits = LIMITS[input.layoutId];
  const headline = shortenAtWordBoundary(input.headline, limits.headline);
  const body = shortenAtWordBoundary(input.body, limits.body);
  const buttons = input.buttons.map((button) => shortenAtWordBoundary(button, limits.button));
  if (buttons.some((button) => !button || button.length > limits.button)) {
    throw new Error(`${input.layoutId} failed readable selector fit validation.`);
  }
  if (headline.split(/\s+/).some((word) => word.length > 22)) {
    throw new Error(`${input.layoutId} contains an unreadable headline token.`);
  }
  return { headline, body, buttons };
}

export function assertCreativeQualityGates(draft: CreativeEngineDraft): true {
  const limits = LIMITS[draft.layoutId];
  if (!draft.headline || draft.headline.length > limits.headline) throw new Error("Creative failed headline fit validation.");
  if (!draft.primaryText || draft.primaryText.length > limits.body) throw new Error("Creative failed supporting-copy fit validation.");
  if (!draft.buttonLabels.length || draft.buttonLabels.length > 4) throw new Error("Creative failed selector-count validation.");
  if (draft.buttonLabels.some((label) => label.length > limits.button)) throw new Error("Creative failed selector-label fit validation.");
  if (draft.layoutId === "notice_letter_paper" && draft.buttonLabels.length > 4) throw new Error("Notice layout cannot reserve enough selector space.");
  return true;
}

function hexToRgb(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(value: string): number | null {
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  const channels = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(foreground: string, background: string): number {
  const left = luminance(foreground);
  const right = luminance(background);
  if (left == null || right == null) return 1;
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function readableForeground(background: string, preferred: string, minimum = 4.5): string {
  if (contrastRatio(preferred, background) >= minimum) return preferred;
  return contrastRatio("#ffffff", background) >= contrastRatio("#0f172a", background) ? "#ffffff" : "#0f172a";
}
