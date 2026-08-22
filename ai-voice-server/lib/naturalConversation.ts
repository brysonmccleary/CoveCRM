export type ScriptWordingLevel = 1 | 2 | 3;

export type PrefetchedContextEntry<T> = {
  context: T;
  fetchedAtMs: number;
  sessionId: string;
  leadId: string;
};

export function envFlagEnabled(raw: unknown): boolean {
  const value = String(raw || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function scopedFeatureEnabled(args: {
  globalEnabled: boolean;
  internalTestEnabled: boolean;
  internalEmails: ReadonlySet<string>;
  userEmail?: string;
}): boolean {
  if (args.globalEnabled) return true;
  if (!args.internalTestEnabled) return false;
  const email = String(args.userEmail || "").trim().toLowerCase();
  return !!email && args.internalEmails.has(email);
}

export function latestSelfCorrectionSegment(textRaw: string): string {
  const text = String(textRaw || "").trim();
  if (!text) return "";

  const marker = /\b(?:actually|i mean|sorry(?:,)?\s+(?:i meant|make that)|no(?:,)?\s+(?:sorry|wait)|rather)\b/gi;
  let lastEnd = -1;
  for (const match of text.matchAll(marker)) {
    lastEnd = Number(match.index || 0) + String(match[0] || "").length;
  }

  if (lastEnd < 0) return text;
  const corrected = text.slice(lastEnd).replace(/^[\s,.:;—–-]+/, "").trim();
  return corrected || text;
}

export function authoritativeRoutingText(textRaw: string, enabled: boolean): string {
  const text = String(textRaw || "").trim();
  if (!enabled || !text) return text;
  const corrected = latestSelfCorrectionSegment(text);
  if (!corrected || corrected === text) return text;

  const normalized = corrected.toLowerCase();
  const hasSchedulingCorrection =
    /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|tonight|noon|midnight)\b/.test(normalized) ||
    /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b/.test(normalized);
  const hasAnswerCorrection = /^(?:wait\s+)?(?:yes|yeah|yep|no|nope|nah|today|tomorrow)\b/.test(normalized);

  // Keep conversational filler such as “yeah, I mean I’ve been thinking…” intact.
  // Only replace routing text when the suffix is clearly an authoritative answer.
  return hasSchedulingCorrection || hasAnswerCorrection ? corrected : text;
}

export function adaptivePacingMs(
  textRaw: string,
  enabled: boolean,
  randomValue = Math.random()
): number {
  const random = Math.max(0, Math.min(0.999999, Number(randomValue) || 0));
  const between = (min: number, max: number) => min + Math.floor(random * (max - min + 1));

  // Exact production fallback.
  if (!enabled) return between(120, 220);

  const text = String(textRaw || "").trim().toLowerCase();
  const normalized = text
    .replace(/\b(?:um+|uh+|erm|hmm+)\b/g, " ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = normalized ? normalized.split(" ") : [];

  if (
    words.length <= 4 &&
    /^(?:yes|yeah|yep|yup|no|nope|nah|okay|ok|sure|correct|i think so|that works|sounds good)$/.test(normalized)
  ) {
    return between(35, 75);
  }

  if (
    /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(normalized) &&
    words.length <= 8
  ) {
    return between(45, 90);
  }

  if (latestSelfCorrectionSegment(text) !== text) return between(60, 110);

  const soundsComplex =
    words.length >= 24 ||
    /\b(?:concerned|worried|frustrated|upset|confused|not interested|too expensive|can't afford|cannot afford|need to think|already have)\b/.test(normalized);
  if (soundsComplex) return between(140, 220);

  const soundsUnfinished = /(?:\b(?:and|but|so|because)|[—–-])\s*$/.test(text);
  if (soundsUnfinished) return between(160, 230);

  return between(75, 135);
}

export function scriptWordingLevel(lineRaw: string, requested?: ScriptWordingLevel): ScriptWordingLevel {
  if (requested === 1 || requested === 2 || requested === 3) return requested;

  const line = String(lineRaw || "").trim();
  const lower = line.toLowerCase();

  // Conservative inventory: disclosures, consent, money, numeric offer/appointment
  // details, and operational transfer language remain word-for-word.
  if (
    /[$%]/.test(line) ||
    /\b\d+(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|minutes?|hours?|days?|carriers?)\b/i.test(line) ||
    /\b(?:consent|recorded|recording|disclosure|privacy|terms and conditions|authorization|licensed|not licensed|do not call|appointment is confirmed|transfer(?:ring)? you)\b/.test(lower)
  ) {
    return 1;
  }

  if (/^(?:okay|ok|gotcha|no problem|sure|sounds good|makes sense)[.!— -]*$/i.test(line)) return 3;
  return 2;
}

export function isFreshPrefetchedContext<T>(
  entry: PrefetchedContextEntry<T> | undefined,
  sessionId: string,
  leadId: string,
  nowMs: number,
  maxAgeMs: number
): entry is PrefetchedContextEntry<T> {
  if (!entry || !entry.context) return false;
  if (entry.sessionId !== sessionId || entry.leadId !== leadId) return false;
  const ageMs = nowMs - Number(entry.fetchedAtMs || 0);
  return ageMs >= 0 && ageMs <= maxAgeMs;
}
