type HintSource = {
  headlineTemplate?: string;
  primaryTextTemplate?: string;
  imagePromptStyle?: string;
  hookType?: string;
  bodyAngle?: string;
  ctaStyle?: string;
  buttonStyle?: string;
  benefitFocus?: string;
  status?: string;
  generationHints?: any;
  performanceScore?: number;
};

function addUnique(target: string[], value: unknown, limit: number) {
  const text = String(value || "").trim();
  if (!text || target.includes(text)) return;
  if (target.length < limit) target.push(text);
}

export function buildGenerationHints(sources: HintSource[], limit = 8) {
  const hints = {
    preferredHeadlinePatterns: [] as string[],
    preferredPrimaryTextPatterns: [] as string[],
    preferredButtonLabels: [] as string[],
    preferredBenefitBullets: [] as string[],
    preferredImageStyleNotes: [] as string[],
    preferredHooks: [] as string[],
    antiPatterns: [] as string[],
  };

  const ranked = [...sources].sort(
    (a, b) => Number(b.performanceScore || 0) - Number(a.performanceScore || 0)
  );

  for (const source of ranked) {
    addUnique(hints.preferredHeadlinePatterns, source.headlineTemplate, limit);
    addUnique(hints.preferredPrimaryTextPatterns, source.primaryTextTemplate, limit);
    addUnique(hints.preferredImageStyleNotes, source.imagePromptStyle, limit);
    addUnique(hints.preferredHooks, source.hookType, limit);
    addUnique(hints.preferredHooks, source.bodyAngle, limit);
    addUnique(hints.preferredButtonLabels, source.ctaStyle, limit);
    addUnique(hints.preferredButtonLabels, source.buttonStyle, limit);
    addUnique(hints.preferredBenefitBullets, source.benefitFocus, limit);

    for (const key of Object.keys(hints) as Array<keyof typeof hints>) {
      for (const value of source.generationHints?.[key] || []) {
        addUnique(hints[key], value, limit);
      }
    }

    if (source.status === "fatigued" || source.status === "paused") {
      addUnique(hints.antiPatterns, source.hookType, limit);
      addUnique(hints.antiPatterns, source.imagePromptStyle, limit);
    }
  }

  return hints;
}
